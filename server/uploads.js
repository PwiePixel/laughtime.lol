import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT, getConfig } from './config.js';
import { all } from './db.js';
import { HttpError } from './http.js';
import { ensureThumb, removeThumb, thumbRel, writeThumb } from './thumbs.js';

// ---------------------------------------------------------------------------
// Own uploads (pictures & GIFs, max. UPLOAD_MAX_MB, default 8 MB)
//   data/uploads/packs/  files in Meme-Studio packs (belong to an account)
//   data/uploads/rooms/  files of a swap round (deleted together with the room)
// Files are checked by their content (magic bytes), never by name or header,
// get a random name and are served with a strict content type + sandbox CSP.
// ---------------------------------------------------------------------------

export const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const FOLDERS = ['packs', 'rooms'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const FILE_RE = /^(packs|rooms|reports)\/([A-Za-z0-9_-]{16,40})\.(png|jpg|gif|webp)$/;
// Vorschaubild derselben Datei: /api/uploads/t/packs/<id>.webp
const THUMB_RE = /^t\/(packs|rooms|reports)\/([A-Za-z0-9_-]{16,40})\.webp$/;
const MAX_SIDE = 8000;

export const maxUploadBytes = () => getConfig().uploadMaxBytes;

// --- content sniffing ---------------------------------------------------------

function gifInfo(b) {
  const width = b.readUInt16LE(6);
  const height = b.readUInt16LE(8);
  let p = 13;
  if (b[10] & 0x80) p += 3 * 2 ** ((b[10] & 0x07) + 1);
  let images = 0;
  const skipSubBlocks = () => {
    while (p < b.length) {
      const n = b[p];
      p += 1 + n;
      if (n === 0) break;
    }
  };
  while (p < b.length && images < 2) {
    const block = b[p];
    if (block === 0x21) {
      p += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      images++;
      const flags = b[p + 9];
      p += 10;
      if (flags & 0x80) p += 3 * 2 ** ((flags & 0x07) + 1);
      p += 1; // LZW minimum code size
      skipSubBlocks();
    } else break; // 0x3B trailer or garbage
  }
  if (!images) return null;
  return { mime: 'image/gif', width, height, animated: images > 1 };
}

function pngInfo(b) {
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
  // APNG: an "acTL" chunk before the first IDAT
  let animated = false;
  let p = 8;
  while (p + 8 <= b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('latin1', p + 4, p + 8);
    if (type === 'acTL') animated = true;
    if (type === 'IDAT' || type === 'IEND') break;
    p += 12 + len;
  }
  return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20), animated };
}

function jpegInfo(b) {
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = b[p + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    const len = b.readUInt16BE(p + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { mime: 'image/jpeg', height: b.readUInt16BE(p + 5), width: b.readUInt16BE(p + 7), animated: false };
    }
    p += 2 + len;
  }
  return null;
}

function webpInfo(b) {
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8X') {
    return {
      mime: 'image/webp',
      animated: Boolean(b[20] & 0x02),
      width: 1 + b.readUIntLE(24, 3),
      height: 1 + b.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ') return { mime: 'image/webp', animated: false, width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { mime: 'image/webp', animated: false, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** { mime, ext, width, height, animated } or null when the file is not a supported picture */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32) return null;
  let info = null;
  try {
    const head = buf.toString('latin1', 0, 12);
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) info = gifInfo(buf);
    else if (buf[0] === 0x89 && head.slice(1, 4) === 'PNG') info = pngInfo(buf);
    else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) info = jpegInfo(buf);
    else if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') info = webpInfo(buf);
  } catch {
    info = null;
  }
  if (!info || !(info.width > 0) || !(info.height > 0) || info.width > MAX_SIDE || info.height > MAX_SIDE) return null;
  return { ...info, ext: EXT[info.mime] };
}

// --- reading & storing ----------------------------------------------------------

/** reads the raw request body (the file itself), max. UPLOAD_MAX_MB */
export async function readUpload(req) {
  const max = maxUploadBytes();
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > max) throw new HttpError(413, 'file_too_large', { maxMb: Math.round(max / 1048576) });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'file_too_large', { maxMb: Math.round(max / 1048576) });
    chunks.push(chunk);
  }
  if (!size) throw new HttpError(400, 'file_missing');
  const buf = Buffer.concat(chunks);
  const info = sniffImage(buf);
  if (!info) throw new HttpError(415, 'file_type');
  const rawName = String(req.headers['x-file-name'] || '');
  let name = '';
  try {
    name = decodeURIComponent(rawName);
  } catch {
    name = '';
  }
  name = name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^\p{L}\p{N} _.,!?'()-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return { buf, info, name };
}

export async function storeFile(folder, buf, info) {
  if (!FOLDERS.includes(folder)) throw new Error('bad folder');
  const id = crypto.randomBytes(15).toString('base64url');
  const rel = `${folder}/${id}.${info.ext}`;
  const abs = path.join(UPLOAD_DIR, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf, { flag: 'wx' });
  // kleine Vorschau gleich mitschreiben – das Studio lädt sonst das Original
  await writeThumb(UPLOAD_DIR, rel, buf);
  return { id, rel, url: `/api/uploads/${rel}`, thumb: `/api/uploads/t/${folder}/${id}.webp` };
}

export function removeFile(rel) {
  if (!FILE_RE.test(String(rel || ''))) return;
  fsp.rm(path.join(UPLOAD_DIR, rel), { force: true }).catch(() => {});
  removeThumb(UPLOAD_DIR, rel);
}

/** Adresse der Vorschau zu einer Upload-Datei ("packs/abc.gif") */
export function thumbUrl(rel) {
  if (!FILE_RE.test(String(rel || ''))) return null;
  const [folder, file] = String(rel).split('/');
  return `/api/uploads/t/${folder}/${file.replace(/\.[a-z0-9]+$/i, '')}.webp`;
}

/** media object used by packs and games */
export function uploadMedia({ id, url, thumb, info, name, room = false }) {
  return {
    id: `${room ? 'room-upload' : 'upload'}:${id}`,
    kind: 'image',
    url,
    thumb: thumb || null,
    local: true,
    ...(room ? { roomUpload: true } : { uploadId: id }),
    animated: Boolean(info.animated),
    width: info.width,
    height: info.height,
    title: name || 'Upload',
    source: 'upload',
  };
}

/** called before an account is deleted */
export function removeUserUploads(userId) {
  for (const row of all('SELECT file FROM uploads WHERE user_id = ?', userId)) removeFile(row.file);
}

/** room uploads are temporary – remove old ones (e.g. after a crash) */
export async function sweepRoomUploads(maxAgeMs = 6 * 60 * 60 * 1000) {
  const dir = path.join(UPLOAD_DIR, 'rooms');
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const n of names) {
    const abs = path.join(dir, n);
    try {
      const st = await fsp.stat(abs);
      if (st.mtimeMs < cutoff) await fsp.rm(abs, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// --- serving -------------------------------------------------------------------------

export async function serveUpload(req, res, rel) {
  // Vorschaubild? Wird beim ersten Abruf erzeugt und liegt danach auf der Platte,
  // damit auch alte Uploads sofort schnell sind.
  const tm = THUMB_RE.exec(rel);
  if (tm) return serveThumb(req, res, tm);

  const m = FILE_RE.exec(rel);
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  const abs = path.join(UPLOAD_DIR, rel);
  // open first: a file that is deleted a moment later (replaced swap upload)
  // can still be sent completely instead of breaking the connection
  let handle;
  let st;
  try {
    handle = await fsp.open(abs, 'r');
    st = await handle.stat();
  } catch {
    await handle?.close().catch(() => {});
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end('not found');
  }
  const headers = {
    'Content-Type': MIME[m[3]],
    'Content-Length': st.size,
    'Cache-Control': m[1] === 'packs' ? 'public, max-age=31536000, immutable' : 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': 'inline',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    await handle.close().catch(() => {});
    return res.end();
  }
  return handle
    .createReadStream({ autoClose: true })
    .on('error', () => res.destroy())
    .pipe(res);
}

/** Vorschaubild ausliefern (und beim ersten Mal erzeugen) */
async function serveThumb(req, res, m) {
  const folder = m[1];
  const id = m[2];
  // das Original kann jede der erlaubten Endungen haben
  let source = null;
  for (const ext of ['gif', 'png', 'jpg', 'webp']) {
    const rel = `${folder}/${id}.${ext}`;
    try {
      await fsp.access(path.join(UPLOAD_DIR, rel));
      source = rel;
      break;
    } catch {
      /* nächste Endung */
    }
  }
  if (!source) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end('not found');
  }
  const file = await ensureThumb(UPLOAD_DIR, source);
  if (!file) {
    // ohne sharp gibt es keine Vorschau – dann eben das Original
    return serveUpload(req, res, source);
  }
  let handle;
  let st;
  try {
    handle = await fsp.open(file, 'r');
    st = await handle.stat();
  } catch {
    await handle?.close().catch(() => {});
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end('not found');
  }
  res.writeHead(200, {
    'Content-Type': 'image/webp',
    'Content-Length': st.size,
    'Cache-Control': folder === 'packs' ? 'public, max-age=31536000, immutable' : 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  if (req.method === 'HEAD') {
    await handle.close().catch(() => {});
    return res.end();
  }
  return handle
    .createReadStream({ autoClose: true })
    .on('error', () => res.destroy())
    .pipe(res);
}

export { thumbRel };
