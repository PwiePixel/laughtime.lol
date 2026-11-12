/**
 * Vorschaubilder für eigene Uploads.
 *
 * Problem vorher: im Studio lud jede Kachel die Originaldatei – bei GIFs und
 * großen PNGs schnell mehrere Megabyte pro Bild. Eine Seite mit 20 Kacheln hat
 * so 50 MB gezogen und entsprechend lange gebraucht.
 *
 * Jetzt liegt neben jeder Datei ein kleines WebP (max. 400 px, erstes Bild bei
 * GIFs). Das sind ein paar Kilobyte und sie sind sofort da. Das Original wird
 * nur noch geladen, wo es gebraucht wird – im Editor und im Spiel.
 *
 * Erzeugt wird die Vorschau beim Hochladen. Für Dateien, die es schon gibt,
 * entsteht sie beim ersten Abruf und liegt danach auf der Platte. Es muss also
 * nichts nachträglich umgewandelt werden.
 *
 * sharp kommt mit Next.js mit – keine zusätzliche Abhängigkeit.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

export const THUMB_MAX = 400;
export const THUMB_EXT = 'webp';

let sharpModule;
let sharpBroken = false;

/** sharp erst laden, wenn es gebraucht wird (und nie zweimal probieren) */
async function getSharp() {
  if (sharpBroken) return null;
  if (!sharpModule) {
    try {
      sharpModule = (await import('sharp')).default;
    } catch (err) {
      sharpBroken = true;
      console.warn('\x1b[33m[uploads]\x1b[0m keine Vorschaubilder (sharp fehlt):', err.message);
      return null;
    }
  }
  return sharpModule;
}

/** "packs/abc.gif" -> "packs/abc.webp" (liegt im Unterordner .thumbs) */
export const thumbRel = (rel) => {
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel).replace(/\.[a-z0-9]+$/i, '');
  return `${dir}/.thumbs/${base}.${THUMB_EXT}`;
};

/**
 * Vorschaubild erzeugen, falls es noch keines gibt.
 * @returns {Promise<string|null>} absoluter Pfad oder null, wenn es nicht geht
 */
export async function ensureThumb(uploadDir, rel) {
  const target = path.join(uploadDir, thumbRel(rel));
  try {
    const st = await fsp.stat(target);
    if (st.size > 0) return target;
  } catch {
    /* gibt es noch nicht – jetzt bauen */
  }
  const sharp = await getSharp();
  if (!sharp) return null;
  const source = path.join(uploadDir, rel);
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await sharp(source, { failOn: 'none' }) // animiert: erstes Bild reicht
      .rotate()
      .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72, effort: 4 })
      .toFile(target);
    return target;
  } catch (err) {
    console.warn('\x1b[33m[uploads]\x1b[0m Vorschau fehlgeschlagen für', rel, '–', err.message);
    return null;
  }
}

/** direkt beim Hochladen aus dem Puffer – spart das erneute Lesen von der Platte */
export async function writeThumb(uploadDir, rel, buf) {
  const sharp = await getSharp();
  if (!sharp) return null;
  const target = path.join(uploadDir, thumbRel(rel));
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await sharp(buf, { failOn: 'none' })
      .rotate()
      .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72, effort: 4 })
      .toFile(target);
    return target;
  } catch (err) {
    console.warn('\x1b[33m[uploads]\x1b[0m Vorschau fehlgeschlagen –', err.message);
    return null;
  }
}

/** Vorschau mitlöschen, wenn das Original verschwindet */
export function removeThumb(uploadDir, rel) {
  fsp.rm(path.join(uploadDir, thumbRel(rel)), { force: true }).catch(() => {});
}
