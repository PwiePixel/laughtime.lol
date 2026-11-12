import { getConfig } from '../config.js';
import { loadGiphyVideos } from './giphy.js';
import { loadImgflipImages, loadImgflipVideos } from './imgflip.js';
import { loadKlipyVideos } from './klipy.js';
import { loadRedditImages, loadRedditVideos } from './reddit.js';

// Media pool: pulls templates and short clips from all configured sources,
// keeps them in memory and refreshes them in the background.

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

const SOURCES = [
  { key: 'imgflip-images', kind: 'image', source: 'imgflip', load: (c) => (c.imgflipEnabled ? loadImgflipImages(c) : null) },
  { key: 'imgflip-videos', kind: 'video', source: 'imgflip', load: (c) => (c.imgflipEnabled ? loadImgflipVideos(c) : null) },
  { key: 'giphy', kind: 'video', source: 'giphy', load: loadGiphyVideos },
  { key: 'klipy', kind: 'video', source: 'klipy', load: loadKlipyVideos },
  { key: 'reddit-videos', kind: 'video', source: 'reddit', load: loadRedditVideos },
  { key: 'reddit-images', kind: 'image', source: 'reddit', load: loadRedditImages },
];

const REFRESH_MS = 30 * 60 * 1000;
const BROKEN_TTL = 6 * 60 * 60 * 1000;
const broken = new Map(); // url -> time it failed

/** Called when a file could not be loaded – it will not be picked again for a while. */
export function markBroken(url) {
  broken.set(url, Date.now());
}
const RETRY_MS = 5 * 60 * 1000;

const state = {
  // key -> { items, status: 'off'|'ok'|'error'|'loading', error, updatedAt }
  sources: new Map(SOURCES.map((s) => [s.key, { items: [], status: 'loading', error: null, updatedAt: 0 }])),
  firstLoad: null,
  timer: null,
};

function isAllowed(item, cfg) {
  const t = String(item.title || '').toLowerCase();
  return !cfg.blockedWords.some((w) => t.includes(w));
}

async function refreshSource(src) {
  const cfg = getConfig();
  const entry = state.sources.get(src.key);
  try {
    const items = await src.load(cfg);
    if (items === null) {
      entry.status = 'off';
      entry.items = [];
      return;
    }
    const seen = new Set();
    const clean = items.filter((i) => i.url && isAllowed(i, cfg) && !seen.has(i.id) && seen.add(i.id));
    if (clean.length) {
      entry.items = clean;
      entry.status = 'ok';
      entry.error = null;
    } else if (!entry.items.length) {
      entry.status = 'error';
      entry.error = 'no items returned';
    }
    entry.updatedAt = Date.now();
  } catch (err) {
    entry.status = entry.items.length ? 'ok' : 'error';
    entry.error = String(err?.message || err);
    console.warn(`[media] ${src.key}: ${entry.error}`);
  }
}

export async function refreshAll() {
  const cutoff = Date.now() - BROKEN_TTL;
  for (const [url, t] of broken) if (t < cutoff) broken.delete(url);
  await Promise.all(SOURCES.map(refreshSource));
  const summary = SOURCES.map((s) => {
    const e = state.sources.get(s.key);
    return `${s.key}=${e.status === 'ok' ? e.items.length : e.status}`;
  }).join('  ');
  console.log(`[media] ${summary}`);
}

export function startMediaPool() {
  if (state.firstLoad) return state.firstLoad;
  state.firstLoad = refreshAll();
  const loop = () => {
    const anyError = [...state.sources.values()].some((e) => e.status === 'error');
    state.timer = setTimeout(async () => {
      await refreshAll();
      loop();
    }, anyError ? RETRY_MS : REFRESH_MS);
    state.timer.unref?.();
  };
  state.firstLoad.then(loop);
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
    out[s.key] = { status: e.status, count: e.items.length, error: e.error, updatedAt: e.updatedAt };
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
