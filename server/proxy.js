import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getConfig } from './config.js';
import { fetchWithTimeout } from './media/http.js';
import { markBroken } from './media/index.js';

// Media proxy with disk cache.
// Players never talk to Imgflip/GIPHY/KLIPY/Reddit directly: that keeps their
// IP private (GDPR friendly), avoids hotlink/CORS problems and lets the
// browser draw the media onto a canvas for the download feature.

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

export function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
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

async function download(url) {
  const key = keyOf(url);
  const f = files(key);
  let res = await fetchWithTimeout(url, { timeout: 25000, headers: { Referer: '' } });
  // Imgflip search/template pages only show .jpg thumbnails – some originals are .png (and vice versa)
  const alt = res.status === 404 && /^https:\/\/i\.imgflip\.com\/[a-z0-9]+\.(jpg|png)$/i.test(url)
    ? url.replace(/\.(jpg|png)$/i, (m) => (m.toLowerCase() === '.jpg' ? '.png' : '.jpg'))
    : null;
  if (alt) {
    res.body?.cancel().catch(() => {});
    res = await fetchWithTimeout(alt, { timeout: 25000, headers: { Referer: '' } });
  }
  if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { status: 502 });
  if (!isAllowedUrl(res.url || url)) throw Object.assign(new Error('redirect to foreign host'), { status: 403 });
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm))$/.test(type)) {
    throw Object.assign(new Error(`unsupported type ${type}`), { status: 415 });
  }
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw Object.assign(new Error('file too large'), { status: 413 });
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
  scheduleSweep();
  return meta;
}

async function ensureCached(url) {
  const f = files(keyOf(url));
  try {
    const meta = JSON.parse(await fsp.readFile(f.meta, 'utf8'));
    await fsp.access(f.data);
    const now = new Date();
    fsp.utimes(f.data, now, now).catch(() => {});
    return meta;
  } catch {
    /* not cached */
  }
  if (!inflight.has(url)) {
    inflight.set(url, download(url).finally(() => inflight.delete(url)));
  }
  return inflight.get(url);
}

/** Pre-load media so the first player does not wait. */
export function warmMedia(url) {
  if (isAllowedUrl(url)) ensureCached(url).catch(() => {});
}

export async function handleMediaRequest(req, res, searchParams) {
  const url = searchParams.get('u') || '';
  if (!isAllowedUrl(url)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('bad media url');
  }
  let meta;
  try {
    meta = await ensureCached(url);
  } catch (err) {
    console.warn(`[media] could not load ${url}: ${err.message}`);
    markBroken(url);
    res.writeHead(err.status || 502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end('media unavailable');
  }
  const f = files(keyOf(url));
  const total = meta.size;
  const headers = {
    'Content-Type': meta.type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=604800, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  const range = req.headers.range;
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
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
    }
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(f.data, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
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

export async function sweepCache() {
  const { cacheDir, cacheMaxBytes } = getConfig();
  await fsp.mkdir(cacheDir, { recursive: true });
  const names = await fsp.readdir(cacheDir);
  const entries = [];
  let total = 0;
  for (const name of names) {
    const p = path.join(cacheDir, name);
    if (name.endsWith('.tmp')) {
      const st = await fsp.stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 10 * 60 * 1000) await fsp.rm(p, { force: true });
      continue;
    }
    if (!name.endsWith('.bin')) continue;
    const st = await fsp.stat(p).catch(() => null);
    if (!st) continue;
    total += st.size;
    entries.push({ p, size: st.size, used: Math.max(st.atimeMs, st.mtimeMs) });
  }
  if (total > cacheMaxBytes) {
    entries.sort((a, b) => a.used - b.used);
    for (const e of entries) {
      if (total <= cacheMaxBytes * 0.85) break;
      await fsp.rm(e.p, { force: true });
      await fsp.rm(e.p.replace(/\.bin$/, '.json'), { force: true });
      total -= e.size;
    }
  }
  cacheBytes = total;
  return total;
}
