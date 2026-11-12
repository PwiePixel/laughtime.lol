// Rules of the game modes as pure functions (no database, no media modules).
// server/game.js keeps the phase machine and calls these. Everything random
// comes in through a `shuffle` parameter so tests can be deterministic.

const keep = (list) => [...list];

// --- GIF Hunt: the hand of one search ----------------------------------------

/**
 * Deals up to `size` tiles from the hits of one search.
 *   own    ids that are already in the player's tray (never dealt twice)
 *   avoid  ids used earlier in this game or picked by other players right now
 * Fresh hits come from the best `top` results; only if those are not enough,
 * already used ones fill the hand. `spares` are kept for broken files.
 */
export function drawHand(items, { own = new Set(), avoid = new Set(), size = 4, top = 16, spare = 30, shuffle = keep } = {}) {
  const seen = new Set();
  const list = [];
  for (const item of items || []) {
    if (!item || own.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    list.push(item);
  }
  const fresh = list.filter((i) => !avoid.has(i.id));
  const used = list.filter((i) => avoid.has(i.id));
  const hand = shuffle(fresh.slice(0, top)).slice(0, size);
  if (hand.length < size) hand.push(...used.slice(0, size - hand.length));
  const dealt = new Set(hand.map((i) => i.id));
  return { hand, spares: list.filter((i) => !dealt.has(i.id)).slice(0, spare) };
}

// --- Swap: who gets whose picture ---------------------------------------------

/**
 * receivers  ids of the players who caption this round
 * owners     ids of everybody who brought a picture (may include players that are offline right now)
 * Returns Map receiver -> [owner ids] with up to `options` entries: never the
 * receiver's own picture, never the same owner twice. If all n >= 3 seats own a
 * picture, every picture is offered to exactly `options` receivers.
 */
export function dealSwap({ receivers, owners, options = 2, shuffle = keep }) {
  const owning = new Set(owners);
  const ring = shuffle([...new Set([...receivers, ...owners])]);
  const seat = new Map(ring.map((id, i) => [id, i]));
  const deal = new Map();
  for (const pid of new Set(receivers)) {
    const got = [];
    for (let step = 1; step < ring.length && got.length < options; step++) {
      const other = ring[(seat.get(pid) + step) % ring.length];
      if (owning.has(other)) got.push(other);
    }
    deal.set(pid, got);
  }
  return deal;
}

/**
 * Pictures for somebody who joins a running swap round: the ones that were
 * offered least often so far (ties in random order), never the joiner's own.
 */
export function lateOptions({ pid, owners, offers = new Map(), count = 2, shuffle = keep }) {
  return shuffle([...new Set(owners)].filter((id) => id !== pid))
    .map((id, i) => ({ id, i, n: offers.get(id) || 0 }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .slice(0, count)
    .map((x) => x.id);
}

/**
 * Vote order of a swap round: memes on the same picture run back to back.
 * entries: [{ pid, from, mediaId }] -> [{ pid, sameAsPrev }]
 */
export function swapVoteOrder(entries, shuffle = keep) {
  const groups = new Map();
  for (const e of entries) {
    const key = `${e.from || ''}|${e.mediaId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.pid);
  }
  const out = [];
  for (const group of shuffle([...groups.values()])) {
    shuffle(group).forEach((pid, i) => out.push({ pid, sameAsPrev: i > 0 }));
  }
  return out;
}

export const ASSIST_SOURCES = ['upload', 'search'];

/**
 * Picture bonus of one meme for whoever brought its picture: one point per
 * rating of 4 or 5 that did not come from the bringer.
 * result: { pid, from, source, ratings: [[voterId, score]] }
 */
export function assistFor(result) {
  if (!result?.from || result.from === result.pid || !ASSIST_SOURCES.includes(result.source)) return 0;
  let n = 0;
  for (const [voter, score] of result.ratings || []) if (voter !== result.from && score >= 4) n++;
  return n;
}

// --- votes ---------------------------------------------------------------------

/** how often each rating 1..5 was given: [n1, n2, n3, n4, n5] */
export function distOf(scores) {
  const dist = [0, 0, 0, 0, 0];
  for (const s of scores || []) if (Number.isInteger(s) && s >= 1 && s <= 5) dist[s - 1] += 1;
  return dist;
}

// --- pacing (not in classic) -----------------------------------------------------

export const stragglersAllowed = (n) => Math.max(1, Math.floor(n / 4));

/** enough players are done to start the last call for the rest */
export const lastCallReached = (done, total) => total >= 3 && done < total && done >= total - stragglersAllowed(total);

/**
 * The shortened deadline of a last call, or null if it would not end the phase
 * at least a second earlier. With `configuredMs` nobody ever gets less than
 * half of the configured time.
 */
export function lastCallDeadline({ now, deadline, graceMs, phaseStart = 0, configuredMs = 0 }) {
  const next = Math.max(now + graceMs, configuredMs ? phaseStart + configuredMs / 2 : 0);
  return next <= deadline - 1000 ? next : null;
}

// --- ranking -------------------------------------------------------------------

/**
 * rows: [{ pid, score, roundWins, bestMeme, joinedAt }]
 * Order: score; with `tieBreak` also rounds won, then the best single meme.
 * Equal rows share a rank. `decidedBy` says what separated the winner from the
 * next player when their scores were equal ('wins' | 'meme' | null).
 */
export function rankPlayers(rows, { tieBreak = false } = {}) {
  const cmp = (a, b) => b.score - a.score || (tieBreak ? b.roundWins - a.roundWins || b.bestMeme - a.bestMeme : 0);
  const sorted = [...rows].sort((a, b) => cmp(a, b) || (a.joinedAt || 0) - (b.joinedAt || 0));
  const ranking = sorted.map((row) => ({
    pid: row.pid,
    rank: 1 + sorted.filter((other) => cmp(other, row) < 0).length,
    score: row.score,
    roundWins: row.roundWins || 0,
    bestMeme: row.bestMeme || 0,
  }));
  const tie = ranking.filter((r) => r.rank === 1).length > 1;
  let decidedBy = null;
  const [first, second] = ranking;
  if (!tie && second && first.score === second.score) decidedBy = first.roundWins !== second.roundWins ? 'wins' : 'meme';
  return { ranking, tie, decidedBy };
}

// --- awards at the final (no points) ----------------------------------------------

const AWARD_ORDER = ['supplier', 'one_shot', 'best_meme', 'on_fire', 'crowd', 'best_avg'];
const AWARDS_WANTED = 3;
const AWARDS_MAX = 4;

/**
 * players: [{ pid, score, bestStreak, assist }]   everybody who took part and is still in the room
 * memes:   [{ round, pid, points, avg, votes, searches }]
 * crowd:   Map pid -> reactions received from others while their meme was on screen
 * Returns [{ id, pid, value, round? }] in a fixed order, spread over as many players as possible.
 */
export function awardsFor({ game, players = [], memes = [], crowd = new Map() }) {
  const byPid = new Map(players.map((p) => [p.pid, p]));
  const own = memes.filter((m) => byPid.has(m.pid));
  if (players.length < 3 || !own.some((m) => m.points > 0)) return [];
  const score = (pid) => byPid.get(pid)?.score || 0;
  const bestOf = (list) => [...list].sort((a, b) => b.points - a.points || b.avg - a.avg || a.round - b.round)[0];
  const topPlayer = (value, min) =>
    players
      .map((p) => ({ pid: p.pid, value: value(p) }))
      .filter((x) => x.value >= min)
      .sort((a, b) => b.value - a.value || score(b.pid) - score(a.pid))[0];

  const found = {};
  if (game === 'swap') found.supplier = topPlayer((p) => p.assist || 0, 2);
  if (game === 'hunt') {
    const m = bestOf(own.filter((x) => x.points > 0 && (x.searches || 0) <= 1));
    if (m) found.one_shot = { pid: m.pid, value: m.points, round: m.round };
  }
  const best = bestOf(own.filter((x) => x.points > 0));
  if (best) found.best_meme = { pid: best.pid, value: best.points, round: best.round };
  found.on_fire = topPlayer((p) => p.bestStreak || 0, 2);
  found.crowd = topPlayer((p) => crowd.get(p.pid) || 0, 3);
  const means = new Map();
  for (const p of players) {
    const rated = own.filter((m) => m.pid === p.pid && m.votes > 0);
    if (rated.length >= 2) means.set(p.pid, Math.round((rated.reduce((a, m) => a + m.avg, 0) / rated.length) * 10) / 10);
  }
  found.best_avg = topPlayer((p) => means.get(p.pid) ?? -1, 0);

  const candidates = AWARD_ORDER.filter((id) => found[id]).map((id) => ({ id, ...found[id] }));
  const given = [];
  const holders = new Set();
  // first everybody gets at most one award ...
  for (const c of candidates) {
    if (given.length >= AWARDS_MAX || holders.has(c.pid)) continue;
    holders.add(c.pid);
    given.push(c);
  }
  // ... then the skipped ones fill the row
  for (const c of candidates) {
    if (given.length >= AWARDS_WANTED) break;
    if (!given.includes(c)) given.push(c);
  }
  return given.sort((a, b) => AWARD_ORDER.indexOf(a.id) - AWARD_ORDER.indexOf(b.id));
}
