import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getConfig } from './config.js';
import { createTtlCache, dedupe } from './lib/outbound.js';
import { getSharp } from './lib/sharp.js';
import { createWorkQueue } from './lib/work.js';
import { fetchWithTimeout } from './media/http.js';
import { markBroken } from './media/index.js';

// Media proxy with disk cache.
// Players never talk to Imgflip/GIPHY/KLIPY/Reddit directly: that keeps their
// IP private (GDPR friendly), avoids hotlink/CORS problems and lets the
// browser draw the media onto a canvas for the download feature.
//
//   /api/media?u=<url>            the untouched original (meme export, GIF download)
//   /api/media?u=<url>&w=<width>  picture scaled to 160/320/480/640/960/1280 px in the
//                                 best format the browser accepts (AVIF, WebP, else as it
//                                 was). Made once, then served from the disk cache.
//                                 Videos ignore w.

const ALLOWED_HOSTS = [
  /^i\.imgflip\.com$/,
  /^(media\d*|i)\.giphy\.com$/,
  /^[a-z0-9-]+\.klipy\.com$/,
  /^v\.redd\.it$/,
  /^i\.redd\.it$/,
  /^(preview|external-preview)\.redd\.it$/,
];
const MAX_BYTES = 40 * 1024 * 1024;
const inflight = new Map();
let cacheBytes = null;
// extra origins for the automated tests (a local upstream server) – empty in production
const testOrigins = new Set();

export function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    if (testOrigins.size && testOrigins.has(u.origin)) return true;
    return u.protocol === 'https:' && ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export const proxyUrl = (url) => `/api/media?u=${encodeURIComponent(url)}`;

const keyOf = (url) => crypto.createHash('sha1').update(url).digest('hex');
const files = (key) => {
  const dir = getConfig().cacheDir;
  return { data: path.join(dir, `${key}.bin`), meta: path.join(dir, `${key}.json`) };
};

// file information of the originals we served lately (saves reading the .json every time)
const metaCache = createTtlCache({ ttlMs: 10 * 60 * 1000, max: 4000 });
// "last used" on disk drives the clean-up; once every few minutes per file is exact enough
const touched = createTtlCache({ ttlMs: 5 * 60 * 1000, max: 8000 });
// Files that could not be loaded. Without this every request for a dead address
// (an old link, a search result that vanished) would ask the source again.
const failed = createTtlCache({ ttlMs: 30 * 1000, max: 4000 });
const GONE_TTL = 10 * 60 * 1000; // "does not exist / not a picture": will not change soon
const RETRY_TTL = 20 * 1000; // source busy or unreachable: try again shortly

function touch(file) {
  if (touched.get(file)) return;
  touched.set(file, true);
  const now = new Date();
  fsp.utimes(file, now, now).catch(() => {});
}

async function download(url) {
  const key = keyOf(url);
  const f = files(key);
  // one retry, 45 s for everything: a player is waiting for this file
  const request = { timeout: 30000, retries: 1, deadlineMs: 45000, headers: { Referer: '' } };
  let res = await fetchWithTimeout(url, request);
  // Imgflip search/template pages only show .jpg thumbnails – some originals are .png (and vice versa)
  const alt = res.status === 404 && /^https:\/\/i\.imgflip\.com\/[a-z0-9]+\.(jpg|png)$/i.test(url)
    ? url.replace(/\.(jpg|png)$/i, (m) => (m.toLowerCase() === '.jpg' ? '.png' : '.jpg'))
    : null;
  if (alt) {
    res.body?.cancel().catch(() => {});
    res = await fetchWithTimeout(alt, request);
  }
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw Object.assign(new Error(`upstream ${res.status}`), { status: 502, upstream: res.status });
  }
  if (!isAllowedUrl(res.url || url)) {
    res.body?.cancel().catch(() => {});
    throw Object.assign(new Error('redirect to foreign host'), { status: 403 });
  }
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm))$/.test(type)) {
    res.body?.cancel().catch(() => {});
    throw Object.assign(new Error(`unsupported type ${type}`), { status: 415 });
  }
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) {
    res.body?.cancel().catch(() => {});
    throw Object.assign(new Error('file too large'), { status: 413 });
  }
  await fsp.mkdir(path.dirname(f.data), { recursive: true });
  const tmp = `${f.data}.${process.pid}.${Date.now()}.tmp`;
  let size = 0;
  const limiter = new TransformStream({
    transform(chunk, ctrl) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) ctrl.error(Object.assign(new Error('file too large'), { status: 413 }));
      else ctrl.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body.pipeThrough(limiter)), fs.createWriteStream(tmp));
    await fsp.rename(tmp, f.data);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  const meta = { url, type, size, savedAt: Date.now() };
  await fsp.writeFile(f.meta, JSON.stringify(meta));
  if (cacheBytes !== null) cacheBytes += size;
  counts.downloads += 1;
  scheduleSweep();
  return meta;
}

async function ensureCached(url) {
  const key = keyOf(url);
  const known = metaCache.get(key);
  if (known) return known;
  const f = files(key);
  try {
    const meta = JSON.parse(await fsp.readFile(f.meta, 'utf8'));
    await fsp.access(f.data);
    metaCache.set(key, meta);
    return meta;
  } catch {
    /* not cached */
  }
  const miss = failed.get(key);
  if (miss) {
    counts.failedCached += 1;
    throw Object.assign(new Error(miss.message), { status: miss.status, repeated: true });
  }
  if (!inflight.has(url)) {
    inflight.set(
      url,
      download(url)
        .then((meta) => metaCache.set(key, meta))
        .catch((err) => {
          // 4xx from the source (except "slow down") and wrong file types stay wrong for a while
          const gone = (err.upstream >= 400 && err.upstream < 500 && err.upstream !== 429 && err.upstream !== 408) || [403, 413, 415].includes(err.status);
          failed.set(key, { message: String(err.message), status: err.status || 502 }, { ttlMs: gone ? GONE_TTL : RETRY_TTL });
          throw err;
        })
        .finally(() => inflight.delete(url)),
    );
  }
  return inflight.get(url);
}

/** Pre-load media so the first player does not wait. */
export function warmMedia(url) {
  if (isAllowedUrl(url)) ensureCached(url).catch(() => {});
}

// --- optimised picture variants ----------------------------------------------------

export const IMAGE_WIDTHS = [160, 320, 480, 640, 960, 1280];
// AVIF is the smallest format but slow to make: only for pictures up to this size
const AVIF_MAX_PIXELS = 600_000;
const STILL_MAX_PIXELS = 40_000_000;
const ANIMATION_MAX_PIXELS = 120_000_000; // all frames together
const CONVERT_SECONDS = 30;
// a "use the original" marker (empty file) is checked again after this time
const MARKER_TTL = 24 * 60 * 60 * 1000;
const TYPE_OF = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' };
const SAME_FORMAT = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'png' };
const counts = { downloads: 0, failedCached: 0, made: 0, failed: 0, notSmaller: 0, busy: 0, served: 0, servedOriginal: 0, notModified: 0 };

let work = null;
const workQueue = () => (work ||= createWorkQueue({ concurrency: getConfig().imageWorkers, maxQueue: 60 }));

/** ?w= value -> one of IMAGE_WIDTHS (the nearest one), or null for "no usable width" */
export function pickWidth(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  let best = IMAGE_WIDTHS[0];
  for (const w of IMAGE_WIDTHS) if (Math.abs(w - n) <= Math.abs(best - n)) best = w;
  return best;
}

/** does the Accept header name this type (with a quality above 0)? Wildcards do not count. */
export function acceptsType(accept, type) {
  for (const part of String(accept || '').toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((x) => x.trim());
    if (name !== type) continue;
    const q = params.find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  }
  return false;
}

/**
 * Which format should a variant have? 'avif' | 'webp' | 'jpeg' | 'png', or null
 * when only the original will do (an animation for a browser without WebP).
 *   pixels  size of the scaled picture – AVIF only when it is cheap enough
 *   busy    conversions are piling up: take the faster WebP
 */
export function negotiateFormat({ accept, type, animated = false, pixels = 0, avif = true, busy = false }) {
  const webp = acceptsType(accept, 'image/webp');
  if (animated) return webp || type === 'image/webp' ? 'webp' : null;
  if (avif && !busy && pixels <= AVIF_MAX_PIXELS && acceptsType(accept, 'image/avif')) return 'avif';
  if (webp) return 'webp';
  return SAME_FORMAT[type] || null;
}

const variantFile = (key, width, fmt) => path.join(getConfig().cacheDir, `${key}.${width}.${fmt}.bin`);

/** width, height and number of frames of an original (measured once, then kept in its .json) */
async function measure(key, meta) {
  if ((meta.w && meta.h) || meta.plain) return meta;
  return dedupe(`measure:${key}`, async () => {
    const sharp = await getSharp();
    if (!sharp) return meta;
    const f = files(key);
    try {
      const info = await sharp(f.data, { failOn: 'none', animated: true, limitInputPixels: ANIMATION_MAX_PIXELS }).metadata();
      const frames = info.pages || 1;
      let w = info.width || 0;
      let h = info.pageHeight || info.height || 0;
      if (frames === 1 && info.orientation >= 5) [w, h] = [h, w]; // EXIF: turned by 90°
      if (!w || !h) throw new Error('no size');
      Object.assign(meta, { w, h, frames });
    } catch (err) {
      // a file sharp cannot read is only ever served as it is
      console.warn(`[media] cannot read ${meta.url} as a picture: ${err.message}`);
      meta.plain = true;
    }
    metaCache.set(key, meta);
    await fsp.writeFile(f.meta, JSON.stringify(meta)).catch(() => {});
    return meta;
  });
}

async function convert(key, meta, width, fmt, target) {
  const sharp = await getSharp();
  if (!sharp) throw new Error('sharp is not available');
  const animated = meta.frames > 1;
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    let img = sharp(files(key).data, {
      failOn: 'none',
      animated,
      limitInputPixels: animated ? ANIMATION_MAX_PIXELS : STILL_MAX_PIXELS,
    }).timeout({ seconds: CONVERT_SECONDS });
    if (!animated) img = img.rotate(); // apply the EXIF orientation, the metadata is dropped
    if (width < meta.w) img = img.resize({ width, withoutEnlargement: true });
    if (fmt === 'avif') img = img.avif({ quality: 52, effort: 2 });
    else if (fmt === 'webp') img = img.webp(animated ? { quality: 72, effort: 2 } : { quality: 78, effort: 4 });
    else if (fmt === 'jpeg') img = img.jpeg({ quality: 80, mozjpeg: true });
    else img = img.png({ compressionLevel: 9 });
    const out = await img.toFile(tmp);
    if (out.size >= meta.size) {
      // not smaller than the original: remember that with an empty file
      counts.notSmaller += 1;
      await fsp.writeFile(tmp, '');
      await fsp.rename(tmp, target);
      return null;
    }
    await fsp.rename(tmp, target);
    counts.made += 1;
    if (cacheBytes !== null) cacheBytes += out.size;
    scheduleSweep();
    return { file: target, size: out.size };
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * The file to send for ?w=: { file, size, type, tag } of the variant, or null when
 * the original is the right answer. Throws with code 'busy' when the variant
 * cannot be made right now (the caller sends the original with a short cache time).
 */
async function variantFor(req, key, meta, wanted) {
  const cfg = getConfig();
  await measure(key, meta);
  if (!meta.w || !meta.h) return null;
  const animated = meta.frames > 1;
  if (animated && meta.w * meta.h * meta.frames > ANIMATION_MAX_PIXELS) return null;
  const width = Math.min(wanted, meta.w); // never upscale
  const pixels = Math.round(width * ((width / meta.w) * meta.h));
  const fmt = negotiateFormat({
    accept: req.headers.accept,
    type: meta.type,
    animated,
    pixels,
    avif: cfg.imageAvif,
    busy: workQueue().waiting >= 2,
  });
  if (!fmt) return null;
  if (width === meta.w && TYPE_OF[fmt] === meta.type) return null; // same size, same format
  const target = variantFile(key, width, fmt);
  const ready = (size) => ({ file: target, size, type: TYPE_OF[fmt], tag: `${width}-${fmt}` });
  try {
    const st = await fsp.stat(target);
    if (st.size > 0) return ready(st.size);
    if (Date.now() - st.mtimeMs < MARKER_TTL) return null;
  } catch {
    /* not made yet */
  }
  const made = await dedupe(`variant:${target}`, () =>
    workQueue()
      .run(() => convert(key, meta, width, fmt, target))
      .catch(async (err) => {
        if (err.code === 'queue_full') {
          counts.busy += 1;
          throw Object.assign(err, { code: 'busy' });
        }
        // a picture sharp cannot handle: do not try again with every request
        counts.failed += 1;
        console.warn(`[media] no ${fmt} variant for ${meta.url}: ${err.message}`);
        await fsp.writeFile(target, '').catch(() => {});
        return null;
      }),
  );
  return made ? ready(made.size) : null;
}

// --- answering ------------------------------------------------------------------------

const LONG_CACHE = 'public, max-age=2592000, immutable';

/** If-None-Match: does one of the listed tags match ours? */
function tagMatches(header, etag) {
  const value = String(header || '').trim();
  if (value === '*') return true;
  return value.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
}

export async function handleMediaRequest(req, res, searchParams) {
  const url = searchParams.get('u') || '';
  if (!isAllowedUrl(url)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('bad media url');
  }
  const key = keyOf(url);
  const wanted = getConfig().imageVariants ? pickWidth(searchParams.get('w')) : null;

  // second round only when the file vanished from the disk behind our back
  for (let round = 0; ; round++) {
    let meta;
    try {
      meta = await ensureCached(url);
    } catch (err) {
      // logged once – repeated requests for the same dead file are answered from memory
      if (!err.repeated) console.warn(`[media] could not load ${url}: ${err.message}`);
      markBroken(url);
      res.writeHead(err.status || 502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return res.end('media unavailable');
    }
    const f = files(key);
    const negotiated = Boolean(wanted) && meta.type.startsWith('image/');
    let send = { file: f.data, size: meta.size, type: meta.type, tag: 'o' };
    let cacheControl = LONG_CACHE;
    if (negotiated) {
      try {
        const variant = await variantFor(req, key, meta, wanted);
        if (variant) send = variant;
      } catch (err) {
        // too much to convert right now: the original for the moment, ask again in a minute
        if (err.code !== 'busy') console.warn(`[media] variant failed for ${url}: ${err.message}`);
        cacheControl = 'public, max-age=60';
      }
    }

    let handle;
    try {
      handle = await fsp.open(send.file, 'r');
      if (send.tag === 'o') send.size = (await handle.stat()).size;
    } catch (err) {
      await handle?.close().catch(() => {});
      if (round === 0) {
        // removed by hand or by the clean-up: forget it and fetch it again
        metaCache.delete(key);
        if (send.tag === 'o') await fsp.rm(f.meta, { force: true }).catch(() => {});
        continue;
      }
      console.warn(`[media] cache file is gone: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return res.end('media unavailable');
    }
    touch(f.data);
    if (send.tag !== 'o') touch(send.file);

    const total = send.size;
    const etag = `"${key.slice(0, 16)}-${Number(meta.savedAt || 0).toString(36)}-${send.tag}"`;
    const lastModified = new Date(Math.floor(Number(meta.savedAt || Date.now()) / 1000) * 1000);
    const headers = {
      'Content-Type': send.type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': lastModified.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    // with ?w= the answer depends on what the browser accepts
    if (negotiated) headers.Vary = 'Accept';

    const noneMatch = req.headers['if-none-match'];
    const since = Date.parse(req.headers['if-modified-since'] || '');
    if (noneMatch ? tagMatches(noneMatch, etag) : Number.isFinite(since) && lastModified.getTime() <= since) {
      await handle.close().catch(() => {});
      counts.notModified += 1;
      for (const name of ['Content-Type', 'Accept-Ranges']) delete headers[name];
      res.writeHead(304, headers);
      return res.end();
    }

    let range = req.headers.range;
    // If-Range: the range only counts for exactly the file the browser already has a part of
    const ifRange = req.headers['if-range'];
    if (range && ifRange && ifRange !== etag && ifRange !== headers['Last-Modified']) range = null;
    let start = 0;
    let end = total - 1;
    let status = 200;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        if (m[1] === '' && m[2] !== '') {
          start = Math.max(0, total - Number(m[2]));
        } else {
          start = Number(m[1] || 0);
          if (m[2] !== '') end = Math.min(total - 1, Number(m[2]));
        }
        if (start > end || start >= total) {
          await handle.close().catch(() => {});
          res.writeHead(416, { 'Content-Range': `bytes */${total}` });
          return res.end();
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
      }
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (send.tag === 'o') counts.servedOriginal += 1;
    else counts.served += 1;
    if (req.method === 'HEAD' || total === 0) {
      await handle.close().catch(() => {});
      return res.end();
    }
    const stream = handle.createReadStream({ start, end, autoClose: true });
    stream.on('error', () => res.destroy());
    // the browser went away (skipped clip): release the file
    res.on('close', () => stream.destroy());
    return stream.pipe(res);
  }
}

/** numbers for /api/status */
export function proxyStats() {
  return {
    cacheBytes,
    cacheMaxBytes: getConfig().cacheMaxBytes,
    widths: IMAGE_WIDTHS,
    variants: { ...counts, queue: workQueue().stats() },
  };
}

// --- cache size limit (least recently used files are removed) ---------------
let sweepTimer = null;
function scheduleSweep() {
  if (sweepTimer) return;
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    sweepCache().catch((e) => console.warn('[cache]', e.message));
  }, 5000);
  sweepTimer.unref?.();
}

const ORIGINAL_RE = /^([0-9a-f]{40})\.bin$/;
const VARIANT_RE = /^([0-9a-f]{40})\.\d+\.[a-z]+\.bin$/;
const META_RE = /^([0-9a-f]{40})\.json$/;

/**
 * Originals and their variants count towards CACHE_MAX_MB. When the limit is
 * reached, the files that were not used for the longest time go first; with an
 * original its variants go as well (they could not be told apart from it later).
 */
export async function sweepCache() {
  const { cacheDir, cacheMaxBytes } = getConfig();
  await fsp.mkdir(cacheDir, { recursive: true });
  const names = await fsp.readdir(cacheDir);
  const entries = [];
  const variantsOf = new Map(); // key -> [entry]
  const originals = new Set();
  const metas = [];
  let total = 0;
  for (const name of names) {
    const p = path.join(cacheDir, name);
    if (name.endsWith('.tmp')) {
      const st = await fsp.stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 10 * 60 * 1000) await fsp.rm(p, { force: true });
      continue;
    }
    const meta = META_RE.exec(name);
    if (meta) {
      metas.push({ key: meta[1], p });
      continue;
    }
    const original = ORIGINAL_RE.exec(name);
    const variant = original ? null : VARIANT_RE.exec(name);
    if (!original && !variant) continue; // pool.json and other files that are not ours to remove
    const st = await fsp.stat(p).catch(() => null);
    if (!st) continue;
    total += st.size;
    const entry = { p, key: (original || variant)[1], original: Boolean(original), size: st.size, used: Math.max(st.atimeMs, st.mtimeMs), gone: false };
    entries.push(entry);
    if (original) originals.add(entry.key);
    else variantsOf.set(entry.key, [...(variantsOf.get(entry.key) || []), entry]);
  }

  const remove = async (entry) => {
    if (entry.gone) return;
    entry.gone = true;
    await fsp.rm(entry.p, { force: true });
    touched.delete(entry.p);
    total -= entry.size;
  };
  // left-overs: variants and .json files whose original is gone
  for (const [key, list] of variantsOf) if (!originals.has(key)) for (const v of list) await remove(v);
  for (const m of metas) if (!originals.has(m.key)) await fsp.rm(m.p, { force: true });

  if (total > cacheMaxBytes) {
    entries.sort((a, b) => a.used - b.used);
    for (const e of entries) {
      if (total <= cacheMaxBytes * 0.85) break;
      if (e.gone) continue;
      await remove(e);
      if (e.original) {
        await fsp.rm(e.p.replace(/\.bin$/, '.json'), { force: true });
        metaCache.delete(e.key);
        for (const v of variantsOf.get(e.key) || []) await remove(v);
      }
    }
  }
  cacheBytes = total;
  return total;
}

/** only for tests */
export const _test = {
  /** treat this origin (e.g. http://127.0.0.1:4000) as an allowed media host */
  allowOrigin: (origin) => testOrigins.add(origin),
  reset() {
    testOrigins.clear();
    metaCache.clear();
    touched.clear();
    failed.clear();
    inflight.clear();
    work = null;
    cacheBytes = null;
    for (const name of Object.keys(counts)) counts[name] = 0;
  },
};
