import crypto from 'node:crypto';
import {
  REACTIONS,
  ROOM_CODE_CHARS,
  ROOM_CODE_RE,
  gameAllowed,
  hasText,
  isPaced,
  presetFor,
  sanitizeAvatar,
  sanitizeCaptions,
  sanitizeName,
  sanitizeSettings,
} from '../lib/shared.js';
import { getConfig } from './config.js';
import {
  ASSIST_SOURCES,
  assistFor,
  awardsFor,
  dealSwap,
  distOf,
  drawHand,
  lastCallDeadline,
  lastCallReached,
  lateOptions,
  rankPlayers,
  swapVoteOrder,
} from './game/rules.js';
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
// Game flow:  lobby -> [upload] -> caption -> vote (rating/reveal per meme)
//             -> scores -> … -> final -> (play again) lobby
// The server is the only source of truth; clients get a personalised state.
// The rules of the modes (hands, swap deal, pacing, ranking, awards) are pure
// functions in ./game/rules.js; this file is the phase machine around them.
// Classic keeps its rules exactly - everything new is gated by isPaced().
// ---------------------------------------------------------------------------

const REVEAL_MS = 3500;
const SCORES_MS = 12000;
const EMPTY_ROOM_TTL = 10 * 60 * 1000;
const HOST_GRACE_MS = 12 * 1000;
const JOIN_LATE_MIN_MS = 15 * 1000;
const JOIN_LATE_SEARCH_MS = 30 * 1000; // hunt and swap: finding or choosing a picture needs more time
const RECONNECT_GRACE_MS = 10 * 1000;
const PUBLIC_START_MS = 12 * 1000; // public room: wait this long for matched players
const PUBLIC_ALL_HERE_MS = 3500; // …or start soon once everybody arrived
const PUBLIC_RESTART_MS = 20 * 1000; // public room: next game starts automatically
const RESERVE_MS = 25 * 1000; // a matched player's seat is kept this long
const HUNT_MAX_ATTEMPTS = 12; // searches per player per round (incl. ones without results)
const HUNT_HAND = 4; // tiles dealt by one search
const HUNT_HAND_TOP = 16; // …out of this many best hits
const HUNT_BAG_MAX = 24; // tiles a player can hold in one round
const HUNT_LUCKY = 1; // free lucky hands (random templates) per round
const SWAP_ALL_DONE_MS = 2500; // swap round: everybody picked something -> continue shortly after
const SWAP_OPTIONS = 2; // swap round: pictures of other players to choose from
const SWAP_MAX_SEARCHES = 6; // swap round: searches per player per round
const BROKEN_MAX = 4; // free replacements of media the browser cannot show, per player and round
const SHARED_SWAPS_MAX = 2; // "same": how often a broken shared picture is replaced for everybody
// paced modes: once almost everybody is done the rest gets this long (never below half of the configured time)
const LAST_CALL_MS = { upload: 15000, caption: 20000, vote: 4000 };
const AWAY_MISSED_VOTES = 2; // paced modes: missed votes in a row until a player counts as away
const CROWD_MAX_PER_ITEM = 5; // reactions per reactor and meme that count for the crowd award
const DIST_IN_CLASSIC = true; // show the anonymous vote distribution in classic too (presentation only)

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
// the media search can be replaced in tests
let search = searchMedia;
export const _test = {
  setSearch(fn) {
    search = fn || searchMedia;
  },
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
  // beta modes only in beta rooms, private-only modes never in public rooms
  const settings = presetFor(gameAllowed(game, { channel, isPublic }) ? game : 'classic');
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
    crowd: new Map(), // pid -> reactions received while their meme was on screen (award at the final)
    final: null, // ranking and awards, computed once when the game ends
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
    t = { rounds: 0, roundWins: 0, roundTops: 0, memes: 0, votes: 0, assist: 0 };
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

const isHunt = (room) => room.settings.game === 'hunt';
const isSwap = (room) => room.settings.game === 'swap';
const isSame = (room) => room.settings.game === 'same';
const paced = (room) => isPaced(room.settings.game);
const showDist = (room) => paced(room) || DIST_IN_CLASSIC;
/** GIF Hunt: searches per player and round (host setting, otherwise HUNT_SEARCHES) */
const searchesFor = (room) => room.settings.searches || getConfig().huntSearches;
const lateJoinMs = (room) => (isHunt(room) || isSwap(room) ? JOIN_LATE_SEARCH_MS : JOIN_LATE_MIN_MS);
// paced modes: players who are away do not hold the others up
const pacers = (room, list) => (paced(room) ? list.filter((p) => !p.away) : list);

function resetPlayer(p) {
  p.score = 0;
  p.lastPoints = 0;
  p.away = false;
  p.missedVotes = 0;
  p.actedRound = 0;
  p.streak = 0;
  p.bestStreak = 0;
}

/** any real input: the player is here (again) */
function touch(room, player) {
  player.actedRound = room.round;
  player.missedVotes = 0;
  if (!player.away) return;
  player.away = false;
  broadcast(room);
}

const swapSearchesLeft = (cur, pid) => Math.max(0, SWAP_MAX_SEARCHES - (cur.swapSearches.get(pid) || 0));

// --- state for one player ---------------------------------------------------

const thumbOf = (m) => (m.thumb ? (m.local ? m.thumb : proxyUrl(m.thumb)) : null);
/** media of a tile in a tray or a list: with a small preview */
const tileMedia = (m) => ({ ...publicMedia(m), thumb: thumbOf(m) });

/** what a player is doing right now (shown in the player strip) */
function stepOf(room, p) {
  const cur = room.current;
  if (room.phase === 'upload') return cur?.contribs.has(p.id) ? 'done' : 'bring';
  if (room.phase !== 'caption') return undefined;
  const sub = cur?.subs.get(p.id);
  if (!sub) return undefined;
  if (sub.submitted) return 'done';
  return isHunt(room) && !sub.media ? 'search' : 'write';
}

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
      step: stepOf(room, p),
      away: Boolean(p.away),
      streak: p.streak || 0,
    }));

  const s = {
    code: room.code,
    you: pid,
    hostId: room.isPublic ? null : room.hostId,
    isPublic: room.isPublic,
    activity: Boolean(room.activity),
    channel: room.channel,
    phase: room.phase,
    round: room.round,
    settings: room.settings,
    deadline: room.deadline,
    serverNow: now(),
    minPlayers: getConfig().minPlayers,
    players,
    // paced modes: almost everybody is done, the clock was shortened for the rest
    lastCall: Boolean(room.phase === 'vote' ? cur?.voteItem?.lastCall : (room.phase === 'upload' || room.phase === 'caption') && cur?.lastCall),
  };

  if (room.phase === 'upload' && cur) {
    const mine = cur.contribs.get(pid);
    s.upload = {
      mine: mine ? { media: publicMedia(mine.media), auto: false, uploaded: Boolean(mine.media.roomUpload), source: mine.source } : null,
      done: [...cur.contribs.keys()].filter((id) => room.players.get(id)?.connected).length,
      total: connectedPlayers(room).length,
      endingSoon: Boolean(cur.endingSoon),
      searchesLeft: swapSearchesLeft(cur, pid),
      ideas: cur.ideas,
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
          // the tray: only its owner ever gets it, and never with the name of who brought a picture
          hand: mine.hand.map((tile) => ({ id: tile.id, q: isHunt(room) ? tile.q : null, media: tileMedia(tile.media) })),
          pickedId: mine.pickedId,
          hunt: isHunt(room)
            ? {
                searchesLeft: mine.searchesLeft,
                max: searchesFor(room),
                query: mine.query,
                searching: Boolean(mine.searching),
                luckyLeft: mine.luckyLeft,
                ideas: cur.ideas,
              }
            : undefined,
          shared: isSame(room) ? Boolean(cur.shared && mine.media?.id === cur.shared.id) : undefined,
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
      // GIF Hunt: the search term is part of the punchline and only shown with the reveal
      meme: { media: publicMedia(entry.media), captions: entry.captions, query: isHunt(room) && !revealed ? null : entry.query || null },
      isMine: item.pid === pid,
      myScore: item.votes.get(pid) ?? null,
      votes: item.votes.size,
      voters: connectedPlayers(room).filter((p) => p.id !== item.pid).length,
      // who made the meme stays secret until the round is over (scores phase)
      points: revealed ? item.points : null,
      avg: revealed ? item.avg : null,
      // how often each rating was given - never who gave it
      dist: revealed && showDist(room) ? item.dist : null,
      sameAsPrev: Boolean(item.sameAsPrev),
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
      dist: showDist(room) ? r.dist : null,
      assist: r.assist || null,
      searches: isHunt(room) ? r.searches : undefined,
    }));
    s.lastRound = room.round >= room.settings.rounds;
    if (isSwap(room)) s.leftover = cur.leftover.map((c) => ({ pid: c.pid, media: tileMedia(c.media) }));
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
      // ranking, tie, decidedBy, awards, at
      ...(room.final || {}),
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

/** a random template or clip of the kind this player can get */
function randomMedia(room, pid, used = room.usedMedia) {
  const kind = kindFor(room, pid);
  return pickMedia(kind === 'any' ? (Math.random() < 0.5 ? 'image' : 'video') : kind, used);
}

// --- the tray ("hand") --------------------------------------------------------
// hunt: the hits of the player's searches, swap: pictures other players brought.
// A tile is { id, media, q, from }; the id is an opaque counter per player and round.

function addTile(sub, { media, q = null, from = null }) {
  sub.tileSeq += 1;
  const tile = { id: String(sub.tileSeq), media, q, from };
  sub.hand.push(tile);
  return tile;
}

function pickTile(sub, tile) {
  sub.media = tile.media;
  sub.pickedId = tile.id;
  sub.query = tile.q || '';
  sub.from = tile.from || null;
  if (!tile.media.local) warmMedia(tile.media.url);
}

/** "same": everybody gets the one picture of the round */
function pickShared(room) {
  const mode = room.settings.mode;
  let kind = mode === 'images' ? 'image' : mode === 'videos' ? 'video' : 'any';
  let media = room.packItems?.length ? pickFromPack(room, kind) : null;
  if (!media) {
    if (kind === 'any') kind = Math.random() < 0.5 ? 'image' : 'video';
    media = pickMedia(kind, room.usedMedia);
  }
  room.usedMedia.add(media.id);
  warmMedia(media.url);
  return media;
}

function giveShared(room, sub) {
  const shared = room.current.shared;
  // a browser that cannot play videos gets a picture of its own
  if (shared.kind === 'video' && room.players.get(sub.pid)?.noVideo) return assignMedia(room, sub);
  sub.media = shared;
  return undefined;
}

/** `hand`: [{ media, from }] - pictures to choose from (swap round), the first one is preselected */
function addToRound(room, player, hand = null) {
  const sub = {
    pid: player.id,
    media: null,
    captions: [],
    submitted: false,
    rerollsLeft: room.settings.game === 'classic' ? room.settings.rerolls : 0,
    draftVersion: 0,
    hand: [],
    pickedId: null,
    tileSeq: 0,
    // GIF Hunt: the player searches the media themselves
    searchesLeft: isHunt(room) ? searchesFor(room) : 0,
    searchesUsed: 0,
    luckyLeft: isHunt(room) ? HUNT_LUCKY : 0,
    searchAttempts: 0,
    searching: false,
    query: '',
    results: [], // spare hits of the last search: [{ media, q }]
    from: null, // swap round: who brought the picture
    brokenSwaps: 0,
  };
  room.current.subs.set(player.id, sub);
  if (hand) {
    for (const option of hand) addTile(sub, option);
    pickTile(sub, sub.hand[0]);
  } else if (isSame(room)) {
    giveShared(room, sub);
  } else if (!isHunt(room)) {
    assignMedia(room, sub);
  }
  return sub;
}

// --- GIF Hunt -------------------------------------------------------------------

/** media the player should not be dealt: used earlier in this game or picked by somebody else right now */
function avoidFor(room, sub) {
  const avoid = new Set(room.usedMedia);
  for (const other of room.current.subs.values()) if (other !== sub && other.media) avoid.add(other.media.id);
  return avoid;
}

/** new tiles for the tray; the first one is picked, typed text stays */
function dealTiles(room, sub, player, medias, q) {
  const hadMedia = Boolean(sub.media);
  const tiles = medias.map((media) => addTile(sub, { media, q }));
  pickTile(sub, tiles[0]);
  sub.draftVersion += 1;
  // the tray has a limit: the oldest tiles that are not picked go first
  while (sub.hand.length > HUNT_BAG_MAX) sub.hand.splice(sub.hand.findIndex((t) => t.id !== sub.pickedId), 1);
  // a tray is private - the others only learn that this player has something to caption now
  if (hadMedia) sendState(room, player);
  else broadcast(room);
}

async function runHuntSearch(room, sub, player, q) {
  const cur = room.current;
  const kind = kindFor(room, player.id);
  let items = [];
  try {
    items = (await search(q, { kind })) || [];
  } catch (err) {
    console.warn('[hunt] search failed', err.message);
  }
  sub.searching = false;
  // the round may have moved on while we were searching
  if (room.current !== cur || room.phase !== 'caption' || cur.subs.get(player.id) !== sub || sub.submitted || !rooms.has(room.code)) {
    return;
  }
  const { hand, spares } = drawHand(
    items.filter((i) => !isBroken(i.url)),
    { own: new Set(sub.hand.map((t) => t.media.id)), avoid: avoidFor(room, sub), size: HUNT_HAND, top: HUNT_HAND_TOP, shuffle },
  );
  if (!hand.length) {
    // nothing found costs nothing
    sendToPlayer(player, { t: 'error', code: 'search_empty' });
    return sendState(room, player);
  }
  sub.searchesLeft -= 1;
  sub.searchesUsed += 1;
  sub.results = spares.map((media) => ({ media, q }));
  dealTiles(room, sub, player, hand, q);
}

/** free once per round: four random templates, no provider call */
function luckyHand(room, sub, player) {
  const own = new Set(sub.hand.map((t) => t.media.id));
  const used = avoidFor(room, sub);
  const medias = [];
  for (let tries = 0; tries < HUNT_HAND * 4 && medias.length < HUNT_HAND; tries++) {
    const media = randomMedia(room, player.id, used);
    used.add(media.id);
    if (own.has(media.id) || medias.includes(media)) continue;
    medias.push(media);
  }
  if (!medias.length) return sendToPlayer(player, { t: 'error', code: 'search_empty' });
  sub.luckyLeft -= 1;
  return dealTiles(room, sub, player, medias, '');
}

/** the browser cannot show the picked GIF: next spare hit, another tile, or something from the pool */
function replaceBrokenHunt(room, sub, player) {
  const kind = kindFor(room, player.id);
  const fits = (media) => kind === 'any' || media.kind === kind;
  const own = new Set(sub.hand.map((t) => t.media.id));
  const at = sub.hand.findIndex((t) => t.id === sub.pickedId);
  const spare = sub.results.find((r) => !isBroken(r.media.url) && !own.has(r.media.id) && fits(r.media));
  if (at >= 0) sub.hand.splice(at, 1);
  if (spare) {
    sub.results = sub.results.filter((r) => r !== spare);
    sub.tileSeq += 1;
    const tile = { id: String(sub.tileSeq), media: spare.media, q: spare.q, from: null };
    sub.hand.splice(at >= 0 ? at : sub.hand.length, 0, tile);
    return pickTile(sub, tile);
  }
  const rest = sub.hand.find((t) => fits(t.media));
  return pickTile(sub, rest || addTile(sub, { media: randomMedia(room, player.id), q: '' }));
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
  for (const p of room.players.values()) resetPlayer(p);
  room.round = 0;
  room.history = [];
  room.tally = new Map();
  room.crowd = new Map();
  room.final = null;
  dropRoomFiles(room);
  startRound(room);
}

/** three search ideas per round for the whole room (blank-page help) */
function pickIdeas() {
  const terms = [...new Set(getConfig().searchTerms)].filter((w) => w.length >= QUERY_MIN && !isBlocked(w));
  return shuffle(terms).slice(0, 3);
}

function startRound(room) {
  room.round += 1;
  safely('activity', () => recordActivity(`round:${room.settings.game}`));
  room.current = {
    subs: new Map(),
    voteOrder: [],
    voteIndex: -1,
    voteItem: null,
    results: [],
    endingSoon: false,
    lastCall: false,
    phaseStart: now(),
    ideas: isHunt(room) || isSwap(room) ? pickIdeas() : [],
    // swap round
    contribs: new Map(), // pid -> { media, from, source: 'upload' | 'search' | 'random', rel? }
    swapSearches: new Map(), // pid -> searches in the bring phase
    offers: new Map(), // pid -> how many players were offered this player's picture
    sameAsPrev: new Set(), // authors whose meme uses the same picture as the one voted before
    leftover: [],
    // "same": the one picture of the round
    shared: null,
    sharedSwaps: 0,
  };
  if (isSame(room)) room.current.shared = pickShared(room);
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
  const cur = room.current;
  room.phase = 'caption';
  cur.lastCall = false;
  cur.phaseStart = now();
  for (const p of connectedPlayers(room)) if (!cur.subs.has(p.id)) addToRound(room, p);
  setPhaseTimer(room, room.settings.captionTime * 1000, () => endCaption(room));
  cur.captionDeadline = room.deadline;
  broadcast(room);
}

/**
 * Paced modes: once almost everybody is done, the rest gets a short last call
 * instead of the full clock. Happens once per phase (per meme while voting).
 */
function lastCall(room, phase, done, total) {
  if (!paced(room) || !lastCallReached(done, total)) return;
  const cur = room.current;
  const holder = phase === 'vote' ? cur.voteItem : cur;
  if (holder.lastCall) return;
  const configuredMs = phase === 'upload' ? room.settings.uploadTime * 1000 : phase === 'caption' ? room.settings.captionTime * 1000 : 0;
  const next = lastCallDeadline({ now: now(), deadline: room.deadline, graceMs: LAST_CALL_MS[phase], phaseStart: cur.phaseStart, configuredMs });
  if (next === null) return;
  holder.lastCall = true;
  const end = phase === 'upload' ? endUpload : phase === 'caption' ? endCaption : revealVoteItem;
  setPhaseTimer(room, next - now(), () => end(room));
  // a cancelled early end goes back to the shortened clock, not to the full one
  if (phase === 'upload') cur.uploadDeadline = room.deadline;
  if (phase === 'caption') cur.captionDeadline = room.deadline;
  broadcast(room);
}

// --- swap round -----------------------------------------------------------------

/** removes a player's picture of the bring phase (and its uploaded file) */
function dropContribution(room, pid) {
  const cur = room.current;
  const old = cur?.contribs.get(pid);
  if (!old) return false;
  if (old.rel) {
    removeFile(old.rel);
    room.files.delete(old.rel);
  }
  cur.contribs.delete(pid);
  return true;
}

/** source: 'upload' | 'search' | 'random' - a new picture simply replaces the old one */
function setContribution(room, player, media, { source, rel = null }) {
  dropContribution(room, player.id);
  room.current.contribs.set(player.id, { media, from: player.id, source, rel });
  touch(room, player);
  broadcast(room);
  maybeEndUploadEarly(room);
}

function maybeEndUploadEarly(room) {
  const cur = room.current;
  if (room.phase !== 'upload' || !cur || cur.endingSoon) return;
  const active = pacers(room, presentPlayers(room));
  if (!active.length) return;
  const done = active.filter((p) => cur.contribs.has(p.id)).length;
  if (done === active.length) {
    cur.endingSoon = true;
    setPhaseTimer(room, SWAP_ALL_DONE_MS, () => endUpload(room));
    broadcast(room);
    return;
  }
  lastCall(room, 'upload', done, active.length);
}

function cancelEarlyUploadEnd(room) {
  const cur = room.current;
  if (room.phase !== 'upload' || !cur?.endingSoon) return;
  cur.endingSoon = false;
  const left = cur.uploadDeadline - now();
  setPhaseTimer(room, Math.max(1000, left), () => endUpload(room));
}

/** the pictures one player can choose from: [{ media, from }] */
function swapHand(room, player, ownerIds, { allowOwn = true } = {}) {
  const cur = room.current;
  const hand = [];
  for (const id of ownerIds) {
    const c = cur.contribs.get(id);
    if (!c) continue;
    cur.offers.set(id, (cur.offers.get(id) || 0) + 1);
    hand.push({ media: c.media, from: id });
  }
  if (hand.length) return hand;
  // nobody else brought anything: the own picture (no bonus for that), otherwise a random template
  const own = allowOwn ? cur.contribs.get(player.id) : null;
  if (own) return [{ media: own.media, from: player.id }];
  const media = randomMedia(room, player.id);
  room.usedMedia.add(media.id);
  return [{ media, from: null }];
}

/** owners of the pictures of this round that are still in the room */
const swapOwners = (room) => [...room.current.contribs.keys()].filter((id) => room.players.has(id));

function endUpload(room) {
  if (room.phase !== 'upload') return;
  const cur = room.current;
  const receivers = presentPlayers(room);
  // Everybody gets the pictures of two other players and never their own. Who brought
  // nothing simply has no picture in the deal; pictures of players who are offline
  // right now stay in the game.
  const deal = dealSwap({ receivers: receivers.map((p) => p.id), owners: swapOwners(room), options: SWAP_OPTIONS, shuffle });
  for (const p of receivers) addToRound(room, p, swapHand(room, p, deal.get(p.id) || []));
  cur.endingSoon = false;
  beginCaption(room);
}

/** joining a running caption phase (late, or back after being offline at the deal) */
function joinRound(room, player) {
  if (!isSwap(room)) return addToRound(room, player);
  // swap: the pictures of this round that were offered least often so far
  const owners = lateOptions({ pid: player.id, owners: swapOwners(room), offers: room.current.offers, count: SWAP_OPTIONS, shuffle });
  return addToRound(room, player, swapHand(room, player, owners, { allowOwn: false }));
}

/** the browser cannot show the picked picture: the other option, otherwise a random template */
function replaceBrokenSwap(room, sub, player) {
  const at = sub.hand.findIndex((t) => t.id === sub.pickedId);
  if (at >= 0) sub.hand.splice(at, 1);
  if (!sub.hand.length) {
    const media = randomMedia(room, player.id);
    room.usedMedia.add(media.id);
    addTile(sub, { media, from: null });
  }
  pickTile(sub, sub.hand[0]);
}

/** "same": a picture nobody can load is replaced for everybody who is still writing */
function replaceShared(room, sub) {
  const cur = room.current;
  const old = cur.shared;
  if (!old || sub.media?.id !== old.id || !isBroken(old.url) || cur.sharedSwaps >= SHARED_SWAPS_MAX) return false;
  cur.sharedSwaps += 1;
  cur.shared = pickShared(room);
  for (const other of cur.subs.values()) {
    if (other.submitted || other.media?.id !== old.id) continue;
    giveShared(room, other);
    other.draftVersion += 1;
  }
  return true;
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
  // neutral title: the file name could give away who brought the picture
  const media = uploadMedia({ id: stored.id, url: stored.url, thumb: stored.thumb, info: file.info, name: 'Upload', room: true });
  setContribution(room, player, media, { source: 'upload', rel: stored.rel });
  return { ok: true };
}

function maybeEndCaptionEarly(room) {
  const cur = room.current;
  if (room.phase !== 'caption' || cur.endingSoon) return;
  const active = pacers(room, presentPlayers(room).filter((p) => cur.subs.has(p.id)));
  if (!active.length) return;
  const done = active.filter((p) => cur.subs.get(p.id).submitted).length;
  if (done === active.length) {
    cur.endingSoon = true;
    setPhaseTimer(room, 1500, () => endCaption(room));
    broadcast(room);
    return;
  }
  lastCall(room, 'caption', done, active.length);
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
  if (paced(room)) {
    // who is connected but did nothing at all this round is away from now on
    for (const p of connectedPlayers(room)) if (cur.subs.has(p.id) && p.actedRound !== room.round) p.away = true;
  }
  if (isHunt(room)) {
    // typed text is never lost: without a GIF the meme gets a random one
    for (const sub of cur.subs.values()) {
      if (sub.media || !hasText(sub.captions)) continue;
      sub.media = randomMedia(room, sub.pid);
      sub.query = '';
      warmMedia(sub.media.url);
    }
  }
  // unsent drafts with text count as submitted
  const entries = [...cur.subs.values()].filter((s) => s.media && hasText(s.captions));
  for (const sub of cur.subs.values()) tally(room, sub.pid).rounds += 1;
  for (const e of entries) tally(room, e.pid).memes += 1;
  // (classic marks its templates as used when they are dealt)
  if (paced(room)) for (const e of entries) room.usedMedia.add(e.media.id);
  if (isSwap(room)) {
    // memes on the same picture are voted on back to back
    const order = swapVoteOrder(entries.map((e) => ({ pid: e.pid, from: e.from, mediaId: e.media.id })), shuffle);
    cur.voteOrder = order.map((o) => o.pid);
    cur.sameAsPrev = new Set(order.filter((o) => o.sameAsPrev).map((o) => o.pid));
  } else {
    cur.voteOrder = shuffle(entries.map((e) => e.pid));
  }
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
  cur.voteItem = {
    pid,
    stage: 'rating',
    votes: new Map(),
    points: 0,
    avg: 0,
    dist: null,
    endingSoon: false,
    lastCall: false,
    crowd: new Map(), // reactor -> reactions that counted for this meme
    sameAsPrev: cur.sameAsPrev.has(pid),
  };
  const voters = connectedPlayers(room).filter((p) => p.id !== pid);
  const ms = voters.length ? room.settings.voteTime * 1000 : 2500;
  setPhaseTimer(room, ms, () => revealVoteItem(room));
  broadcast(room);
}

function maybeRevealEarly(room) {
  const item = room.current?.voteItem;
  if (room.phase !== 'vote' || !item || item.stage !== 'rating' || item.endingSoon) return;
  const voters = pacers(room, presentPlayers(room).filter((p) => p.id !== item.pid));
  if (!voters.length) return;
  const done = voters.filter((p) => item.votes.has(p.id)).length;
  if (done === voters.length) {
    item.endingSoon = true;
    setPhaseTimer(room, 900, () => revealVoteItem(room));
    return;
  }
  lastCall(room, 'vote', done, voters.length);
}

function revealVoteItem(room) {
  const cur = room.current;
  const item = cur?.voteItem;
  if (room.phase !== 'vote' || !item || item.stage !== 'rating') return;
  const scores = [...item.votes.values()];
  item.points = scores.reduce((a, b) => a + b, 0);
  item.avg = scores.length ? Math.round((item.points / scores.length) * 10) / 10 : 0;
  item.dist = distOf(scores);
  item.stage = 'reveal';
  if (paced(room)) {
    // who keeps missing votes is away and no longer waited for
    for (const p of presentPlayers(room)) {
      if (p.id === item.pid || item.votes.has(p.id)) continue;
      p.missedVotes = (p.missedVotes || 0) + 1;
      if (p.missedVotes >= AWAY_MISSED_VOTES) p.away = true;
    }
  }
  const author = room.players.get(item.pid);
  // points are added to the scoreboard only in endVote - otherwise the jumping score gives the author away
  for (const voter of item.votes.keys()) tally(room, voter).votes += 1;
  const sub = cur.subs.get(item.pid);
  const brought = sub.from ? cur.contribs.get(sub.from) : null;
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
    dist: item.dist,
    searches: sub.searchesUsed,
    // server only (picture bonus) - never sent to anybody
    ratings: [...item.votes],
    source: brought && brought.media.id === sub.media.id ? brought.source : null,
  });
  setPhaseTimer(room, REVEAL_MS, () => nextVoteItem(room));
  broadcast(room);
}

/** swap round: the picture bonus for whoever brought the picture of a good meme */
function applyAssists(room) {
  const cur = room.current;
  for (const r of cur.results) {
    r.assist = null;
    // no bonus for the own picture, for surprise pictures or when the bringer left the room
    const bringer = r.from && r.from !== r.pid ? room.players.get(r.from) : null;
    if (!bringer || !ASSIST_SOURCES.includes(r.source)) continue;
    const points = assistFor(r);
    r.assist = { pid: bringer.id, points };
    bringer.score += points;
    bringer.lastPoints += points;
    tally(room, bringer.id).assist += points;
  }
  // brought pictures nobody made a meme with
  const used = new Set(cur.results.map((r) => `${r.from}|${r.media.id}`));
  cur.leftover = [...cur.contribs.values()]
    .filter((c) => ASSIST_SOURCES.includes(c.source) && room.players.has(c.from) && !used.has(`${c.from}|${c.media.id}`))
    .slice(0, 6)
    .map((c) => ({ pid: c.from, media: c.media }));
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
  if (isSwap(room)) applyAssists(room);
  const top = cur.results[0];
  // round wins in a row (cosmetic)
  const winner = top && top.points > 0 ? top.pid : null;
  for (const p of room.players.values()) {
    p.streak = p.id === winner ? (p.streak || 0) + 1 : 0;
    p.bestStreak = Math.max(p.bestStreak || 0, p.streak);
  }
  if (top && top.points > 0) {
    tally(room, top.pid).roundWins += 1;
    // For the ranking a round that ends level counts for everybody at its top - the order of
    // equal results is arbitrary and must not decide a game.
    for (const r of cur.results) if (r.points === top.points && r.avg === top.avg) tally(room, r.pid).roundTops += 1;
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

/** ranking and awards of the finished game (computed once) */
function finishGame(room) {
  const bestMeme = new Map();
  const memes = [];
  for (const h of room.history) {
    for (const e of h.entries) {
      bestMeme.set(e.pid, Math.max(bestMeme.get(e.pid) || 0, e.points));
      memes.push({ round: h.round, pid: e.pid, points: e.points, avg: e.avg, votes: e.votes, searches: e.searches });
    }
  }
  const all = [...room.players.values()];
  const rows = all
    .filter((p) => p.connected || p.score > 0)
    .map((p) => ({ pid: p.id, score: p.score, roundWins: room.tally.get(p.id)?.roundTops || 0, bestMeme: bestMeme.get(p.id) || 0, joinedAt: p.joinedAt }));
  // classic ranks by score only; the other modes break a tie by rounds won, then by the best meme
  const { ranking, tie, decidedBy } = rankPlayers(rows, { tieBreak: paced(room) });
  const took = all
    .filter((p) => room.tally.get(p.id)?.rounds > 0)
    .map((p) => ({ pid: p.id, score: p.score, bestStreak: p.bestStreak || 0, assist: room.tally.get(p.id).assist || 0 }));
  const awards = awardsFor({ game: room.settings.game, players: took, memes, crowd: room.crowd });
  room.final = { ranking, tie, decidedBy, awards, at: now() };
}

function recordGame(room) {
  const participants = [...room.tally.keys()].filter((pid) => room.tally.get(pid).rounds > 0).length;
  const best = Math.max(0, ...[...room.players.values()].map((p) => p.score));
  const byUser = new Map();
  for (const p of room.players.values()) {
    if (!p.userId) continue;
    const t = room.tally.get(p.id) || { rounds: 0, roundWins: 0, memes: 0, votes: 0 };
    // classic: everybody with the top score wins; paced modes: rank 1 after the tie-break
    const won = paced(room) ? p.score > 0 && room.final.ranking.some((r) => r.pid === p.id && r.rank === 1) : best > 0 && p.score === best;
    const row = {
      userId: p.userId,
      points: p.score,
      won,
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
    finishGame(room);
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
  room.crowd = new Map();
  room.final = null;
  for (const p of room.players.values()) resetPlayer(p);
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
      away: false,
      missedVotes: 0,
      actedRound: 0,
      streak: 0,
      bestStreak: 0,
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

  // joining while a round is running (also: back after having been offline when the round began)
  if (room.phase === 'caption' && room.current && !room.current.subs.has(pid) && room.deadline - now() > lateJoinMs(room)) {
    joinRound(room, player);
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

/** a player is gone for good: nothing of them stays in the running phase */
function dropFromRound(room, pid) {
  if (room.phase === 'caption') room.current?.subs.delete(pid);
  // the picture they brought goes with them (the uploaded file too)
  if (room.phase === 'upload') dropContribution(room, pid);
}

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
  dropFromRound(room, target.id);
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
  const reason = String(msg.reason || '');
  // a report about the picture itself goes to whoever brought it (swap round), not to the caption author
  const responsible = (entry) => (reason === 'upload' && entry.from && room.players.get(entry.from)) || room.players.get(entry.pid) || null;
  let target = null;
  let context = null;
  if (msg.target === 'vote') {
    // the reporter does not learn who made the meme or who brought the picture
    const item = cur?.voteItem;
    if (room.phase !== 'vote' || !item) return;
    const entry = cur.subs.get(item.pid);
    target = responsible(entry);
    context = memeContext(entry);
  } else if (msg.target === 'result') {
    const round = Number(msg.round) || room.round;
    const list = round === room.round && cur?.results?.length ? cur.results : room.history.find((h) => h.round === round)?.entries || [];
    const entry = list.find((e) => e.pid === String(msg.pid));
    if (!entry) return;
    target = responsible(entry);
    context = memeContext(entry);
  } else {
    target = room.players.get(String(msg.pid)) || null;
  }
  if (!target) return send(ws, { t: 'error', code: 'report_gone' });
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
      room.settings = sanitizeSettings(msg.settings, room.settings, { channel: room.channel });
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
      const captions = sanitizeCaptions(msg.captions);
      // Browsers flush drafts by themselves (also the untouched, empty text box right before the
      // time runs out) - only a changed text shows that somebody is there.
      const changed = (hasText(captions) || hasText(sub.captions)) && JSON.stringify(captions) !== JSON.stringify(sub.captions);
      if (msg.t === 'submit' || changed) touch(room, player);
      sub.captions = captions;
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
      touch(room, player);
      sub.submitted = false;
      return broadcast(room);
    }
    case 'reroll': {
      if (room.phase !== 'caption' || !cur) return;
      const sub = cur.subs.get(player.id);
      if (!sub || sub.submitted || sub.rerollsLeft <= 0 || isHunt(room)) return;
      touch(room, player);
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
      if (!sub || sub.submitted || sub.media?.id !== msg.id || sub.brokenSwaps >= BROKEN_MAX) return;
      sub.brokenSwaps += 1;
      if (msg.noVideo && sub.media.kind === 'video') player.noVideo = true;
      if (isHunt(room) || isSwap(room)) {
        if (isHunt(room)) replaceBrokenHunt(room, sub, player);
        else replaceBrokenSwap(room, sub, player);
        sub.draftVersion += 1;
        return sendState(room, player);
      }
      // "same": a picture nobody can load is replaced for everybody
      if (isSame(room) && replaceShared(room, sub)) return broadcast(room);
      assignMedia(room, sub);
      sub.from = null;
      sub.draftVersion += 1;
      return broadcast(room);
    }
    case 'search': {
      if (room.phase !== 'caption' || !cur || !isHunt(room)) return;
      const sub = cur.subs.get(player.id);
      if (!sub || sub.submitted || sub.searching) return;
      if (msg.random === true) {
        // lucky hand: free, once per round, no provider call
        if (sub.luckyLeft <= 0) return send(ws, { t: 'error', code: 'no_lucky_left' });
        touch(room, player);
        return luckyHand(room, sub, player);
      }
      if (sub.searchesLeft <= 0) return send(ws, { t: 'error', code: 'no_searches_left' });
      const q = cleanQuery(msg.q);
      if (q.length < QUERY_MIN) return send(ws, { t: 'error', code: 'search_short' });
      if (isBlocked(q)) return send(ws, { t: 'error', code: 'search_blocked' });
      // every attempt can be a provider call - also the ones without a hit
      if (sub.searchAttempts >= HUNT_MAX_ATTEMPTS) return send(ws, { t: 'error', code: 'search_limit' });
      sub.searchAttempts += 1;
      sub.searching = true;
      touch(room, player);
      sendState(room, player);
      runHuntSearch(room, sub, player, q).catch((err) => {
        sub.searching = false;
        console.error('[hunt]', err);
      });
      return;
    }
    case 'pick': {
      // choose another tile of the own tray (hunt: search hits, swap: the pictures of others)
      if (room.phase !== 'caption' || !cur || !(isHunt(room) || isSwap(room))) return;
      const sub = cur.subs.get(player.id);
      if (!sub || sub.submitted) return;
      const tile = typeof msg.id === 'string' && msg.id.length <= 16 ? sub.hand.find((t) => t.id === msg.id) : null;
      if (!tile) return send(ws, { t: 'error', code: 'item_expired' });
      touch(room, player);
      if (tile.id === sub.pickedId) return;
      pickTile(sub, tile);
      sub.draftVersion += 1;
      return sendState(room, player);
    }
    case 'swap_search': {
      if (room.phase !== 'upload' || !cur || !isSwap(room)) return;
      const q = cleanQuery(msg.q);
      if (q.length < QUERY_MIN) return send(ws, { t: 'error', code: 'search_short' });
      if (isBlocked(q)) return send(ws, { t: 'error', code: 'search_blocked' });
      const t = now();
      if (t - (player.lastSwapSearch || 0) < 700) return;
      if (swapSearchesLeft(cur, player.id) <= 0) return send(ws, { t: 'error', code: 'search_limit' });
      player.lastSwapSearch = t;
      cur.swapSearches.set(player.id, (cur.swapSearches.get(player.id) || 0) + 1);
      touch(room, player);
      sendState(room, player);
      const kind = kindFor(room, player.id);
      search(q, { kind })
        .then((items) => {
          const list = (items || []).filter((i) => !isBroken(i.url)).slice(0, 30);
          player.swapResults = new Map(list.map((i) => [i.id, i]));
          send(ws, { t: 'swap_results', q, items: list.map(tileMedia) });
        })
        .catch(() => send(ws, { t: 'swap_results', q, items: [] }));
      return;
    }
    case 'swap_pick': {
      if (room.phase !== 'upload' || !cur || !isSwap(room)) return;
      const item = player.swapResults?.get(String(msg.id));
      if (!item) return send(ws, { t: 'error', code: 'item_expired' });
      warmMedia(item.url);
      return setContribution(room, player, item, { source: 'search' });
    }
    case 'swap_random': {
      if (room.phase !== 'upload' || !cur || !isSwap(room)) return;
      const media = randomMedia(room, player.id);
      warmMedia(media.url);
      return setContribution(room, player, media, { source: 'random' });
    }
    case 'swap_clear': {
      if (room.phase !== 'upload' || !cur || !isSwap(room) || cur.endingSoon) return;
      touch(room, player);
      if (!dropContribution(room, player.id)) return;
      return broadcast(room);
    }
    case 'vote': {
      const item = cur?.voteItem;
      if (room.phase !== 'vote' || !item || item.stage !== 'rating' || item.pid === player.id) return;
      const score = Number(msg.score);
      if (!Number.isInteger(score) || score < 1 || score > 5) return;
      touch(room, player);
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
      touch(room, player);
      // reactions to somebody else's meme while it is on screen count for the crowd award
      const item = cur?.voteItem;
      if (room.phase === 'vote' && item && item.pid !== player.id) {
        const given = item.crowd.get(player.id) || 0;
        if (given < CROWD_MAX_PER_ITEM) {
          item.crowd.set(player.id, given + 1);
          room.crowd.set(item.pid, (room.crowd.get(item.pid) || 0) + 1);
        }
      }
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
      dropFromRound(room, player.id);
      if (!player.sockets.size) player.connected = false;
      ensureHost(room);
      if (!connectedPlayers(room).length) scheduleCleanup(room);
      maybeEndCaptionEarly(room);
      maybeRevealEarly(room);
      maybeEndUploadEarly(room);
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
