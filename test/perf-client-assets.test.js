import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants.js';
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

test('static pictures and fonts are cached for long in production, not in development', async () => {
  for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
    const rules = cacheRules(await rulesFor(phase));
    assert.equal(rules.length, 1);
    const value = rules[0].headers[0].value;
    assert.match(value, /public/);
    assert.match(value, /max-age=\d{5,}/);
    assert.match(value, /stale-while-revalidate=\d{6,}/);
    // un-hashed files must never be "immutable"
    assert.doesNotMatch(value, /immutable/);
    const source = rules[0].source;
    assert.match(source, /png/);
    assert.match(source, /woff2/);
    // hashed build files keep the headers Next gives them; service worker and manifest are not covered
    assert.match(source, /\(\?!_next\/\)/);
    assert.doesNotMatch(source, /\bjs\b|json/);
  }
  assert.equal(cacheRules(await rulesFor(PHASE_DEVELOPMENT_SERVER)).length, 0);
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
