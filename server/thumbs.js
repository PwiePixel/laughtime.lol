/**
 * Preview pictures for own uploads.
 *
 * In the studio every tile used to load the original file – with GIFs and big
 * PNGs that quickly meant several megabytes per picture. Now a small WebP
 * (max. 400 px, first frame of a GIF) lies next to every file: a few kilobytes
 * that are there at once. The original is only loaded where it is needed, in
 * the editor and in the game.
 *
 * The preview is made while uploading. For files that already exist it is
 * made on the first request and then stays on disk, so nothing has to be
 * converted afterwards.
 *
 * WebP because every browser LaughTime supports can show it (the address of a
 * preview ends in .webp and is stored in packs, so the format stays fixed).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { dedupe } from './lib/outbound.js';
import { getSharp } from './lib/sharp.js';
import { createWorkQueue } from './lib/work.js';

export const THUMB_MAX = 400;
export const THUMB_EXT = 'webp';
// quality 74 with sharp chroma: captions and outlines stay crisp at 10–25 KB
const THUMB_OPTIONS = { quality: 74, effort: 4, smartSubsample: true };
// never more than two conversions at once, however many tiles a page shows
const queue = createWorkQueue({ concurrency: 2, maxQueue: 200 });

/** "packs/abc.gif" -> "packs/.thumbs/abc.webp" */
export const thumbRel = (rel) => {
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel).replace(/\.[a-z0-9]+$/i, '');
  return `${dir}/.thumbs/${base}.${THUMB_EXT}`;
};

/** input: path or buffer. Written through a temporary file, so nobody reads half a picture. */
async function render(input, target) {
  const sharp = await getSharp();
  if (!sharp) return null;
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await sharp(input, { failOn: 'none', limitInputPixels: 70_000_000 }) // animated: the first frame is enough
      .rotate()
      .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
      .webp(THUMB_OPTIONS)
      .toFile(tmp);
    await fsp.rename(tmp, target);
    return target;
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Make the preview if there is none yet.
 * @returns {Promise<string|null>} absolute path, or null when it cannot be made
 */
export async function ensureThumb(uploadDir, rel) {
  const target = path.join(uploadDir, thumbRel(rel));
  try {
    const st = await fsp.stat(target);
    if (st.size > 0) return target;
  } catch {
    /* does not exist yet – make it now */
  }
  // a page full of tiles asks for the same preview several times: convert once
  return dedupe(`thumb:${target}`, () =>
    queue
      .run(() => render(path.join(uploadDir, rel), target))
      .catch((err) => {
        console.warn('\x1b[33m[uploads]\x1b[0m no preview for', rel, '–', err.message);
        return null;
      }),
  );
}

/** straight from the upload buffer – saves reading the file again */
export async function writeThumb(uploadDir, rel, buf) {
  const target = path.join(uploadDir, thumbRel(rel));
  return queue
    .run(() => render(buf, target))
    .catch((err) => {
      console.warn('\x1b[33m[uploads]\x1b[0m no preview –', err.message);
      return null;
    });
}

/** the preview goes when the original goes */
export function removeThumb(uploadDir, rel) {
  fsp.rm(path.join(uploadDir, thumbRel(rel)), { force: true }).catch(() => {});
}
