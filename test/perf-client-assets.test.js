import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants.js';
// the matcher Next itself uses for the `source` of a header rule
import pathMatcher from 'next/dist/compiled/path-to-regexp/index.js';
import sharp from 'sharp';
import nextConfig from '../next.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (file) => path.join(ROOT, 'public', file);
const MASCOTS = ['LoL_Dedetiv-asset', 'LoL_Bote-asset', 'LoL_Spieler-asset'];

/** small fingerprint: do two files show the same picture? */
async function fingerprint(file) {
  return sharp(file).flatten({ background: '#808080' }).resize(24, 24, { fit: 'fill' }).removeAlpha().raw().toBuffer();
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

test('every mascot has small AVIF and WebP versions that show the same picture', async () => {
  for (const name of MASCOTS) {
    const png = pub(`images/mascots/${name}.png`);
    const want = await fingerprint(png);
    for (const ext of ['avif', 'webp']) {
      const file = pub(`images/mascots/${name}.${ext}`);
      assert.ok(fs.existsSync(file), `${name}.${ext} is missing – run: node scripts/optimize-assets.mjs`);
      assert.ok(fs.statSync(file).size < fs.statSync(png).size / 4, `${name}.${ext} should be much smaller than the PNG`);
      const meta = await sharp(file).metadata();
      assert.equal(meta.format, ext === 'avif' ? 'heif' : 'webp');
      // drawn at 140 CSS px: sharp on 2x screens
      assert.ok(Math.max(meta.width, meta.height) >= 280, `${name}.${ext} is too small`);
      assert.ok(distance(want, await fingerprint(file)) < 6, `${name}.${ext} is outdated – run: node scripts/optimize-assets.mjs`);
    }
  }
});

test('the studio page references the mascots that exist', () => {
  const source = fs.readFileSync(path.join(ROOT, 'components', 'StudioPage.jsx'), 'utf8');
  for (const name of MASCOTS) assert.ok(source.includes(`/images/mascots/${name}'`), name);
});

test('the share banner is still a 1200 × 630 PNG', async () => {
  const meta = await sharp(pub('banner.png')).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

// --- next.config.mjs -------------------------------------------------------------

const rulesFor = async (phase) => nextConfig(phase).headers();
const cacheRules = (rules) => rules.filter((r) => r.headers.some((h) => h.key.toLowerCase() === 'cache-control'));

test('static pictures are cached for long in production, not in development', async () => {
  for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
    const rules = cacheRules(await rulesFor(phase));
    assert.equal(rules.length, 2);
    for (const rule of rules) {
      const value = rule.headers[0].value;
      assert.match(value, /public/);
      assert.match(value, /max-age=\d{5,}/);
      assert.match(value, /stale-while-revalidate=\d{6,}/);
      // un-hashed files must never be "immutable"
      assert.doesNotMatch(value, /immutable/);
    }
  }
  assert.equal(cacheRules(await rulesFor(PHASE_DEVELOPMENT_SERVER)).length, 0);
});

test('the long cache header covers the files in public/ and no page', async () => {
  const sources = cacheRules(await rulesFor(PHASE_PRODUCTION_SERVER)).map((r) => pathMatcher.pathToRegexp(r.source));
  const cached = (pathname) => sources.some((re) => re.test(pathname));
  const walk = (dir, base = '') =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), `${base}/${e.name}`) : [`${base}/${e.name}`]));
  for (const file of walk(pub(''))) {
    // service worker and manifest change with a release and are asked for every time
    assert.equal(cached(file), !['/sw.js', '/manifest.json'].includes(file), file);
  }
  // user names may end like a picture, room codes and news ids come from the address bar
  for (const page of ['/u/doge.png', '/u/cat.gif', '/room/ABCDE.svg', '/news/x.jpg', '/m/abc.webp', '/_next/static/media/a.woff2', '/api/x.png', '/images', '/favicon.ico']) {
    assert.equal(cached(page), false, page);
  }
});

test('security headers and the Discord frame rule are unchanged', async () => {
  for (const phase of [PHASE_PRODUCTION_SERVER, PHASE_DEVELOPMENT_SERVER]) {
    const rules = await rulesFor(phase);
    const all = rules.find((r) => r.source === '/:path*');
    assert.deepEqual(all.headers, [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ]);
    const frame = rules.find((r) => r.headers.some((h) => h.key === 'X-Frame-Options'));
    assert.deepEqual(frame, {
      source: '/:path((?!activity(?:/|$)).*)',
      missing: [{ type: 'query', key: 'frame_id' }],
      headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
    });
  }
});
