/**
 * GeoTime.lol – eigene Domain, eigene Dateien
 *
 * GeoTime ist eine eigene Website unter einer eigenen Domain (geotime.lol) und
 * nicht laughtime.lol/geotime. Damit davon auch wirklich nichts durchmischt:
 *
 *   1. Host-Prüfung   – wer mit einem fremden Host (z. B. laughtime.lol) auf
 *                       den GeoTime-Port kommt, wird auf geotime.lol umgeleitet.
 *   2. eigene Dateien – Icon, Apple-Icon und OG-Bild kommen aus geotime/assets/
 *                       und NICHT aus LaughTimes public/ (sonst hinge das
 *                       LoL-Logo an geotime.lol).
 *   3. robots.txt / sitemap.xml – eigene, mit der eigenen Domain.
 *   4. Fehlerseiten   – eigene 404/500-Seite, damit nie eine LaughTime-Seite
 *                       auf einer GeoTime-Adresse auftaucht.
 *
 * Intern liegen die Seiten im gemeinsamen Next.js-Build unter /geotime. Nach
 * außen ist davon nichts zu sehen: der Port setzt das Präfix vor dem
 * Weiterreichen und nimmt es aus Weiterleitungen wieder heraus.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Dateitypen, die GeoTime selbst ausliefert */
export const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

/** saubere Adresse -> Datei in geotime/assets/ */
const ASSETS = {
  '/logo.png': 'logo.png',
  '/logo-mark.svg': 'logo-mark.svg',
  '/icon.svg': 'icon.svg',
  '/icon.png': 'icon-192.png',
  '/icon-192.png': 'icon-192.png',
  '/favicon.ico': 'favicon-48.png',
  '/apple-icon.png': 'apple-icon.png',
  '/apple-touch-icon.png': 'apple-icon.png',
  '/opengraph-image.png': 'opengraph-image.png',
};

const ONE_DAY = 60 * 60 * 24;

/** Host der Anfrage (hinter einem Reverse-Proxy steht er in x-forwarded-host) */
export function requestHost(req, cfg) {
  const forwarded = cfg.trustProxy ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '';
  return (forwarded || req.headers.host || '').toLowerCase();
}

const isLocal = (host) => /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/.test(host) || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host);

/**
 * Läuft die Anfrage unter der richtigen Domain?
 * Wenn nicht, wird auf die eigene Domain umgeleitet (301) – so ist GeoTime
 * niemals unter einer LaughTime-Adresse erreichbar.
 * @returns {boolean} true = schon beantwortet (umgeleitet)
 */
export function enforceDomain(req, res, url, cfg) {
  if (!cfg.enforceDomain) return false;
  const host = requestHost(req, cfg);
  if (!host || isLocal(host)) return false; // lokal testen bleibt möglich
  const bare = host.replace(/:\d+$/, '');
  if (cfg.domains.some((d) => d === host || d === bare)) return false;
  res.writeHead(301, {
    Location: `${cfg.publicUrl}${url.pathname}${url.search}`,
    'Cache-Control': 'no-store',
  });
  res.end();
  return true;
}

/**
 * Eigene Datei ausliefern (Icon, OG-Bild …).
 * @returns {boolean} true = beantwortet
 */
export function serveAsset(req, res, url, cfg) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const name = ASSETS[url.pathname];
  if (!name) return false;
  const file = path.join(cfg.assetsDir, name);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': `public, max-age=${ONE_DAY}`,
  });
  if (req.method === 'HEAD') return (res.end(), true);
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
  return true;
}

/** eigene robots.txt (Beta-Instanzen bleiben immer draußen) */
export function robotsTxt(cfg) {
  if (cfg.noindex || cfg.isBeta) return 'User-agent: *\nDisallow: /\n';
  return ['User-agent: *', 'Allow: /', 'Disallow: /admin', '', `Sitemap: ${cfg.publicUrl}/sitemap.xml`, ''].join('\n');
}

/** eigene sitemap.xml – nur GeoTime-Adressen, nie laughtime.lol */
export function sitemapXml(cfg) {
  const pages = ['/', '/play', '/leaderboard', '/login'];
  const urls = pages
    .map((p) => `  <url><loc>${cfg.publicUrl}${p === '/' ? '/' : p}</loc><changefreq>weekly</changefreq></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Eigene Fehlerseite. Wichtig für die Trennung: auf einer GeoTime-Adresse darf
 * nie die 404-Seite von LaughTime erscheinen.
 */
export function errorPage(status, cfg) {
  const text =
    status === 404
      ? { title: 'Page not found', hint: 'This address does not exist on GeoTime.' }
      : { title: 'Back in a moment', hint: 'The game server is not answering right now. Please try again shortly.' };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>GeoTime.lol – ${text.title}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
  :root{--bg:#1E0B40;--ink:#170A2E;--yellow:#FFD23F;--muted:#C9B8EC}
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:#fff;
       font-family:ui-rounded,"Segoe UI",system-ui,sans-serif;text-align:center}
  .box{max-width:420px;display:grid;gap:14px;justify-items:center}
  img{width:88px;height:88px}
  h1{margin:0;font-size:clamp(1.6rem,7vw,2.2rem);line-height:1.1}
  p{margin:0;color:var(--muted);line-height:1.45}
  a{display:inline-block;margin-top:8px;background:var(--yellow);color:var(--ink);text-decoration:none;font-weight:700;
    border:3px solid var(--ink);border-radius:999px;padding:12px 26px;box-shadow:0 5px 0 var(--ink)}
  a:active{transform:translateY(3px);box-shadow:0 2px 0 var(--ink)}
</style></head><body><div class="box">
<img src="/icon.svg" alt="">
<h1>${text.title}</h1><p>${text.hint}</p><a href="/">Back to the start</a>
</div></body></html>`;
}

/**
 * Status-Codes, bei denen NIE die Antwort von LaughTime durchgereicht wird.
 * 404 ist nicht dabei: dafür gibt es app/geotime/not-found.jsx, das schon im
 * GeoTime-Design gerendert wird. Hier geht es um echte Serverfehler.
 */
export const OWN_ERROR = (status) => status >= 500;
