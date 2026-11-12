/**
 * GeoTime.lol – Reparatur für Dateien aus dem Next-Build
 *
 * Problem: maplibre-gl startet seinen Arbeiter (Web Worker) mit
 * `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url))`. Next legt
 * diese Datei als Anhang unter /_next/static/media/ ab und hängt einen
 * Prüfcode an den Namen (…-worker.13zva….mjs) – **ohne** den Import *innerhalb*
 * der Datei anzupassen. Die Datei lädt also weiter `./maplibre-gl-shared.mjs`,
 * und genau die gibt es unter diesem Namen nicht.
 *
 * Folge im Browser: der Arbeiter stirbt beim Start, die Karte fordert nie
 * Kacheln an und bleibt als blasses Relief stehen. Man sieht keinen Fehler,
 * weil der Absturz im Arbeiter passiert.
 *
 * Hier wird der Name ohne Prüfcode einfach auf die echte Datei abgebildet.
 * LaughTime bleibt davon unberührt – das läuft nur im GeoTime-Port.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

const MEDIA_DIR = path.join(ROOT, '.next', 'static', 'media');
const NAME = /^\/_next\/static\/media\/([A-Za-z0-9._-]+)$/;
const HASHED = /^(.+)\.[A-Za-z0-9_-]{6,}(\.[A-Za-z0-9]+)$/;

const TYPES = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** @type {Map<string,string>|null} Name ohne Prüfcode -> echter Dateiname */
let index = null;

function buildIndex() {
  const map = new Map();
  let files = [];
  try {
    files = fs.readdirSync(MEDIA_DIR);
  } catch {
    return map; // kein Build da (z. B. im Test) – dann gibt es nichts zu retten
  }
  for (const file of files) {
    const m = HASHED.exec(file);
    if (m) map.set(`${m[1]}${m[2]}`, file);
  }
  return map;
}

/**
 * Datei aus dem Build unter ihrem Namen ohne Prüfcode ausliefern.
 * @returns {boolean} true = schon beantwortet
 */
export function serveNextAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const pathname = (req.url || '').split('?')[0];
  const m = NAME.exec(pathname);
  if (!m) return false;
  const name = m[1];
  // Gibt es die Datei genau so? Dann liefert Next sie selbst aus.
  if (fs.existsSync(path.join(MEDIA_DIR, name))) return false;

  if (!index) index = buildIndex();
  let real = index.get(name);
  if (!real) {
    index = buildIndex(); // frisch gebaut? noch einmal nachsehen
    real = index.get(name);
  }
  if (!real) return false;

  const file = path.join(MEDIA_DIR, real);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return (res.end(), true);
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
  return true;
}
