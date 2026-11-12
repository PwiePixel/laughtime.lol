import { PUBLIC_GAME_IDS as GAME_IDS, sanitizeAvatar, sanitizeName } from '../lib/shared.js';
import { getConfig } from './config.js';
import { createRoom, findPublicRoom, publicStats, reserveSeat } from './game.js';
import { activeSanction } from './moderation.js';

// ---------------------------------------------------------------------------
// "Quick play": random public matchmaking.
// Players wait in a queue per game mode. As soon as enough players are there
// (MATCH_MIN_PLAYERS, default 4) a short countdown starts; at MATCH_MAX_PLAYERS
// (default 8) the match is made immediately. Public rooms that still have a
// free seat are filled first. Matched players get { t: 'matched', code }.
// ---------------------------------------------------------------------------

const queues = new Map(GAME_IDS.map((g) => [g, { entries: new Map(), timer: null, startsAt: 0, relaxTimer: null }]));
const PID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

const now = () => Date.now();

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function matched(ws, code) {
  send(ws, { t: 'matched', code });
  ws.queue = null;
}

export function leaveQueue(ws) {
  if (!ws.queue) return;
  const { game, pid } = ws.queue;
  ws.queue = null;
  const q = queues.get(game);
  if (q?.entries.get(pid)?.ws === ws) {
    q.entries.delete(pid);
    evaluate(game);
  }
}

function status(game) {
  const cfg = getConfig();
  const q = queues.get(game);
  const list = [...q.entries.values()];
  const oldest = list.reduce((m, e) => Math.min(m, e.joinedAt), Infinity);
  const relaxAt = cfg.matchRelaxMs && list.length ? oldest + cfg.matchRelaxMs : 0;
  return {
    t: 'queue',
    game,
    size: list.length,
    min: cfg.matchMin,
    max: cfg.matchMax,
    relaxMin: cfg.matchRelaxMin,
    relaxAt,
    startsAt: q.startsAt,
    serverNow: now(),
    players: list.slice(0, 16).map((e) => ({ avatar: e.avatar, name: e.name })),
    online: publicStats(game).players,
  };
}

function broadcastStatus(game) {
  const q = queues.get(game);
  const msg = status(game);
  for (const e of q.entries.values()) send(e.ws, { ...msg, you: e.pid });
}

function clearCountdown(q) {
  if (q.timer) clearTimeout(q.timer);
  q.timer = null;
  q.startsAt = 0;
}

function formMatch(game) {
  const cfg = getConfig();
  const q = queues.get(game);
  clearCountdown(q);
  const list = [...q.entries.values()].sort((a, b) => a.joinedAt - b.joinedAt).slice(0, cfg.matchMax);
  if (list.length < 2) return;
  const room = createRoom({ game, isPublic: true });
  if (!room) {
    for (const e of list) send(e.ws, { t: 'error', code: 'server_full' });
    return;
  }
  for (const e of list) {
    q.entries.delete(e.pid);
    reserveSeat(room, e.pid);
    matched(e.ws, room.code);
  }
  console.log(`[match] ${game}: room ${room.code} with ${list.length} players`);
}

function evaluate(game) {
  const cfg = getConfig();
  const q = queues.get(game);
  for (const [pid, e] of q.entries) if (e.ws.readyState !== 1) q.entries.delete(pid);

  // free seats in running public rooms first
  for (const e of [...q.entries.values()].sort((a, b) => a.joinedAt - b.joinedAt)) {
    const room = findPublicRoom(game);
    if (!room) break;
    q.entries.delete(e.pid);
    reserveSeat(room, e.pid);
    matched(e.ws, room.code);
  }

  while (q.entries.size >= cfg.matchMax) formMatch(game);

  const size = q.entries.size;
  const oldest = [...q.entries.values()].reduce((m, e) => Math.min(m, e.joinedAt), Infinity);
  const waited = size ? now() - oldest : 0;
  const relaxed = cfg.matchRelaxMs > 0 && waited >= cfg.matchRelaxMs;
  const needed = relaxed ? Math.min(cfg.matchMin, cfg.matchRelaxMin) : cfg.matchMin;

  if (size >= needed && size >= 2) {
    if (!q.timer) {
      q.startsAt = now() + cfg.matchWaitMs;
      q.timer = setTimeout(() => {
        q.timer = null;
        formMatch(game);
        evaluate(game);
      }, cfg.matchWaitMs);
      q.timer.unref?.();
    }
  } else {
    clearCountdown(q);
  }

  // wake up when the relaxed minimum kicks in
  if (q.relaxTimer) clearTimeout(q.relaxTimer);
  q.relaxTimer = null;
  if (size && !relaxed && cfg.matchRelaxMs > 0) {
    q.relaxTimer = setTimeout(() => evaluate(game), cfg.matchRelaxMs - waited + 50);
    q.relaxTimer.unref?.();
  }
  broadcastStatus(game);
}

/** a public room changed (someone left / game ended) – maybe queued players fit in */
export function onPublicRoomChanged(game) {
  if (queues.get(game)?.entries.size) setTimeout(() => evaluate(game), 0);
}

export function handleMatchmaking(ws, msg) {
  if (msg.t === 'unqueue') {
    leaveQueue(ws);
    return send(ws, { t: 'unqueued' });
  }
  const game = GAME_IDS.includes(msg.game) ? msg.game : 'classic';
  const pid = String(msg.pid || '');
  if (!PID_RE.test(pid)) return send(ws, { t: 'error', code: 'bad_request' });
  if (ws.room) return send(ws, { t: 'error', code: 'bad_request' });
  const account = ws.account;
  const name = account ? sanitizeName(account.displayName) || account.username : sanitizeName(msg.name);
  if (!name) return send(ws, { t: 'error', code: 'name_required' });
  const avatar = sanitizeAvatar(account ? account.avatar : msg.avatar);

  const sanction = activeSanction({ userId: account?.id, pid, ipHash: ws.ipHash });
  if (sanction) return send(ws, { t: 'error', code: sanction.type === 'ban' ? 'banned' : 'restricted', sanction });

  leaveQueue(ws);
  // one queue entry per browser / account
  for (const q of queues.values()) {
    for (const [key, e] of q.entries) {
      if (e.pid === pid || (account && e.userId === account.id)) {
        q.entries.delete(key);
        if (e.ws !== ws) {
          e.ws.queue = null;
          send(e.ws, { t: 'error', code: 'queue_elsewhere' });
        }
      }
    }
  }

  const q = queues.get(game);
  q.entries.set(pid, { ws, pid, userId: account?.id || null, ipHash: ws.ipHash || null, name, avatar, joinedAt: now() });
  ws.queue = { game, pid };
  evaluate(game);
  for (const g of GAME_IDS) if (g !== game) broadcastStatus(g);
  return undefined;
}

/** moderation: take a player out of every queue */
export function removeQueued(who, msg) {
  for (const [game, q] of queues) {
    let changed = false;
    for (const [pid, e] of q.entries) {
      const hit = (who.userId && e.userId === who.userId) || (who.pid && e.pid === who.pid) || (who.ipHash && !e.userId && e.ipHash === who.ipHash);
      if (!hit) continue;
      q.entries.delete(pid);
      e.ws.queue = null;
      send(e.ws, msg);
      changed = true;
    }
    if (changed) evaluate(game);
  }
}

export function queueSizes() {
  return Object.fromEntries([...queues].map(([g, q]) => [g, q.entries.size]));
}
