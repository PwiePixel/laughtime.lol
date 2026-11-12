import { getConfig } from '../config.js';
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
// ---------------------------------------------------------------------------

const CACHE_TTL = 15 * 60 * 1000;
const KNOWN_TTL = 2 * 60 * 60 * 1000;
const cache = new Map(); // key -> { at, items }
const known = new Map(); // id -> { at, item }

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

/** returns [images, animated] */
async function searchImgflip(q, kind) {
  const cfg = getConfig();
  if (!cfg.imgflipEnabled) return [[], []];
  const base = `https://imgflip.com/memesearch?q=${encodeURIComponent(q)}`;
  const [img, gif] = await Promise.allSettled([
    kind !== 'video' ? getText(base, { timeout: 7000 }).then((h) => parseImgflipSearch(h, false)) : [],
    kind !== 'image' ? getText(`${base}&gifs_only=on`, { timeout: 7000 }).then((h) => parseImgflipSearch(h, true)) : [],
  ]);
  if (img.status === 'rejected' && gif.status === 'rejected') throw img.reason;
  const ok = (r) => (r.status === 'fulfilled' ? r.value : []);
  return [ok(img).filter((i) => i.kind === 'image'), ok(gif).filter((i) => i.kind === 'video')];
}

// --- GIPHY / KLIPY -----------------------------------------------------------

async function searchGiphy(q) {
  const cfg = getConfig();
  if (!cfg.giphyKey) return [];
  const url =
    `${giphyBase(cfg)}/search?api_key=${encodeURIComponent(cfg.giphyKey)}&limit=40&rating=${cfg.contentRating}` +
    `&bundle=messaging_non_clips&lang=en&q=${encodeURIComponent(q)}`;
  const data = await getJson(url, { timeout: 7000 });
  return (data?.data || []).map(giphyItem).filter(Boolean);
}

async function searchKlipy(q) {
  const cfg = getConfig();
  if (!cfg.klipyKey) return [];
  const res = await Promise.allSettled(
    cfg.klipyTypes.map((type) =>
      getJson(`${klipyBase(cfg)}/${type}/search?${klipyParams(cfg, 30)}&q=${encodeURIComponent(q)}`, { timeout: 7000 }).then(
        (json) => klipyList(json).map((raw) => klipyItem(raw, type)),
      ),
    ),
  );
  return res.flatMap((r) => (r.status === 'fulfilled' ? r.value.filter(Boolean) : []));
}

/**
 * Search all sources.
 * kind: 'image' | 'video' | 'any'
 * Returns a de-duplicated, filtered list (sources mixed evenly).
 */
export async function searchMedia(query, { kind = 'any' } = {}) {
  const q = cleanQuery(query);
  if (q.length < QUERY_MIN || isBlocked(q)) return [];
  const key = `${kind}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;

  const wantVideo = kind !== 'image';
  const jobs = [searchImgflip(q, kind)];
  if (wantVideo) jobs.push(searchGiphy(q), searchKlipy(q));
  const settled = await Promise.allSettled(jobs);
  const lists = settled.flatMap((r, i) => (r.status !== 'fulfilled' ? [] : i === 0 ? r.value : [r.value]));
  for (const r of settled) if (r.status === 'rejected') console.warn('[search]', String(r.reason?.message || r.reason).slice(0, 160));
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
  remember(merged);
  cache.set(key, { at: Date.now(), items: merged });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return merged;
}

/** random items from the pool (studio "browse" without a search term) */
export function browseMedia(kind = 'any', n = 40) {
  const items = shuffle(allPoolItems(kind === 'any' ? undefined : kind).filter((i) => !isBroken(i.url))).slice(0, n);
  remember(items);
  return items;
}

export const _test = { parseImgflipSearch };
