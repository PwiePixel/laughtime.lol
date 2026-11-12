import crypto from 'node:crypto';
import {
  GAME_IDS,
  PUBLIC_GAME_IDS,
  REACTIONS,
  ROOM_CODE_CHARS,
  ROOM_CODE_RE,
  hasText,
  presetFor,
  sanitizeAvatar,
  sanitizeCaptions,
  sanitizeName,
  sanitizeSettings,
} from '../lib/shared.js';
import { getConfig } from './config.js';
import { handleMatchmaking, leaveQueue, onPublicRoomChanged } from './matchmaking.js';
import { isBroken, mediaReady, pickMedia } from './media/index.js';
import { QUERY_MIN, cleanQuery, isBlocked, searchMedia } from './media/search.js';
import { countPackPlay, packForGame, packItemsForGame } from './packs.js';
import { proxyUrl, warmMedia } from './proxy.js';
import { saveGameResults, saveWinningMeme } from './stats.js';
import { HttpError } from './http.js';
import { removeFile, storeFile, uploadMedia } from './uploads.js';
import { activeSanction, createReport, recordActivity, setLiveHooks } from './moderation.js';
import { removeQueued } from './matchmaking.js';

// ---------------------------------------------------------------------------
// Game flow:  lobby -> caption -> vote (rating/reveal per meme) -> scores
//             -> caption … -> final -> (play again) lobby
// The server is the only source of truth; clients get a personalised state.
// ---------------------------------------------------------------------------

const REVEAL_MS = 3500;
const SCORES_MS = 12000;
const EMPTY_ROOM_TTL = 10 * 60 * 1000;
const HOST_GRACE_MS = 12 * 1000;
const JOIN_LATE_MIN_MS = 15 * 1000;
const RECONNECT_GRACE_MS = 10 * 1000;
const PUBLIC_START_MS = 12 * 1000; // public room: wait this long for matched players
const PUBLIC_ALL_HERE_MS = 3500; // …or start soon once everybody arrived
const PUBLIC_RESTART_MS = 20 * 1000; // public room: next game starts automatically
const RESERVE_MS = 25 * 1000; // a matched player's seat is kept this long
const HUNT_MAX_ATTEMPTS = 12; // searches per player per round (incl. ones without results)
const SWAP_ALL_DONE_MS = 2500; // swap round: everybody picked something -> continue shortly after
const SWAP_MAX_SEARCHES = 30; // swap round: searches per player per round

const rooms = new Map();

const now = () => Date.now();
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += ROOM_CODE_CHARS[crypto.randomInt(ROOM_CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('could not create room code');
}

// rooms that belong to a Discord Activity instance: instanceId -> code
const activityRooms = new Map();

export function createRoom({ game = 'classic', isPublic = false, activity = null, channel = 'stable' } = {}) {
  const cfg = getConfig();
  if (rooms.size >= cfg.maxRooms) return null;
  const code = newCode();
  const allowed = isPublic ? PUBLIC_GAME_IDS : GAME_IDS;
  const settings = presetFor(allowed.includes(game) ? game : 'classic');
  if (isPublic) settings.maxPlayers = cfg.matchMax;
  const room = {
    code,
    // release channel of whoever opened the room ('stable' | 'beta', see lib/features.js)
    channel,
    createdAt: now(),
    hostId: null,
    isPublic,
    reserved: new Map(), // pid -> time (public rooms: seats for matched players)
    players: new Map(),
    banned: new Set(),
    settings,
    packItems: null,
    files: new Set(), // uploaded files of swap rounds (deleted with the room)
    phase: 'lobby',
    round: 0,
    deadline: 0,
    timer: null,
    cleanupTimer: null,
    hostTimer: null,
    usedMedia: new Set(),
    current: null, // current round data
    history: [], // finished rounds: [{ round, entries: [{pid, meme, points, avg}] }]
    tally: new Map(),
    // Discord Activity: { instanceId, guildId, channelId, allowed: Set<userId> }
    activity,
  };
  rooms.set(code, room);
  if (activity) activityRooms.set(activity.instanceId, code);
  scheduleCleanup(room);
  return room;
}

/**
 * The one room of a Discord Activity instance (created on first use).
 * `userId` is allowed to join it from now on.
 */
export function activityRoom({ instanceId, guildId = null, channelId = null, userId }) {
  let room = rooms.get(activityRooms.get(instanceId) || '');
  if (!room || room.activity?.instanceId !== instanceId) {
    room = createRoom({ game: 'classic', activity: { instanceId, guildId, channelId, allowed: new Set() } });
    if (!room) return null;
    recordActivity('discord');
  }
  room.activity.allowed.add(userId);
  return room;
}

export function roomInfo(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  // activity rooms can only be joined from inside Discord
  if (!room || room.activity) return { exists: false };
  const connected = [...room.players.values()].filter((p) => p.connected).length;
  return {
    exists: true,
    phase: room.phase,
    players: connected,
    game: room.settings.game,
    public: room.isPublic,
    full: connected >= room.settings.maxPlayers,
  };
}

// --- public rooms (used by the matchmaker) ------------------------------------

const openReservations = (room) => {
  const t = now();
  let n = 0;
  for (const [pid, at] of room.reserved) {
    if (room.players.get(pid)?.connected) continue;
    if (t - at < RESERVE_MS) n++;
    else room.reserved.delete(pid);
  }
  return n;
};

/** a public room of this game mode with a free seat (games that are about to end are skipped) */
export function findPublicRoom(game) {
  let best = null;
  let bestScore = -1;
  for (const room of rooms.values()) {
    if (!room.isPublic || room.settings.game !== game) continue;
    const joinable =
      room.phase === 'lobby' ||
      room.phase === 'final' ||
      (['caption', 'vote', 'scores', 'starting'].includes(room.phase) && room.round < room.settings.rounds);
    if (!joinable) continue;
    const taken = connectedPlayers(room).length + openReservations(room);
    if (taken === 0 || taken >= room.settings.maxPlayers) continue;
    // prefer lobbies that are about to start, then fuller rooms
    const score = (room.phase === 'lobby' ? 100 : 0) + taken;
    if (score > bestScore) {
      best = room;
      bestScore = score;
    }
  }
  return best;
}

export function reserveSeat(room, pid) {
  room.reserved.set(pid, now());
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  scheduleCleanup(room);
}

export function publicStats(game) {
  let players = 0;
  let roomsOpen = 0;
  for (const r of rooms.values()) {
    if (!r.isPublic || (game && r.settings.game !== game)) continue;
    roomsOpen++;
    players += connectedPlayers(r).length;
  }
  return { players, rooms: roomsOpen };
}

const PLAYING_PHASES = new Set(['starting', 'upload', 'caption', 'vote', 'scores']);

export function stats() {
  let players = 0;
  let playing = 0;
  let publicRooms = 0;
  let discordRooms = 0;
  for (const r of rooms.values()) {
    let n = 0;
    for (const p of r.players.values()) if (p.connected) n++;
    players += n;
    if (n && PLAYING_PHASES.has(r.phase)) playing++;
    if (r.isPublic) publicRooms++;
    if (r.activity) discordRooms++;
  }
  return { rooms: rooms.size, players, playing, publicRooms, discordRooms };
}

// --- helpers ---------------------------------------------------------------

const connectedPlayers = (room) => [...room.players.values()].filter((p) => p.connected);
// players who dropped a few seconds ago (phone locked, page reload) still count as present
const presentPlayers = (room) =>
  [...room.players.values()].filter((p) => p.connected || now() - (p.disconnectedAt || 0) < RECONNECT_GRACE_MS);

// per-game counters for players with an account (written to the database at the end)
function tally(room, pid) {
  let t = room.tally.get(pid);
  if (!t) {
    t = { rounds: 0, roundWins: 0, memes: 0, votes: 0 };
    room.tally.set(pid, t);
  }
  return t;
}

function safely(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[game] ${label} failed:`, err.message);
    return null;
  }
}

function clearTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function setPhaseTimer(room, ms, fn) {
  clearTimer(room);
  room.deadline = now() + ms;
  room.timer = setTimeout(() => {
    room.timer = null;
    try {
      fn();
    } catch (err) {
      console.error('[game] timer error', err);
    }
  }, ms);
}

function scheduleCleanup(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    if (!connectedPlayers(room).length) destroyRoom(room);
  }, EMPTY_ROOM_TTL);
  room.cleanupTimer.unref?.();
}

function dropRoomFiles(room, keep = new Set()) {
  for (const rel of room.files) {
    if (keep.has(rel)) continue;
    removeFile(rel);
    room.files.delete(rel);
  }
}

function destroyRoom(room) {
  dropRoomFiles(room);
  clearTimer(room);
  if (room.hostTimer) clearTimeout(room.hostTimer);
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  rooms.delete(room.code);
  if (room.activity && activityRooms.get(room.activity.instanceId) === room.code) activityRooms.delete(room.activity.instanceId);
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function publicMedia(m) {
  if (!m) return null;
  return {
    id: m.id,
    kind: m.kind,
    src: m.local ? m.url : proxyUrl(m.url),
    width: m.width,
    height: m.height,
    title: m.title,
    source: m.source,
    link: m.link,
    animated: m.animated || undefined,
  };
}

function ensureHost(room) {
  if (room.isPublic) {
    room.hostId = null;
    return;
  }
  const host = room.players.get(room.hostId);
  if (host?.connected) return;
  const next = connectedPlayers(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (next) room.hostId = next.id;
}

// --- state for one player ---------------------------------------------------

function stateFor(room, pid) {
  const cur = room.current;
  const players = [...room.players.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      username: p.username || null,
      score: p.score,
      connected: p.connected,
      submitted:
        room.phase === 'caption'
          ? Boolean(cur?.subs.get(p.id)?.submitted)
          : room.phase === 'upload'
            ? Boolean(cur?.contribs?.has(p.id))
            : undefined,
      playing: room.phase === 'caption' ? Boolean(cur?.subs.has(p.id)) : room.phase === 'upload' ? true : undefined,
      // no per-player "voted" flag: the one player who never votes would be the author
      lastPoints: p.lastPoints,
    }));

  const s = {
    code: room.code,
    you: pid,
    hostId: room.isPublic ? null : room.hostId,
    isPublic: room.isPublic,
    activity: Boolean(room.activity),
    phase: room.phase,
    round: room.round,
    settings: room.settings,
    deadline: room.deadline,
    serverNow: now(),
    minPlayers: getConfig().minPlayers,
    players,
  };

  if (room.phase === 'upload' && cur) {
    const mine = cur.contribs.get(pid);
    s.upload = {
      mine: mine ? { media: publicMedia(mine.media), auto: Boolean(mine.auto), uploaded: Boolean(mine.media.roomUpload) } : null,
      done: [...cur.contribs.keys()].filter((id) => room.players.get(id)?.connected).length,
      total: connectedPlayers(room).length,
      endingSoon: Boolean(cur.endingSoon),
    };
  }

  if (room.phase === 'caption' && cur) {
    const mine = cur.subs.get(pid);
    s.caption = mine
      ? {
          media: publicMedia(mine.media),
          captions: mine.captions,
          submitted: mine.submitted,
          rerollsLeft: mine.rerollsLeft,
          draftVersion: mine.draftVersion,
          swapped: Boolean(mine.from && mine.from !== pid),
          hunt:
            room.settings.game === 'hunt'
              ? { searchesLeft: mine.searchesLeft, max: getConfig().huntSearches, query: mine.query, searching: Boolean(mine.searching) }
              : undefined,
        }
      : { spectator: true };
  }

  if (room.phase === 'vote' && cur?.voteItem) {
    const item = cur.voteItem;
    const entry = cur.subs.get(item.pid);
    const revealed = item.stage === 'reveal';
    s.vote = {
      index: cur.voteIndex,
      total: cur.voteOrder.length,
      stage: item.stage,
      meme: { media: publicMedia(entry.media), captions: entry.captions, query: entry.query || null },
      isMine: item.pid === pid,
      myScore: item.votes.get(pid) ?? null,
      votes: item.votes.size,
      voters: connectedPlayers(room).filter((p) => p.id !== item.pid).length,
      // who made the meme stays secret until the round is over (scores phase)
      points: revealed ? item.points : null,
      avg: revealed ? item.avg : null,
    };
  }

  if (room.phase === 'scores' && cur) {
    s.results = cur.results.map((r) => ({
      pid: r.pid,
      from: r.from || null,
      points: r.points,
      avg: r.avg,
      galleryId: r.galleryId || null,
      meme: { media: publicMedia(r.media), captions: r.captions, query: r.query || null },
    }));
    s.lastRound = room.round >= room.settings.rounds;
  }

  if (room.phase === 'final') {
    const best = [];
    for (const h of room.history) {
      for (const e of h.entries) best.push({ round: h.round, ...e });
    }
    best.sort((a, b) => b.points - a.points || b.avg - a.avg);
    s.final = {
      best: best.slice(0, 8).map((e) => ({
        round: e.round,
        pid: e.pid,
        from: e.from || null,
        points: e.points,
        avg: e.avg,
        galleryId: e.galleryId || null,
        meme: { media: publicMedia(e.media), captions: e.captions, query: e.query || null },
      })),
      totalMemes: best.length,
    };
  }
  return s;
}

function sendState(room, p) {
  if (!p?.sockets.size) return;
  const msg = JSON.stringify({ t: 'state', state: stateFor(room, p.id) });
  for (const ws of p.sockets) if (ws.readyState === 1) ws.send(msg);
}

function broadcast(room) {
  for (const p of room.players.values()) sendState(room, p);
}

function sendToPlayer(p, msg) {
  for (const ws of p?.sockets || []) send(ws, msg);
}

function broadcastRaw(room, msg) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) for (const ws of p.sockets) if (ws.readyState === 1) ws.send(data);
}

// --- phases ----------------------------------------------------------------

/** 'image' | 'video' | 'any' for this player, based on the room setting */
function kindFor(room, pid) {
  if (room.players.get(pid)?.noVideo) return 'image';
  const mode = room.settings.mode;
  return mode === 'images' ? 'image' : mode === 'videos' ? 'video' : 'any';
}

const randomOf = (list) => list[crypto.randomInt(list.length)];

function pickFromPack(room, kind) {
  const items = room.packItems.filter((m) => !isBroken(m.url));
  if (!items.length) return null;
  const ofKind = kind === 'any' ? items : items.filter((m) => m.kind === kind);
  const list = ofKind.length ? ofKind : items;
  const fresh = list.filter((m) => !room.usedMedia.has(m.id));
  return randomOf(fresh.length ? fresh : list);
}

function assignMedia(room, sub) {
  let kind = kindFor(room, sub.pid);
  let media = room.packItems?.length ? pickFromPack(room, kind) : null;
  if (!media) {
    if (kind === 'any') kind = Math.random() < 0.5 ? 'image' : 'video';
    media = pickMedia(kind, room.usedMedia);
  }
  room.usedMedia.add(media.id);
  warmMedia(media.url);
  sub.media = media;
}

const isHunt = (room) => room.settings.game === 'hunt';
const isSwap = (room) => room.settings.game === 'swap';

function addToRound(room, player, preset = null) {
  const sub = {
    pid: player.id,
    media: null,
    captions: [],
    submitted: false,
    rerollsLeft: room.settings.game === 'classic' ? room.settings.rerolls : 0,
    draftVersion: 0,
    // GIF Hunt: the player searches the media themselves
    searchesLeft: isHunt(room) ? getConfig().huntSearches : 0,
    searchAttempts: 0,
    searching: false,
    query: '',
    results: [],
    from: null, // swap round: who brought the picture
  };
  if (preset) {
    sub.media = preset.media;
    sub.from = preset.from;
    room.usedMedia.add(preset.media.id);
    if (!preset.media.local) warmMedia(preset.media.url);
  } else if (!isHunt(room)) {
    assignMedia(room, sub);
  }
  room.current.subs.set(player.id, sub);
}

async function runHuntSearch(room, sub, player, q, random) {
  const cur = room.current;
  const kind = kindFor(room, player.id);
  let items = [];
  if (!random) {
    try {
      items = await searchMedia(q, { kind });
    } catch (err) {
      console.warn('[hunt] search failed', err.message);
    }
  }
  sub.searching = false;
  // the round may have moved on while we were searching
  if (room.current !== cur || room.phase !== 'caption' || cur.subs.get(player.id) !== sub || sub.submitted || !rooms.has(room.code)) {
    return;
  }
  let pool = items.filter((i) => !room.usedMedia.has(i.id) && !isBroken(i.url));
  if (!pool.length) pool = items.filter((i) => !isBroken(i.url));
  if (!random && !pool.length) {
    sendToPlayer(player, { t: 'error', code: 'search_empty' });
    return sendState(room, player);
  }
  let media;
  if (random) {
    media = pickMedia(kind === 'any' ? (Math.random() < 0.5 ? 'image' : 'video') : kind, room.usedMedia);
  } else {
    media = randomOf(pool.slice(0, 24));
  }
  sub.media = media;
  sub.query = random ? '' : q;
  sub.results = pool.filter((i) => i.id !== media.id).slice(0, 30);
  sub.searchesLeft -= 1;
  sub.draftVersion += 1;
  room.usedMedia.add(media.id);
  warmMedia(media.url);
  broadcast(room);
}

async function startGame(room) {
  if (room.phase !== 'lobby') return;
  clearTimer(room);
  room.phase = 'starting';
  room.deadline = 0;
  room.packItems = null;
  if (room.settings.pack && !isHunt(room)) {
    const items = safely('load pack', () => packItemsForGame(room.settings.pack.id)) || [];
    if (items.length) {
      room.packItems = items;
      safely('count play', () => countPackPlay(room.settings.pack.id));
    } else {
      room.settings = { ...room.settings, pack: null };
    }
  }
  broadcast(room);
  await mediaReady(8000);
  if (room.phase !== 'starting' || !rooms.has(room.code)) return;
  if (room.isPublic && connectedPlayers(room).length < 2) {
    room.phase = 'lobby';
    broadcast(room);
    return;
  }
  for (const p of room.players.values()) {
    p.score = 0;
    p.lastPoints = 0;
  }
  room.round = 0;
  room.history = [];
  room.tally = new Map();
  dropRoomFiles(room);
  startRound(room);
}

function startRound(room) {
  room.round += 1;
  safely('activity', () => recordActivity(`round:${room.settings.game}`));
  room.current = { subs: new Map(), voteOrder: [], voteIndex: -1, voteItem: null, results: [], endingSoon: false, contribs: new Map() };
  if (isSwap(room)) {
    // swap round: first everybody brings a picture
    room.phase = 'upload';
    setPhaseTimer(room, room.settings.uploadTime * 1000, () => endUpload(room));
    room.current.uploadDeadline = room.deadline;
    broadcast(room);
    return;
  }
  beginCaption(room);
}

function beginCaption(room) {
  room.phase = 'caption';
  for (const p of connectedPlayers(room)) if (!room.current.subs.has(p.id)) addToRound(room, p);
  setPhaseTimer(room, room.settings.captionTime * 1000, () => endCaption(room));
  room.current.captionDeadline = room.deadline;
  broadcast(room);
}

// --- swap round -----------------------------------------------------------------

function setContribution(room, player, media, extra = {}) {
  const cur = room.current;
  const old = cur.contribs.get(player.id);
  if (old?.media.roomUpload && old.rel) {
    removeFile(old.rel);
    room.files.delete(old.rel);
  }
  cur.contribs.set(player.id, { media, from: player.id, ...extra });
  broadcast(room);
  maybeEndUploadEarly(room);
}

function maybeEndUploadEarly(room) {
  const cur = room.current;
  if (room.phase !== 'upload' || !cur || cur.endingSoon) return;
  const present = presentPlayers(room);
  if (present.length && present.every((p) => cur.contribs.has(p.id))) {
    cur.endingSoon = true;
    setPhaseTimer(room, SWAP_ALL_DONE_MS, () => endUpload(room));
    broadcast(room);
  }
}

function cancelEarlyUploadEnd(room) {
  const cur = room.current;
  if (room.phase !== 'upload' || !cur?.endingSoon) return;
  cur.endingSoon = false;
  const left = cur.uploadDeadline - now();
  setPhaseTimer(room, Math.max(1000, left), () => endUpload(room));
}

function endUpload(room) {
  if (room.phase !== 'upload') return;
  const cur = room.current;
  const players = presentPlayers(room);
  // players without a picture get a random template to pass on
  for (const p of players) {
    if (!cur.contribs.has(p.id)) {
      const kind = kindFor(room, p.id);
      const media = pickMedia(kind === 'any' ? (Math.random() < 0.5 ? 'image' : 'video') : kind, room.usedMedia);
      cur.contribs.set(p.id, { media, from: p.id, auto: true });
    }
  }
  // everybody captions the picture of the next player in a random circle -> nobody gets their own
  const order = shuffle(players.map((p) => p.id));
  order.forEach((pid, i) => {
    const giver = order[(i + 1) % order.length];
    const c = cur.contribs.get(giver);
    const player = room.players.get(pid);
    if (player && c) addToRound(room, player, { media: c.media, from: c.auto ? null : giver });
  });
  cur.endingSoon = false;
  room.phase = 'caption';
  beginCaption(room);
}

/** file upload of a swap round (HTTP, not WebSocket) */
export async function handleRoomUpload(code, pid, secret, file) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) throw new HttpError(404, 'room_not_found');
  const player = room.players.get(pid);
  if (!player || !safeEqual(player.secret, secret)) throw new HttpError(403, 'bad_request');
  if (player.restricted || activeSanction({ userId: player.userId, pid: player.id, ipHash: player.ipHash })) {
    throw new HttpError(403, 'restricted');
  }
  if (!isSwap(room) || room.phase !== 'upload') throw new HttpError(409, 'wrong_phase');
  const stored = await storeFile('rooms', file.buf, file.info);
  // the phase may have ended while the file was written
  if (!rooms.has(room.code) || room.phase !== 'upload' || !room.players.has(pid)) {
    removeFile(stored.rel);
    throw new HttpError(409, 'wrong_phase');
  }
  room.files.add(stored.rel);
  safely('activity', () => recordActivity('upload'));
  const media = uploadMedia({ id: stored.id, url: stored.url, thumb: stored.thumb, info: file.info, name: file.name, room: true });
  setContribution(room, player, media, { rel: stored.rel });
  return { ok: true };
}

function maybeEndCaptionEarly(room) {
  const cur = room.current;
  if (room.phase !== 'caption' || cur.endingSoon) return;
  const active = presentPlayers(room).filter((p) => cur.subs.has(p.id));
  if (active.length && active.every((p) => cur.subs.get(p.id).submitted)) {
    cur.endingSoon = true;
    setPhaseTimer(room, 1500, () => endCaption(room));
    broadcast(room);
  }
}

function cancelEarlyEnd(room) {
  const cur = room.current;
  if (room.phase !== 'caption' || !cur?.endingSoon) return;
  cur.endingSoon = false;
  const left = cur.captionDeadline - now();
  if (left > 0) setPhaseTimer(room, left, () => endCaption(room));
}

function endCaption(room) {
  if (room.phase !== 'caption') return;
  const cur = room.current;
  // unsent drafts with text count as submitted
  const entries = [...cur.subs.values()].filter((s) => s.media && hasText(s.captions));
  for (const sub of cur.subs.values()) tally(room, sub.pid).rounds += 1;
  for (const e of entries) tally(room, e.pid).memes += 1;
  cur.voteOrder = shuffle(entries.map((e) => e.pid));
  cur.voteIndex = -1;
  if (!cur.voteOrder.length) return endVote(room);
  room.phase = 'vote';
  nextVoteItem(room);
}

function nextVoteItem(room) {
  const cur = room.current;
  cur.voteIndex += 1;
  if (cur.voteIndex >= cur.voteOrder.length) return endVote(room);
  const pid = cur.voteOrder[cur.voteIndex];
  cur.voteItem = { pid, stage: 'rating', votes: new Map(), points: 0, avg: 0, endingSoon: false };
  const voters = connectedPlayers(room).filter((p) => p.id !== pid);
  const ms = voters.length ? room.settings.voteTime * 1000 : 2500;
  setPhaseTimer(room, ms, () => revealVoteItem(room));
  broadcast(room);
}

function maybeRevealEarly(room) {
  const item = room.current?.voteItem;
  if (room.phase !== 'vote' || !item || item.stage !== 'rating' || item.endingSoon) return;
  const voters = presentPlayers(room).filter((p) => p.id !== item.pid);
  if (voters.length && voters.every((p) => item.votes.has(p.id))) {
    item.endingSoon = true;
    setPhaseTimer(room, 900, () => revealVoteItem(room));
  }
}

function revealVoteItem(room) {
  const cur = room.current;
  const item = cur?.voteItem;
  if (room.phase !== 'vote' || !item || item.stage !== 'rating') return;
  const scores = [...item.votes.values()];
  item.points = scores.reduce((a, b) => a + b, 0);
  item.avg = scores.length ? Math.round((item.points / scores.length) * 10) / 10 : 0;
  item.stage = 'reveal';
  const author = room.players.get(item.pid);
  // points are added to the scoreboard only in endVote - otherwise the jumping score gives the author away
  for (const voter of item.votes.keys()) tally(room, voter).votes += 1;
  const sub = cur.subs.get(item.pid);
  cur.results.push({
    pid: item.pid,
    userId: author?.userId || null,
    points: item.points,
    avg: item.avg,
    votes: scores.length,
    media: sub.media,
    captions: sub.captions,
    query: sub.query || null,
    from: sub.from || null,
  });
  setPhaseTimer(room, REVEAL_MS, () => nextVoteItem(room));
  broadcast(room);
}

function endVote(room) {
  const cur = room.current;
  cur.voteItem = null;
  cur.results.sort((a, b) => b.points - a.points || b.avg - a.avg);
  for (const p of room.players.values()) p.lastPoints = 0;
  for (const r of cur.results) {
    const p = room.players.get(r.pid);
    if (p) {
      p.score += r.points;
      p.lastPoints = r.points;
    }
  }
  const top = cur.results[0];
  if (top && top.points > 0) {
    tally(room, top.pid).roundWins += 1;
    const players = presentPlayers(room).length;
    if (top.userId) {
      top.galleryId = safely('save meme', () =>
        saveWinningMeme({
          userId: top.userId,
          media: top.media,
          captions: top.captions,
          points: top.points,
          avg: top.avg,
          votes: top.votes,
          players,
        }),
      );
    }
  }
  room.history.push({ round: room.round, entries: cur.results.map((r) => ({ ...r })) });
  room.phase = 'scores';
  const last = room.round >= room.settings.rounds;
  setPhaseTimer(room, SCORES_MS, () => (last ? endGame(room) : startRound(room)));
  broadcast(room);
}

function recordGame(room) {
  const participants = [...room.tally.keys()].filter((pid) => room.tally.get(pid).rounds > 0).length;
  const best = Math.max(0, ...[...room.players.values()].map((p) => p.score));
  const byUser = new Map();
  for (const p of room.players.values()) {
    if (!p.userId) continue;
    const t = room.tally.get(p.id) || { rounds: 0, roundWins: 0, memes: 0, votes: 0 };
    const row = {
      userId: p.userId,
      points: p.score,
      won: best > 0 && p.score === best,
      rounds: t.rounds,
      roundWins: t.roundWins,
      memes: t.memes,
      votes: t.votes,
    };
    const prev = byUser.get(p.userId);
    if (!prev || row.points > prev.points) byUser.set(p.userId, row);
  }
  safely('save results', () => saveGameResults([...byUser.values()], participants));
}

function endGame(room) {
  clearTimer(room);
  if (room.phase !== 'final') {
    recordGame(room);
    safely('activity', () => recordActivity(`game:${room.settings.game}`));
  }
  room.phase = 'final';
  room.deadline = 0;
  if (room.isPublic) {
    // public rooms keep going: next game starts by itself
    setPhaseTimer(room, PUBLIC_RESTART_MS, () => backToLobby(room));
  }
  broadcast(room);
  if (room.isPublic) onPublicRoomChanged(room.settings.game);
}

function backToLobby(room) {
  clearTimer(room);
  dropRoomFiles(room);
  room.phase = 'lobby';
  room.round = 0;
  room.deadline = 0;
  room.current = null;
  for (const p of room.players.values()) {
    p.score = 0;
    p.lastPoints = 0;
  }
  // forget players that left
  for (const [id, p] of room.players) if (!p.connected) room.players.delete(id);
  ensureHost(room);
  broadcast(room);
  checkPublicStart(room);
}

/** public rooms start by themselves once the matched players are here */
function checkPublicStart(room) {
  if (!room.isPublic || room.phase !== 'lobby' || !rooms.has(room.code)) return;
  const n = connectedPlayers(room).length;
  if (n < 2) {
    if (room.timer) {
      clearTimer(room);
      room.deadline = 0;
      broadcast(room);
    }
    return;
  }
  const waiting = openReservations(room);
  const ms = waiting === 0 || n >= room.settings.maxPlayers ? PUBLIC_ALL_HERE_MS : PUBLIC_START_MS;
  const at = now() + ms;
  if (room.timer && room.deadline <= at) return; // an earlier start is already planned
  setPhaseTimer(room, ms, () => {
    if (connectedPlayers(room).length >= 2) startGame(room).catch((e) => console.error('[game] start failed', e));
    else {
      room.deadline = 0;
      broadcast(room);
    }
  });
  broadcast(room);
}

// --- connection handling ----------------------------------------------------

function handleHello(ws, msg) {
  const code = String(msg.code || '').toUpperCase();
  const room = rooms.get(code);
  if (!ROOM_CODE_RE.test(code) || !room) return send(ws, { t: 'error', code: 'room_not_found' });
  const pid = String(msg.pid || '');
  const secret = String(msg.secret || '');
  if (!/^[a-zA-Z0-9_-]{8,40}$/.test(pid) || secret.length < 16 || secret.length > 80) {
    return send(ws, { t: 'error', code: 'bad_request' });
  }
  // Discord Activity rooms: only accounts that opened this activity instance
  if (room.activity && !(ws.account && room.activity.allowed.has(ws.account.id))) return send(ws, { t: 'error', code: 'room_not_found' });
  if (room.banned.has(pid)) return send(ws, { t: 'error', code: 'kicked' });
  leaveQueue(ws);
  const sanction = activeSanction({ userId: ws.account?.id, pid, ipHash: ws.ipHash });
  if (sanction?.type === 'ban') return send(ws, { t: 'error', code: 'banned', sanction });
  if (sanction && room.isPublic) return send(ws, { t: 'error', code: 'restricted', sanction });
  const account = ws.account;
  if (account && room.bannedUsers?.has(account.id)) return send(ws, { t: 'error', code: 'kicked' });
  const name = account ? sanitizeName(account.displayName) || account.username : sanitizeName(msg.name);
  if (!name) return send(ws, { t: 'error', code: 'name_required' });
  const avatar = sanitizeAvatar(account ? account.avatar : msg.avatar);
  if (account) {
    const twin = [...room.players.values()].find((p) => p.userId === account.id && p.id !== pid && p.connected);
    if (twin) return send(ws, { t: 'error', code: 'already_in_room' });
  }

  let player = room.players.get(pid);
  if (player) {
    if (!safeEqual(player.secret, secret)) return send(ws, { t: 'error', code: 'bad_request' });
  } else {
    const seats = room.settings.maxPlayers - (room.reserved.has(pid) ? 0 : openReservations(room));
    if (connectedPlayers(room).length >= seats) return send(ws, { t: 'error', code: 'room_full' });
    player = {
      id: pid,
      secret,
      name,
      avatar,
      score: 0,
      lastPoints: 0,
      connected: false,
      sockets: new Set(),
      joinedAt: now(),
    };
    room.players.set(pid, player);
  }
  // make names unique inside the room
  const taken = new Set([...room.players.values()].filter((p) => p.id !== pid).map((p) => p.name.toLowerCase()));
  let finalName = name;
  for (let i = 2; taken.has(finalName.toLowerCase()); i++) finalName = `${name.slice(0, 17)} ${i}`;
  player.name = finalName;
  player.avatar = avatar;
  player.userId = account?.id || null;
  player.username = account?.username || null;
  player.ipHash = ws.ipHash || null;
  player.restricted = Boolean(sanction);
  if (player.nameLocked && !account) player.name = player.lockedName || player.name;
  player.sockets.add(ws);
  player.connected = true;
  player.disconnectedAt = 0;
  ws.room = room;
  ws.player = player;

  room.reserved.delete(pid);
  if (room.isPublic) room.hostId = null;
  else if (!room.hostId || !room.players.has(room.hostId)) room.hostId = pid;
  else if (room.hostId !== pid && !room.players.get(room.hostId).connected && !room.hostTimer) ensureHost(room);
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);

  // joining while a round is running
  if (room.phase === 'caption' && room.current && !room.current.subs.has(pid) && room.deadline - now() > JOIN_LATE_MIN_MS) {
    addToRound(room, player);
  }
  if (room.phase === 'caption' && room.current?.subs.has(pid) && !room.current.subs.get(pid).submitted) cancelEarlyEnd(room);
  if (room.phase === 'upload' && !room.current?.contribs.has(pid)) cancelEarlyUploadEnd(room);
  send(ws, { t: 'welcome', pid, code: room.code });
  broadcast(room);
  checkPublicStart(room);
}

function handleClose(ws) {
  leaveQueue(ws);
  const { room, player } = ws;
  if (!room || !player) return;
  player.sockets.delete(ws);
  if (player.sockets.size) return;
  player.connected = false;
  player.disconnectedAt = now();
  if (!rooms.has(room.code)) return;
  // re-check once the reconnect grace period is over
  setTimeout(() => {
    if (!player.connected && rooms.has(room.code)) {
      maybeEndCaptionEarly(room);
      maybeRevealEarly(room);
      maybeEndUploadEarly(room);
    }
  }, RECONNECT_GRACE_MS + 100).unref?.();
  if (room.phase === 'lobby') {
    // in the lobby a leaving player simply disappears (after a short grace period for reloads)
    setTimeout(() => {
      if (!player.connected && room.phase === 'lobby' && room.players.get(player.id) === player) {
        room.players.delete(player.id);
        ensureHost(room);
        broadcast(room);
      }
    }, HOST_GRACE_MS).unref?.();
  }
  if (room.hostId === player.id) {
    if (room.hostTimer) clearTimeout(room.hostTimer);
    room.hostTimer = setTimeout(() => {
      room.hostTimer = null;
      if (!player.connected) {
        ensureHost(room);
        broadcast(room);
      }
    }, HOST_GRACE_MS);
    room.hostTimer.unref?.();
  }
  if (!connectedPlayers(room).length) {
    scheduleCleanup(room);
    if (room.isPublic && room.phase === 'lobby') checkPublicStart(room);
    return;
  }
  maybeEndCaptionEarly(room);
  maybeRevealEarly(room);
  maybeEndUploadEarly(room);
  broadcast(room);
}

const isHost = (ws) => Boolean(ws.room && !ws.room.isPublic && ws.room.hostId === ws.player?.id);

function removePlayer(room, target, msg) {
  room.players.delete(target.id);
  room.reserved.delete(target.id);
  for (const s of target.sockets) {
    send(s, msg);
    s.room = null;
    s.player = null;
  }
  target.sockets.clear();
  target.connected = false;
  const cur = room.current;
  if (room.phase === 'caption') cur?.subs?.delete(target.id);
  if (room.phase === 'upload') cur?.contribs?.delete(target.id);
  ensureHost(room);
  maybeEndCaptionEarly(room);
  maybeRevealEarly(room);
  maybeEndUploadEarly(room);
  if (!connectedPlayers(room).length) scheduleCleanup(room);
  broadcast(room);
  if (room.isPublic) {
    checkPublicStart(room);
    onPublicRoomChanged(room.settings.game);
  }
}

// --- moderation (live actions from the admin panel) -----------------------------------

// IP matches only hit guests – accounts on the same network are not affected
const matchesWho = (p, who) =>
  Boolean((who.userId && p.userId === who.userId) || (who.pid && p.id === who.pid) || (who.ipHash && !p.userId && p.ipHash === who.ipHash));

function eachPlayer(who, fn) {
  let n = 0;
  for (const room of [...rooms.values()]) {
    for (const p of [...room.players.values()]) {
      if (matchesWho(p, who)) {
        fn(room, p);
        n++;
      }
    }
  }
  return n;
}

setLiveHooks({
  applySanction(who, sanction) {
    const code = sanction.type === 'ban' ? 'banned' : 'restricted';
    removeQueued(who, { t: 'error', code, sanction });
    return eachPlayer(who, (room, p) => {
      if (sanction.type === 'ban' || room.isPublic) removePlayer(room, p, { t: 'error', code, sanction });
      else {
        p.restricted = true;
        sendToPlayer(p, { t: 'sanction', sanction });
      }
    });
  },
  forceRename(who, name) {
    return eachPlayer(who, (room, p) => {
      const taken = new Set([...room.players.values()].filter((x) => x !== p).map((x) => x.name.toLowerCase()));
      let finalName = name;
      for (let i = 2; taken.has(finalName.toLowerCase()); i++) finalName = `${name} ${i}`;
      p.name = finalName;
      p.nameLocked = true;
      p.lockedName = finalName;
      sendToPlayer(p, { t: 'force_name', name });
      broadcast(room);
    });
  },
  kick(who) {
    return eachPlayer(who, (room, p) => {
      room.banned.add(p.id);
      removePlayer(room, p, { t: 'error', code: 'kicked_mod' });
    });
  },
  findOnline(who) {
    const out = [];
    eachPlayer(who, (room, p) => {
      if (p.connected) out.push({ code: room.code, phase: room.phase, name: p.name, public: room.isPublic, game: room.settings.game });
    });
    return out;
  },
  playerInfo({ pid }) {
    for (const room of rooms.values()) {
      const p = room.players.get(pid);
      if (p) return { name: p.name, ipHash: p.ipHash, userId: p.userId };
    }
    return null;
  },
});

function memeContext(entry) {
  if (!entry?.media) return null;
  const m = publicMedia(entry.media);
  return { media: { kind: m.kind, src: m.src, animated: m.animated, title: m.title }, captions: entry.captions, query: entry.query || null };
}

function handleReport(ws, room, player, msg) {
  const cur = room.current;
  let target = null;
  let context = null;
  if (msg.target === 'vote') {
    // the reporter does not learn who made the meme
    const item = cur?.voteItem;
    if (room.phase !== 'vote' || !item) return;
    target = room.players.get(item.pid) || null;
    context = memeContext(cur.subs.get(item.pid));
  } else if (msg.target === 'result') {
    const round = Number(msg.round) || room.round;
    const list = round === room.round && cur?.results?.length ? cur.results : room.history.find((h) => h.round === round)?.entries || [];
    const entry = list.find((e) => e.pid === String(msg.pid));
    if (!entry) return;
    target = room.players.get(entry.pid) || null;
    context = memeContext(entry);
  } else {
    target = room.players.get(String(msg.pid)) || null;
  }
  if (!target) return send(ws, { t: 'error', code: 'report_gone' });
  const reason = String(msg.reason || '');
  createReport({
    reporter: { userId: player.userId, pid: player.id, ipHash: player.ipHash, name: player.name },
    target: { userId: target.userId, pid: target.id, ipHash: target.ipHash, name: target.name, avatar: target.avatar },
    reason,
    comment: msg.comment,
    roomCode: room.code,
    context: reason === 'name' || reason === 'harassment' || reason === 'spam' ? null : context,
  })
    .then(() => send(ws, { t: 'reported' }))
    .catch((err) => send(ws, { t: 'error', code: err.code || 'report_failed' }));
}

function handleMessage(ws, msg) {
  if (msg.t === 'hello') return handleHello(ws, msg);
  if (msg.t === 'ping') return send(ws, { t: 'pong', serverNow: now() });
  if (msg.t === 'queue' || msg.t === 'unqueue') return handleMatchmaking(ws, msg);
  const { room, player } = ws;
  if (!room || !player || !rooms.has(room.code)) return send(ws, { t: 'error', code: 'not_joined' });
  const cur = room.current;

  switch (msg.t) {
    case 'profile': {
      if (player.userId) return undefined; // name & avatar come from the account
      if (player.restricted || player.nameLocked) return send(ws, { t: 'error', code: 'name_locked' });
      const name = sanitizeName(msg.name);
      if (name) {
        const taken = [...room.players.values()].some((p) => p.id !== player.id && p.name.toLowerCase() === name.toLowerCase());
        if (!taken) player.name = name;
      }
      if (msg.avatar) player.avatar = sanitizeAvatar(msg.avatar);
      return broadcast(room);
    }
    case 'settings':
      if (!isHost(ws) || room.phase !== 'lobby') return;
      room.settings = sanitizeSettings(msg.settings, room.settings);
      return broadcast(room);
    case 'pack': {
      if (!isHost(ws) || room.phase !== 'lobby') return;
      if (!msg.id) {
        room.settings = { ...room.settings, pack: null };
        return broadcast(room);
      }
      const info = safely('pack', () => packForGame(String(msg.id), player.userId));
      if (!info || info.error) return send(ws, { t: 'error', code: info?.error || 'pack_not_found' });
      room.settings = { ...room.settings, pack: info };
      return broadcast(room);
    }
    case 'start':
      if (!isHost(ws)) return;
      if (connectedPlayers(room).length < getConfig().minPlayers) return send(ws, { t: 'error', code: 'not_enough_players' });
      startGame(room).catch((e) => console.error('[game] start failed', e));
      return;
    case 'kick': {
      if (!isHost(ws) || msg.pid === player.id) return;
      const target = room.players.get(String(msg.pid));
      if (!target) return;
      room.banned.add(target.id);
      if (target.userId) {
        room.bannedUsers = room.bannedUsers || new Set();
        room.bannedUsers.add(target.userId);
      }
      return removePlayer(room, target, { t: 'kicked' });
    }
    case 'report':
      return handleReport(ws, room, player, msg);
    case 'draft':
    case 'submit': {
      if (room.phase !== 'caption' || !cur) return;
      const sub = cur.subs.get(player.id);
      if (!sub || (sub.submitted && msg.t === 'draft')) return;
      sub.captions = sanitizeCaptions(msg.captions);
      if (msg.t === 'submit') {
        if (!sub.media) return send(ws, { t: 'error', code: 'search_first' });
        if (!hasText(sub.captions)) return send(ws, { t: 'error', code: 'empty_caption' });
        sub.submitted = true;
        sub.draftVersion += 1;
        broadcast(room);
        maybeEndCaptionEarly(room);
      }
      return;
    }
    case 'unsubmit': {
      if (room.phase !== 'caption' || !cur || cur.endingSoon) return;
      const sub = cur.subs.get(player.id);
      if (!sub) return;
      sub.submitted = false;
      return broadcast(room);
    }
    case 'reroll': {
      if (room.phase !== 'caption' || !cur) return;
      const sub = cur.subs.get(player.id);
      if (!sub || sub.submitted || sub.rerollsLeft <= 0 || isHunt(room)) return;
      sub.rerollsLeft -= 1;
      assignMedia(room, sub);
      sub.draftVersion += 1;
      return broadcast(room);
    }
    case 'broken': {
      // the browser could not show the media -> swap it without using a re-roll.
      // (files the server itself cannot fetch are blocked globally by the proxy)
      if (room.phase !== 'caption' || !cur) return;
      const sub = cur.subs.get(player.id);
      if (!sub || sub.submitted || sub.media?.id !== msg.id || (sub.brokenSwaps || 0) >= 4) return;
      sub.brokenSwaps = (sub.brokenSwaps || 0) + 1;
      if (msg.noVideo && sub.media.kind === 'video') player.noVideo = true;
      if (isHunt(room)) {
        // take the next hit of the same search (free), otherwise something random
        const kind = kindFor(room, player.id);
        const next = sub.results.find((i) => !isBroken(i.url) && (kind === 'any' || i.kind === kind));
        sub.results = sub.results.filter((i) => i !== next);
        sub.media = next || pickMedia(kind === 'any' ? 'image' : kind, room.usedMedia);
        room.usedMedia.add(sub.media.id);
        warmMedia(sub.media.url);
      } else {
        assignMedia(room, sub);
        sub.from = null;
      }
      sub.draftVersion += 1;
      return broadcast(room);
    }
    case 'search': {
      if (room.phase !== 'caption' || !cur || !isHunt(room)) return;
      const sub = cur.subs.get(player.id);
      if (!sub || sub.submitted || sub.searching) return;
      if (sub.searchesLeft <= 0) return send(ws, { t: 'error', code: 'no_searches_left' });
      const random = msg.random === true;
      const q = cleanQuery(msg.q);
      if (!random && q.length < QUERY_MIN) return send(ws, { t: 'error', code: 'search_short' });
      if (!random && isBlocked(q)) return send(ws, { t: 'error', code: 'search_blocked' });
      if (sub.searchAttempts >= HUNT_MAX_ATTEMPTS) return send(ws, { t: 'error', code: 'search_limit' });
      sub.searchAttempts += 1;
      sub.searching = true;
      sendState(room, player);
      runHuntSearch(room, sub, player, q, random).catch((err) => {
        sub.searching = false;
        console.error('[hunt]', err);
      });
      return;
    }
    case 'swap_search': {
      if (room.phase !== 'upload' || !cur || !isSwap(room)) return;
      const q = cleanQuery(msg.q);
      if (q.length < QUERY_MIN) return send(ws, { t: 'error', code: 'search_short' });
      if (isBlocked(q)) return send(ws, { t: 'error', code: 'search_blocked' });
      const t = now();
      if (t - (player.lastSwapSearch || 0) < 700) return;
      player.lastSwapSearch = t;
      player.swapSearches = (player.swapRound === room.round ? player.swapSearches || 0 : 0) + 1;
      player.swapRound = room.round;
      if (player.swapSearches > SWAP_MAX_SEARCHES) return send(ws, { t: 'error', code: 'search_limit' });
      const kind = kindFor(room, player.id);
      searchMedia(q, { kind })
        .then((items) => {
          const list = items.filter((i) => !isBroken(i.url)).slice(0, 30);
          player.swapResults = new Map(list.map((i) => [i.id, i]));
          send(ws, { t: 'swap_results', q, items: list.map((i) => ({ ...publicMedia(i), thumb: i.thumb ? proxyUrl(i.thumb) : null })) });
        })
        .catch(() => send(ws, { t: 'swap_results', q, items: [] }));
      return;
    }
    case 'swap_pick': {
      if (room.phase !== 'upload' || !cur || !isSwap(room)) return;
      const item = player.swapResults?.get(String(msg.id));
      if (!item) return send(ws, { t: 'error', code: 'item_expired' });
      warmMedia(item.url);
      return setContribution(room, player, item);
    }
    case 'swap_random': {
      if (room.phase !== 'upload' || !cur || !isSwap(room)) return;
      const kind = kindFor(room, player.id);
      const media = pickMedia(kind === 'any' ? (Math.random() < 0.5 ? 'image' : 'video') : kind, room.usedMedia);
      warmMedia(media.url);
      return setContribution(room, player, media);
    }
    case 'swap_clear': {
      if (room.phase !== 'upload' || !cur || !isSwap(room) || cur.endingSoon) return;
      const old = cur.contribs.get(player.id);
      if (!old) return;
      if (old.rel) {
        removeFile(old.rel);
        room.files.delete(old.rel);
      }
      cur.contribs.delete(player.id);
      return broadcast(room);
    }
    case 'vote': {
      const item = cur?.voteItem;
      if (room.phase !== 'vote' || !item || item.stage !== 'rating' || item.pid === player.id) return;
      const score = Number(msg.score);
      if (!Number.isInteger(score) || score < 1 || score > 5) return;
      item.votes.set(player.id, score);
      broadcast(room);
      maybeRevealEarly(room);
      return;
    }
    case 'react': {
      if (!REACTIONS.includes(msg.emoji)) return;
      const t = now();
      if (t - (player.lastReact || 0) < 350) return;
      player.lastReact = t;
      return broadcastRaw(room, { t: 'react', pid: player.id, emoji: msg.emoji });
    }
    case 'skip':
      if (!isHost(ws)) return;
      if (room.phase === 'scores') {
        clearTimer(room);
        return room.round >= room.settings.rounds ? endGame(room) : startRound(room);
      }
      if (room.phase === 'caption') return endCaption(room);
      if (room.phase === 'upload') return endUpload(room);
      return;
    case 'again':
      if (!isHost(ws) || room.phase !== 'final') return;
      return backToLobby(room);
    case 'leave':
      room.reserved.delete(player.id);
      room.players.delete(player.id);
      player.sockets.delete(ws);
      ws.room = null;
      ws.player = null;
      if (room.phase === 'caption') cur?.subs?.delete(player.id);
      if (!player.sockets.size) player.connected = false;
      ensureHost(room);
      if (!connectedPlayers(room).length) scheduleCleanup(room);
      maybeEndCaptionEarly(room);
      maybeRevealEarly(room);
      broadcast(room);
      if (room.isPublic) {
        checkPublicStart(room);
        onPublicRoomChanged(room.settings.game);
      }
      return undefined;
    default:
      return undefined;
  }
}

// --- websocket wiring --------------------------------------------------------

export function attachGame(wss) {
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.bucket = 30;
    ws.bucketAt = now();
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('message', (data, isBinary) => {
      // simple token bucket: 15 msg/s, burst 30
      const t = now();
      ws.bucket = Math.min(30, ws.bucket + ((t - ws.bucketAt) / 1000) * 15);
      ws.bucketAt = t;
      if (ws.bucket < 1) return;
      ws.bucket -= 1;
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      try {
        handleMessage(ws, msg);
      } catch (err) {
        console.error('[game] message error', err);
      }
    });
    ws.on('close', () => handleClose(ws));
    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25000);
  heartbeat.unref?.();
  wss.on('close', () => clearInterval(heartbeat));
}

/** open rooms and connected players per release channel (read-only, for the admin dashboard) */
export function channelStats() {
  const out = { stable: { rooms: 0, players: 0 }, beta: { rooms: 0, players: 0 } };
  for (const r of rooms.values()) {
    const entry = out[r.channel === 'beta' ? 'beta' : 'stable'];
    entry.rooms++;
    for (const p of r.players.values()) if (p.connected) entry.players++;
  }
  return out;
}
