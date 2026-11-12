import crypto from 'node:crypto';
import path from 'node:path';
import { getConfig } from '../config.js';
import { persistOutbound } from '../lib/outbound.js';
import { loadGiphyVideos } from './giphy.js';
import { applyBudgets } from './http.js';
import { loadImgflipImages, loadImgflipVideos } from './imgflip.js';
import { loadKlipyVideos } from './klipy.js';
import { createMediaPool } from './pool.js';
import { loadRedditImages, loadRedditVideos } from './reddit.js';

// Media pool: pulls templates and short clips from all configured sources,
// keeps them in memory and refreshes them in the background. The schedule
// (jitter, back-off after errors) and the copy on disk live in pool.js.

const FALLBACK_IMAGES = [
  ['181913649', 'Drake Hotline Bling', '30b1gx.jpg', 1200, 1200],
  ['87743020', 'Two Buttons', '1g8my4.jpg', 600, 908],
  ['112126428', 'Distracted Boyfriend', '1ur9b0.jpg', 1200, 800],
  ['217743513', 'UNO Draw 25 Cards', '3lmzyx.jpg', 500, 494],
  ['124822590', 'Left Exit 12 Off Ramp', '22bdq6.jpg', 804, 767],
  ['252600902', 'Always Has Been', '46e43q.png', 960, 540],
  ['135256802', 'Epic Handshake', '28j0te.jpg', 900, 645],
  ['131940431', "Gru's Plan", '26jxvz.jpg', 700, 449],
  ['4087833', 'Waiting Skeleton', '2fm6x.jpg', 298, 403],
  ['97984', 'Disaster Girl', '23ls.jpg', 500, 375],
  ['129242436', 'Change My Mind', '24y43o.jpg', 482, 361],
  ['309868304', 'Trade Offer', '54hjww.jpg', 607, 794],
].map(([id, title, file, width, height]) => ({
  id: `imgflip:${id}`, kind: 'image', url: `https://i.imgflip.com/${file}`, width, height, title, source: 'imgflip',
  link: `https://imgflip.com/memegenerator/${id}`,
}));

const FALLBACK_VIDEOS = [
  ['222516354', 'Disappearing kid', '3ohapu'],
  ['304768047', 'Talking to wall', '51g8j3'],
  ['367782046', 'Looking up', '62yufy'],
  ['511357979', 'Confused Monkey', '8gg6cb'],
  ['306216142', 'Chef reading a letter', '52b9vy'],
  ['171219241', 'Disappears into bush', '2txtm1'],
  ['324040475', 'Running', '5cxb8b'],
  ['308128486', 'Yelling Beaver', '53g9gm'],
].map(([id, title, code]) => ({
  id: `imgflip:${id}`, kind: 'video', url: `https://i.imgflip.com/${code}.mp4`, width: 480, height: 480, title, source: 'imgflip',
  link: `https://imgflip.com/gif-maker/${id}`,
}));

// fingerprint of the settings a source depends on: when they change, the saved
// pool of that source is refreshed right after the restart (keys are only hashed)
const sig = (...parts) => crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);

// on:   is the source switched on with the current settings? (no request is made to find out)
// load: fetch the items
const SOURCES = [
  {
    key: 'imgflip-images',
    kind: 'image',
    source: 'imgflip',
    on: (c) => c.imgflipEnabled,
    sig: (c) => sig(c.imgflipPages),
    load: (c) => (c.imgflipEnabled ? loadImgflipImages(c) : null),
  },
  {
    key: 'imgflip-videos',
    kind: 'video',
    source: 'imgflip',
    on: (c) => c.imgflipEnabled,
    sig: (c) => sig(c.imgflipPages),
    load: (c) => (c.imgflipEnabled ? loadImgflipVideos(c) : null),
  },
  {
    key: 'giphy',
    kind: 'video',
    source: 'giphy',
    on: (c) => Boolean(c.giphyKey),
    sig: (c) => sig(c.giphyKey, c.giphyApiBase, c.contentRating, c.searchTerms),
    load: loadGiphyVideos,
  },
  {
    key: 'klipy',
    kind: 'video',
    source: 'klipy',
    on: (c) => Boolean(c.klipyKey),
    sig: (c) => sig(c.klipyKey, c.klipyApiBase, c.klipyTypes, c.klipyLocale, c.contentRating, c.searchTerms),
    load: loadKlipyVideos,
  },
  {
    key: 'reddit-videos',
    kind: 'video',
    source: 'reddit',
    on: (c) => c.redditEnabled && c.redditVideoSubs.length > 0,
    sig: (c) => sig(c.redditVideoSubs, c.maxVideoSeconds, Boolean(c.redditClientId)),
    load: loadRedditVideos,
  },
  {
    key: 'reddit-images',
    kind: 'image',
    source: 'reddit',
    on: (c) => c.redditEnabled && c.redditImageSubs.length > 0,
    sig: (c) => sig(c.redditImageSubs, Boolean(c.redditClientId)),
    load: loadRedditImages,
  },
];

const BROKEN_TTL = 6 * 60 * 60 * 1000;
const broken = new Map(); // url -> time it failed

/** Called when a file could not be loaded – it will not be picked again for a while. */
export function markBroken(url) {
  broken.set(url, Date.now());
}

function isAllowed(item, cfg) {
  const t = String(item.title || '').toLowerCase();
  return !cfg.blockedWords.some((w) => t.includes(w));
}

function forgetOldBroken() {
  const cutoff = Date.now() - BROKEN_TTL;
  for (const [url, t] of broken) if (t < cutoff) broken.delete(url);
}

const pool = createMediaPool({
  sources: SOURCES,
  // resolved late: the cache folder comes from the settings
  file: () => path.join(getConfig().cacheDir, 'pool.json'),
  getCfg: getConfig,
  allow: isAllowed,
  beforeRefresh: forgetOldBroken,
});

const state = {
  // key -> { items, status: 'off'|'ok'|'error'|'loading', error, updatedAt, failures, nextAt }
  sources: pool.entries,
  firstLoad: null,
};

/** Load every source now, no matter when it is due. */
export async function refreshAll() {
  await pool.refreshDue({ force: true });
}

export function startMediaPool() {
  if (state.firstLoad) return state.firstLoad;
  // hourly budgets and rate-limit pauses of the APIs survive restarts as well
  applyBudgets();
  state.firstLoad = persistOutbound(path.join(getConfig().cacheDir, 'outbound.json'))
    .catch(() => {})
    .then(() => pool.start());
  return state.firstLoad;
}

/** Wait for the first load, but never longer than `ms`. */
export function mediaReady(ms = 8000) {
  const first = state.firstLoad || startMediaPool();
  return Promise.race([first, new Promise((r) => setTimeout(r, ms))]);
}

function groups(kind) {
  const out = [];
  for (const s of SOURCES) {
    if (s.kind !== kind) continue;
    const e = state.sources.get(s.key);
    if (e.items.length) out.push(e.items);
  }
  if (!out.length) out.push(kind === 'video' ? FALLBACK_VIDEOS : FALLBACK_IMAGES);
  return out;
}

/**
 * Pick a random item. Sources are chosen evenly first (so one big source does
 * not drown the others), then a random item that was not used yet.
 */
export function pickMedia(kind, used = new Set()) {
  const pools = groups(kind);
  const order = pools.map((p) => ({ p, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.p);
  for (const pool of order) {
    for (let tries = 0; tries < 25; tries++) {
      const item = pool[Math.floor(Math.random() * pool.length)];
      if (!used.has(item.id) && !broken.has(item.url)) return item;
    }
    const fresh = pool.filter((i) => !used.has(i.id) && !broken.has(i.url));
    if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
  }
  const all = pools.flat();
  return all[Math.floor(Math.random() * all.length)];
}

export function mediaStatus() {
  const cfg = getConfig();
  const out = {};
  for (const s of SOURCES) {
    const e = state.sources.get(s.key);
    out[s.key] = {
      status: e.status,
      count: e.items.length,
      error: e.error,
      updatedAt: e.updatedAt,
      // errors in a row, when the next load is due and whether the items come from the saved pool
      failures: e.status === 'off' ? 0 : e.failures,
      nextInMs: e.status === 'off' ? null : Math.max(0, e.nextAt - Date.now()),
      restored: e.restored,
    };
  }
  return {
    sources: out,
    images: groups('image').flat().length,
    videos: groups('video').flat().length,
    keys: { giphy: Boolean(cfg.giphyKey), klipy: Boolean(cfg.klipyKey), redditOAuth: Boolean(cfg.redditClientId) },
  };
}

export function activeSourceNames() {
  const names = new Set();
  for (const s of SOURCES) if (state.sources.get(s.key).items.length) names.add(s.source);
  if (!names.size) names.add('imgflip');
  return [...names];
}

/** every item currently in the pool (plus fallbacks) – used by search and the studio */
export function allPoolItems(kind) {
  const kinds = kind === 'image' || kind === 'video' ? [kind] : ['image', 'video'];
  return kinds.flatMap((k) => groups(k).flat());
}

export const isBroken = (url) => broken.has(url);

/** numbers for /api/status */
export const poolStats = () => pool.stats();

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter(Boolean);

/** simple title search over the in-memory pool (works without any API key) */
export function searchPool(query, kind) {
  const q = words(query);
  if (!q.length) return [];
  const scored = [];
  for (const item of allPoolItems(kind)) {
    const title = words(item.title);
    let score = 0;
    for (const w of q) {
      if (title.includes(w)) score += 3;
      else if (w.length >= 3 && title.some((t) => t.startsWith(w) || (t.length >= 4 && w.startsWith(t)))) score += 1;
    }
    if (score >= Math.max(1, q.length)) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 60).map((x) => x.item);
}
