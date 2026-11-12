import { isAdmin, publicUser } from './accounts.js';
import { all, get, newId, run, transaction } from './db.js';
import { HttpError } from './http.js';
import { proxyUrl } from './proxy.js';
import { activeSanction } from './moderation.js';

// ---------------------------------------------------------------------------
// Game results, leaderboards and the public meme gallery.
// Only players with an account are recorded – guests play as before.
// ---------------------------------------------------------------------------

const DAY = 86400_000;
export const PERIODS = { week: 7 * DAY, month: 30 * DAY, all: 0 };
export const METRICS = ['points', 'wins', 'round_wins', 'likes', 'games'];

const since = (period) => (PERIODS[period] ? Date.now() - PERIODS[period] : 0);

// --- recording (called by the game server) -----------------------------------

/**
 * Saves a round winner's meme into the gallery.
 * Returns the meme id if it is publicly visible (the player enabled "show my memes"), otherwise null.
 * Memes with room uploads (swap round) or unreviewed own uploads are never stored.
 */
export function saveWinningMeme({ userId, media, captions, points, avg, votes, players }) {
  if (!userId || !media || points <= 0 || votes < 1 || players < 2) return null;
  if (media.roomUpload) return null;
  if (media.uploadId && !get('SELECT approved FROM uploads WHERE id = ?', media.uploadId)?.approved) return null;
  const id = newId(8);
  run(
    `INSERT INTO memes (id, user_id, media, captions, points, avg, votes, players, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    JSON.stringify({
      id: media.id,
      kind: media.kind,
      url: media.url,
      width: media.width,
      height: media.height,
      title: media.title,
      source: media.source,
      link: media.link,
      local: media.local || undefined,
      uploadId: media.uploadId || undefined,
      animated: media.animated || undefined,
    }),
    JSON.stringify(captions),
    points,
    avg,
    votes,
    players,
    Date.now(),
  );
  const show = get('SELECT show_memes FROM users WHERE id = ?', userId)?.show_memes;
  if (show && activeSanction({ userId })) {
    run('UPDATE memes SET hidden = 1 WHERE id = ?', id);
    return null;
  }
  return show ? id : null;
}

/** rows: [{ userId, points, won, rounds, roundWins, memes, votes }] */
export function saveGameResults(rows, players) {
  const valid = rows.filter((r) => r.userId && (r.rounds > 0 || r.votes > 0));
  if (!valid.length || players < 2) return 0;
  const now = Date.now();
  transaction(() => {
    for (const r of valid) {
      run(
        `INSERT INTO game_results (user_id, points, won, rounds, round_wins, memes, votes, players, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.userId,
        r.points,
        r.won ? 1 : 0,
        r.rounds,
        r.roundWins,
        r.memes,
        r.votes,
        players,
        now,
      );
    }
  });
  return valid.length;
}

// --- stats & leaderboards ------------------------------------------------------

export function userStats(userId) {
  const g =
    get(
      `SELECT COUNT(*) AS games, COALESCE(SUM(won),0) AS wins, COALESCE(SUM(points),0) AS points,
              COALESCE(MAX(points),0) AS best, COALESCE(SUM(rounds),0) AS rounds,
              COALESCE(SUM(round_wins),0) AS roundWins, COALESCE(SUM(memes),0) AS memes,
              COALESCE(SUM(votes),0) AS votes
       FROM game_results WHERE user_id = ?`,
      userId,
    ) || {};
  const m = get('SELECT COUNT(*) AS saved, COALESCE(SUM(likes),0) AS likes FROM memes WHERE user_id = ? AND hidden = 0', userId) || {};
  const rank = g.points
    ? (get(
        `SELECT COUNT(*) AS better FROM (SELECT user_id, SUM(points) AS p FROM game_results GROUP BY user_id) WHERE p > ?`,
        g.points,
      )?.better ?? 0) + 1
    : null;
  return {
    games: Number(g.games || 0),
    wins: Number(g.wins || 0),
    points: Number(g.points || 0),
    bestGame: Number(g.best || 0),
    rounds: Number(g.rounds || 0),
    roundWins: Number(g.roundWins || 0),
    memes: Number(g.memes || 0),
    votes: Number(g.votes || 0),
    savedMemes: Number(m.saved || 0),
    likes: Number(m.likes || 0),
    rank,
  };
}

export function leaderboard(metric = 'points', period = 'all', limit = 50) {
  if (!METRICS.includes(metric)) throw new HttpError(400, 'bad_metric');
  if (!(period in PERIODS)) throw new HttpError(400, 'bad_period');
  const from = since(period);
  let rows;
  if (metric === 'likes') {
    rows = all(
      `SELECT u.username, u.display_name, u.avatar, SUM(m.likes) AS value, COUNT(*) AS games, 0 AS wins
       FROM memes m JOIN users u ON u.id = m.user_id
       WHERE m.hidden = 0 AND u.show_memes = 1 AND m.created_at >= ?
       GROUP BY m.user_id HAVING value > 0
       ORDER BY value DESC, games DESC LIMIT ?`,
      from,
      limit,
    );
  } else {
    const expr = { points: 'SUM(r.points)', wins: 'SUM(r.won)', round_wins: 'SUM(r.round_wins)', games: 'COUNT(*)' }[metric];
    rows = all(
      `SELECT u.username, u.display_name, u.avatar, ${expr} AS value, COUNT(*) AS games, SUM(r.won) AS wins
       FROM game_results r JOIN users u ON u.id = r.user_id
       WHERE r.created_at >= ?
       GROUP BY r.user_id HAVING value > 0
       ORDER BY value DESC, games ASC LIMIT ?`,
      from,
      limit,
    );
  }
  return rows.map((r, i) => ({
    rank: i + 1,
    user: { username: r.username, displayName: r.display_name, avatar: r.avatar },
    value: Number(r.value),
    games: Number(r.games),
    wins: Number(r.wins),
  }));
}

export function siteStats() {
  const u = get('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  const g = get('SELECT COUNT(*) AS n FROM game_results')?.n ?? 0;
  const m = get('SELECT COUNT(*) AS n FROM memes m JOIN users u ON u.id = m.user_id WHERE m.hidden = 0 AND u.show_memes = 1')?.n ?? 0;
  return { users: Number(u), results: Number(g), memes: Number(m) };
}

// --- gallery -----------------------------------------------------------------

function formatMeme(row, viewer) {
  const media = JSON.parse(row.media);
  return {
    id: row.id,
    media: {
      id: media.id,
      kind: media.kind,
      src: media.local ? media.url : proxyUrl(media.url),
      width: media.width,
      height: media.height,
      title: media.title,
      source: media.source,
      animated: media.animated || undefined,
    },
    captions: JSON.parse(row.captions),
    points: row.points,
    avg: row.avg,
    votes: row.votes,
    players: row.players,
    likes: row.likes,
    liked: Boolean(row.liked),
    mine: Boolean(viewer && viewer.id === row.user_id),
    private: !row.show_memes,
    canDelete: Boolean(viewer && (viewer.id === row.user_id || isAdmin(viewer))),
    author: publicUser({ username: row.username, display_name: row.display_name, avatar: row.avatar }),
    createdAt: row.created_at,
  };
}

const MEME_SELECT = `
  SELECT m.*, u.username, u.display_name, u.avatar, u.show_memes,
         EXISTS(SELECT 1 FROM meme_likes l WHERE l.meme_id = m.id AND l.user_id = ?) AS liked
  FROM memes m JOIN users u ON u.id = m.user_id`;

export function listMemes({ sort = 'top', period = 'all', username = null, viewer = null, limit = 24, offset = 0 }) {
  if (!['top', 'new'].includes(sort)) throw new HttpError(400, 'bad_sort');
  if (!(period in PERIODS)) throw new HttpError(400, 'bad_period');
  const lim = Math.max(1, Math.min(48, Number(limit) || 24));
  const off = Math.max(0, Math.min(10_000, Number(offset) || 0));
  const where = ['m.hidden = 0', 'm.created_at >= ?'];
  const params = [viewer?.id ?? -1, since(period)];
  if (username) {
    where.push('u.username = ?');
    params.push(username);
    // on your own profile you also see memes that are not shown in the public gallery
    if (!viewer || viewer.username.toLowerCase() !== String(username).toLowerCase()) where.push('u.show_memes = 1');
  } else {
    where.push('u.show_memes = 1');
  }
  const order = sort === 'top' ? 'm.likes DESC, m.avg DESC, m.points DESC, m.created_at DESC' : 'm.created_at DESC';
  const rows = all(`${MEME_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, lim + 1, off);
  return {
    items: rows.slice(0, lim).map((r) => formatMeme(r, viewer)),
    nextOffset: rows.length > lim ? off + lim : null,
  };
}

export function getMeme(id, viewer) {
  const row = get(`${MEME_SELECT} WHERE m.id = ? AND m.hidden = 0`, viewer?.id ?? -1, String(id));
  if (!row || (!row.show_memes && viewer?.id !== row.user_id && !isAdmin(viewer))) throw new HttpError(404, 'meme_not_found');
  return formatMeme(row, viewer);
}

export function toggleLike(memeId, user) {
  const meme = get(
    'SELECT m.id, m.user_id FROM memes m JOIN users u ON u.id = m.user_id WHERE m.id = ? AND m.hidden = 0 AND u.show_memes = 1',
    String(memeId),
  );
  if (!meme) throw new HttpError(404, 'meme_not_found');
  if (meme.user_id === user.id) throw new HttpError(400, 'own_meme');
  return transaction(() => {
    const existing = get('SELECT 1 AS x FROM meme_likes WHERE meme_id = ? AND user_id = ?', meme.id, user.id);
    if (existing) {
      run('DELETE FROM meme_likes WHERE meme_id = ? AND user_id = ?', meme.id, user.id);
      run('UPDATE memes SET likes = MAX(0, likes - 1) WHERE id = ?', meme.id);
    } else {
      run('INSERT INTO meme_likes (meme_id, user_id, created_at) VALUES (?, ?, ?)', meme.id, user.id, Date.now());
      run('UPDATE memes SET likes = likes + 1 WHERE id = ?', meme.id);
    }
    const likes = get('SELECT likes FROM memes WHERE id = ?', meme.id).likes;
    return { liked: !existing, likes };
  });
}

export function deleteMeme(memeId, user) {
  const meme = get('SELECT id, user_id FROM memes WHERE id = ?', String(memeId));
  if (!meme) throw new HttpError(404, 'meme_not_found');
  if (meme.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'forbidden');
  run('DELETE FROM memes WHERE id = ?', meme.id);
  return { ok: true };
}
