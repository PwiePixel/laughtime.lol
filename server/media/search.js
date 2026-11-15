import { getConfig } from '../config.js';
import { createLimiter } from '../http.js';
import { createBackoff, createTtlCache, dedupe, hostPausedMs } from '../lib/outbound.js';
import { isAllowedUrl } from '../proxy.js';
import { giphyBase, giphyItem } from './giphy.js';
import { decodeHtml, getJson, getText, shuffle } from './http.js';
import { allPoolItems, isBroken, searchPool } from './index.js';
import { klipyBase, klipyList, klipyParams, toItem as klipyItem } from './klipy.js';

// ---------------------------------------------------------------------------
// Free-text media search, used by the "GIF Hunt" game mode and the Meme Studio.
// Sources: GIPHY + KLIPY (with key), Imgflip template search (no key),
// and the in-memory template pool as a fallback.
// Every item that was ever returned is remembered for a while, so the studio
// can add it to a pack by id without trusting URLs sent by the browser.
//
// The APIs are protected against search spam:
//   - results are cached per normalised query + kind (SEARCH_CACHE_MINUTES),
//     "nothing found" only for a short time, the cache has a size limit
//   - the same search asked by several players at once runs only once
//   - a provider that fails or is rate limited is skipped for a growing pause;
//     the search then answers with the other providers and the template pool
//   - every request goes through the outbound queue (hourly budget, 429 pause)
//   - one person can only use a part of an hourly budget; after that their new
//     searches are answered without that provider (see "personal share")
// ---------------------------------------------------------------------------

const EMPTY_TTL = 3 * 60 * 1000; // "nothing found" – new content may show up soon
const DEGRADED_TTL = 45 * 1000; // a provider was missing – ask again soon
// A search term and its results leave the memory at most one hour after the
// search (the privacy text says so): the cache time plus the time old results
// stay as a fallback for a degraded search never exceed MAX_LIFE_MS, and a
// sweep removes what nobody asked for again.
const SWEEP_MS = 60 * 1000;
const MAX_LIFE_MS = 60 * 60 * 1000 - SWEEP_MS;
const KNOWN_TTL = 2 * 60 * 60 * 1000;
const known = new Map(); // id -> { at, item }

let cache = null; // key -> { items, degraded, at }
let sweeper = null;
function searchCache() {
  if (!cache) {
    cache = createTtlCache({ ttlMs: getConfig().searchCacheMs, max: getConfig().searchCacheMax });
    sweeper ||= setInterval(() => cache?.sweep(), SWEEP_MS);
    sweeper.unref?.();
  }
  return cache;
}
const counts = { hits: 0, misses: 0, shared: 0, degraded: 0, limited: 0 };

// Searches must feel instant: short timeouts, at most one retry, no long waiting
// in a queue. 'low' priority keeps a part of the hourly budget free for the pool.
const SEARCH_FETCH = { timeout: 6000, retries: 1, maxWaitMs: 1500, maxQueueMs: 2500, deadlineMs: 8000, priority: 'low' };

const PROVIDERS = ['imgflip', 'giphy', 'klipy'];
const breakers = Object.fromEntries(PROVIDERS.map((name) => [name, createBackoff({ baseMs: 20_000, maxMs: 10 * 60_000, jitter: 0.2 })]));
const providerCounts = Object.fromEntries(PROVIDERS.map((name) => [name, { calls: 0, errors: 0, skipped: 0 }]));

/**
 * Ask one provider. Never throws: a provider that is paused, out of budget or
 * broken simply contributes nothing (the caller marks the result as degraded).
 */
async function ask(name, origin, fn) {
  const breaker = breakers[name];
  const count = providerCounts[name];
  if (!breaker.ready()) {
    count.skipped += 1;
    return { ok: false, value: null };
  }
  count.calls += 1;
  try {
    const value = await fn();
    breaker.succeed();
    return { ok: true, value };
  } catch (err) {
    count.errors += 1;
    // budget used up / host paused: the outbound queue already answers without a request
    const local = err?.code === 'budget_exhausted' || err?.code === 'host_paused';
    if (!local) {
      const pause = breaker.fail(err?.status === 429 ? hostPausedMs(origin) : 0);
      console.warn(`[search] ${name}: ${String(err?.message || err).slice(0, 120)} – paused for ${Math.round(pause / 1000)} s`);
    }
    return { ok: false, value: null };
  }
}

// --- personal share ------------------------------------------------------------
// The hourly budgets are for all players together. Without a limit per person
// one account (or one guest with a script) could use them up within minutes and
// switch the search off for everybody else.

const SEARCH_PART = 0.8; // what searches may use of a budget (the rest is for the pool)
const ACCOUNT_PART = 0.25; // … and one account of that
const GUEST_PART = 0.5; // guests count per address, which several players may share
const used = createLimiter({ windowMs: 60 * 60 * 1000, max: Infinity });

/** requests one new search sends to a provider */
const callsOf = (name, kind, cfg) => (name === 'imgflip' ? (kind === 'any' ? 2 : 1) : name === 'klipy' ? cfg.klipyTypes.length : 1);

function activeProviders(kind, cfg) {
  const wantVideo = kind !== 'image';
  return PROVIDERS.filter((name) => (name === 'imgflip' ? cfg.imgflipEnabled : wantVideo && cfg[`${name}Key`]));
}

/** calls per hour one person may cause at a provider (Infinity without a budget) */
function shareOf(name, who, cfg) {
  const limit = cfg[`${name}HourlyLimit`];
  if (!(limit > 0)) return Infinity;
  const part = who.startsWith('u:') ? ACCOUNT_PART : GUEST_PART;
  return Math.max(callsOf(name, 'any', cfg), Math.floor(limit * SEARCH_PART * part));
}

/** providers this person may not call for a new search any more */
const overShare = (who, kind, cfg) =>
  activeProviders(kind, cfg).filter((name) => used.count(`${name}|${who}`) + callsOf(name, kind, cfg) > shareOf(name, who, cfg));

function charge(who, kind, cfg, skip = []) {
  for (const name of activeProviders(kind, cfg)) {
    if (skip.includes(name)) continue;
    for (let i = callsOf(name, kind, cfg); i > 0; i--) used.hit(`${name}|${who}`);
  }
}

const ch = (n) => String.fromCharCode(n);
const CTRL = new RegExp(`[${ch(0)}-${ch(31)}${ch(127)}<>"\\\\]`, 'g');

export const QUERY_MIN = 2;
export const QUERY_MAX = 40;

export function cleanQuery(q) {
  return String(q ?? '')
    .replace(CTRL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, QUERY_MAX);
}

export function isBlocked(text) {
  const t = String(text || '').toLowerCase();
  return getConfig().blockedWords.some((w) => t.includes(w));
}

function remember(items) {
  const t = Date.now();
  for (const item of items) known.set(item.id, { at: t, item });
  if (known.size > 20000) {
    for (const [id, v] of known) if (t - v.at > KNOWN_TTL || known.size > 15000) known.delete(id);
  }
}

/** item that was shown to someone recently (search result or pool item) */
export function findKnownItem(id) {
  const hit = known.get(id);
  if (hit && Date.now() - hit.at < KNOWN_TTL) return hit.item;
  return allPoolItems().find((i) => i.id === id) || null;
}

// --- Imgflip template search (public page, no key) -------------------------

function parseImgflipSearch(html, animatedOnly) {
  const out = [];
  for (const box of html.split('class="mt-box"').slice(1)) {
    const link = box.match(/href="\/meme\/(?:(\d+)\/)?([^"]+)"[^>]*>([^<]+)<\/a>/);
    const img = box.match(/src="\/\/i\.imgflip\.com\/\d+\/([a-z0-9]+)\.(jpg|jpeg|png|gif)"/i);
    const thumbPath = box.match(/src="\/\/(i\.imgflip\.com\/\d+\/[a-z0-9]+\.(?:jpg|jpeg|png|gif))"/i)?.[1];
    const size = box.match(/style="width:([\d.]+)px;height:([\d.]+)px"/);
    if (!link || !img) continue;
    const animated = box.includes('mt-animated-label');
    if (animatedOnly && !animated) continue;
    const code = img[1];
    const numId = link[1] || String(parseInt(code, 36));
    const w = size ? Number(size[1]) : 150;
    const h = size ? Number(size[2]) : 150;
    const width = animated ? 480 : 600;
    const height = Math.round((width * h) / Math.max(1, w));
    out.push({
      id: `imgflip:${numId}`,
      kind: animated ? 'video' : 'image',
      url: animated ? `https://i.imgflip.com/${code}.mp4` : `https://i.imgflip.com/${code}.${img[2].toLowerCase()}`,
      thumb: thumbPath ? `https://${thumbPath}` : null,
      width,
      height,
      title: decodeHtml(link[3]).trim(),
      source: 'imgflip',
      link: animated ? `https://imgflip.com/gif-maker/${numId}` : `https://imgflip.com/memegenerator/${link[2]}`,
    });
  }
  return out;
}

// address of the Imgflip search page (replaced by a local server in the tests)
const endpoints = { imgflipSearch: 'https://imgflip.com/memesearch' };

/** returns [images, animated] */
async function searchImgflip(q, kind) {
  const base = `${endpoints.imgflipSearch}?q=${encodeURIComponent(q)}`;
  const [img, gif] = await Promise.allSettled([
    kind !== 'video' ? getText(base, SEARCH_FETCH).then((h) => parseImgflipSearch(h, false)) : [],
    kind !== 'image' ? getText(`${base}&gifs_only=on`, SEARCH_FETCH).then((h) => parseImgflipSearch(h, true)) : [],
  ]);
  const failed = [img, gif].filter((r) => r.status === 'rejected');
  // only a provider that returned nothing at all counts as failed
  if (failed.length && (failed.length === 2 || kind !== 'any')) throw failed[0].reason;
  const ok = (r) => (r.status === 'fulfilled' ? r.value : []);
  const lists = [ok(img).filter((i) => i.kind === 'image'), ok(gif).filter((i) => i.kind === 'video')];
  lists.partial = failed.length > 0;
  return lists;
}

// --- GIPHY / KLIPY -----------------------------------------------------------

async function searchGiphy(q) {
  const cfg = getConfig();
  const url =
    `${giphyBase(cfg)}/search?api_key=${encodeURIComponent(cfg.giphyKey)}&limit=40&rating=${cfg.contentRating}` +
    `&bundle=messaging_non_clips&lang=en&q=${encodeURIComponent(q)}`;
  const data = await getJson(url, SEARCH_FETCH);
  return (data?.data || []).map(giphyItem).filter(Boolean);
}

async function searchKlipy(q) {
  const cfg = getConfig();
  const res = await Promise.allSettled(
    cfg.klipyTypes.map((type) =>
      getJson(`${klipyBase(cfg)}/${type}/search?${klipyParams(cfg, 30)}&q=${encodeURIComponent(q)}`, SEARCH_FETCH).then((json) =>
        klipyList(json).map((raw) => klipyItem(raw, type)),
      ),
    ),
  );
  if (res.length && res.every((r) => r.status === 'rejected')) {
    // do not leak the key (it is part of the address) into the log
    const reason = res[0].reason;
    throw Object.assign(new Error(String(reason?.message || reason).replaceAll(cfg.klipyKey, '***')), { status: reason?.status, code: reason?.code });
  }
  const items = res.flatMap((r) => (r.status === 'fulfilled' ? r.value.filter(Boolean) : []));
  items.partial = res.some((r) => r.status === 'rejected');
  return items;
}

const originOf = (base) => {
  try {
    return new URL(base).host;
  } catch {
    return '';
  }
};

/** same words, same cache entry: case, Unicode form, spaces and punctuation at the ends do not matter */
export function searchKey(q, kind = 'any') {
  const norm = cleanQuery(q)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^[\s.,;:!?'()-]+|[\s.,;:!?'()-]+$/g, '')
    .replace(/\s+/g, ' ');
  return `${kind}|${norm}`;
}

/** skip: providers that are left out (personal share used up) – such an answer is never cached */
async function runSearch(q, kind, key, skip = []) {
  const cfg = getConfig();
  const on = activeProviders(kind, cfg).filter((name) => !skip.includes(name));
  const jobs = [];
  if (on.includes('imgflip')) jobs.push(ask('imgflip', originOf(endpoints.imgflipSearch), () => searchImgflip(q, kind)).then((r) => ({ ...r, multi: true })));
  if (on.includes('giphy')) jobs.push(ask('giphy', originOf(giphyBase(cfg)), () => searchGiphy(q)));
  if (on.includes('klipy')) jobs.push(ask('klipy', originOf(klipyBase(cfg)), () => searchKlipy(q)));
  const answers = await Promise.all(jobs);
  // degraded: a provider is missing completely or answered only in part
  const degraded = answers.some((a) => !a.ok || a.value.partial);
  const lists = answers.flatMap((a) => (!a.ok ? [] : a.multi ? a.value : [a.value]));
  lists.push(searchPool(q, kind === 'any' ? undefined : kind));

  // interleave sources so one big source does not push the others away
  const merged = [];
  const seen = new Set();
  const max = Math.max(...lists.map((l) => l.length), 0);
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item || seen.has(item.id)) continue;
      if (kind !== 'any' && item.kind !== kind) continue;
      if (!isAllowedUrl(item.url) || isBlocked(item.title) || isBroken(item.url)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }

  if (skip.length) return merged;
  const store = searchCache();
  if (degraded) {
    counts.degraded += 1;
    // a complete answer from earlier beats what is left while a provider is down
    const old = store.peek(key);
    // kept for the rest of its hour, not for a new one
    const left = old ? old.at + MAX_LIFE_MS - Date.now() : 0;
    if (old && !old.degraded && old.items.length >= merged.length && left > 0) {
      const ttlMs = Math.min(DEGRADED_TTL, left);
      store.set(key, old, { ttlMs, staleMs: left - ttlMs });
      return old.items;
    }
  }
  const ttlMs = Math.min(MAX_LIFE_MS, degraded ? DEGRADED_TTL : merged.length ? cfg.searchCacheMs : Math.min(EMPTY_TTL, cfg.searchCacheMs));
  store.set(key, { items: merged, degraded, at: Date.now() }, { ttlMs, staleMs: degraded ? 0 : MAX_LIFE_MS - ttlMs });
  return merged;
}

/**
 * Search all sources.
 * kind: 'image' | 'video' | 'any'
 * who:  the person who asks ('u:<account id>', otherwise a guest key such as the
 *       address hash) – new searches count against their share of the budgets
 * Returns a de-duplicated, filtered list (sources mixed evenly).
 */
export async function searchMedia(query, { kind = 'any', who = '' } = {}) {
  const q = cleanQuery(query);
  if (q.length < QUERY_MIN || isBlocked(q)) return [];
  if (!['image', 'video'].includes(kind)) kind = 'any';
  const key = searchKey(q, kind);
  const hit = searchCache().get(key);
  let items;
  if (hit) {
    counts.hits += 1;
    // files that broke in the meantime are not offered again
    items = hit.items.filter((i) => !isBroken(i.url));
  } else {
    const cfg = getConfig();
    const skip = who ? overShare(who, kind, cfg) : [];
    if (skip.length) {
      counts.limited += 1;
      // an older complete answer first, else what the other providers and the pool have
      const old = searchCache().peek(key);
      if (old && !old.degraded) {
        items = old.items;
      } else {
        charge(who, kind, cfg, skip);
        items = await runSearch(q, kind, key, skip);
      }
    } else {
      let shared = true;
      items = await dedupe(`search:${key}`, () => {
        shared = false;
        counts.misses += 1;
        if (who) charge(who, kind, cfg);
        return runSearch(q, kind, key);
      });
      if (shared) counts.shared += 1;
    }
  }
  // also for cached answers: the studio may add these items by id for the next two hours
  remember(items);
  return items;
}

/** numbers for /api/status */
export function searchStats() {
  const providers = {};
  for (const name of PROVIDERS) {
    providers[name] = { ...providerCounts[name], failuresInRow: breakers[name].failures, pausedMs: breakers[name].waitMs() };
  }
  const { size, max } = searchCache().stats();
  return { cache: { size, max, ...counts }, known: known.size, providers };
}

/** random items from the pool (studio "browse" without a search term) */
export function browseMedia(kind = 'any', n = 40) {
  const items = shuffle(allPoolItems(kind === 'any' ? undefined : kind).filter((i) => !isBroken(i.url))).slice(0, n);
  remember(items);
  return items;
}

export const _test = {
  parseImgflipSearch,
  endpoints,
  breakers,
  MAX_LIFE_MS,
  searchCache,
  /** forget everything (cache, pauses, counters) */
  reset() {
    cache = null;
    known.clear();
    for (const name of PROVIDERS) {
      breakers[name].succeed();
      Object.assign(providerCounts[name], { calls: 0, errors: 0, skipped: 0 });
    }
    Object.assign(counts, { hits: 0, misses: 0, shared: 0, degraded: 0, limited: 0 });
    used.clear();
  },
};
