import fs from 'node:fs';
import path from 'node:path';
import { LANG_COOKIE, normalizeLang, translate } from '../lib/i18n.js';
import { ROOT } from './config.js';
import { parseCookies } from './http.js';

// The web app manifest in the visitor's language. public/manifest.json is the
// English original; the texts a person reads (description, shortcuts, labels of
// the screenshots) come from lib/locales/pwa.js. Addresses and icons never change.

const built = new Map(); // lang -> JSON text

/** "/icons/shortcut-quick-96.png" -> "quick", "/screenshots/home-narrow.png" -> "home-narrow" */
const slugOf = (src, pattern) => pattern.exec(String(src || ''))?.[1] || '';

export function manifestFor(lang, original = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'manifest.json'), 'utf8'))) {
  if (lang === 'en') return original;
  // a text that has no translation stays as it is in the file
  const text = (key, fallback) => {
    const value = translate(lang, key);
    return value && value !== key ? value : fallback;
  };
  return {
    ...original,
    lang,
    description: text('pwa.manifest.description', original.description),
    shortcuts: original.shortcuts.map((s) => {
      const slug = slugOf(s.icons?.[0]?.src, /shortcut-([a-z]+)-\d+\.png$/);
      const name = text(`pwa.manifest.${slug}`, s.name);
      return { ...s, name, short_name: name, description: text(`pwa.manifest.${slug}Text`, s.description) };
    }),
    screenshots: original.screenshots.map((s) => ({ ...s, label: text(`pwa.manifest.shot.${slugOf(s.src, /([a-z-]+)\.png$/)}`, s.label) })),
  };
}

/** GET /manifest.json[?lang=de] – the page links the address with its own language */
export function sendManifest(req, res, wanted) {
  const lang = normalizeLang(wanted || parseCookies(req.headers.cookie)[LANG_COOKIE]);
  if (!built.has(lang)) built.set(lang, JSON.stringify(manifestFor(lang)));
  const body = built.get(lang);
  res.writeHead(200, {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // browsers must always get the newest manifest
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
