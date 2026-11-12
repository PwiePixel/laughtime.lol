import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.json'), 'utf8'));

const fileOf = (src) => path.join(PUBLIC, src.split('?')[0]);

/** every listed image exists, is a PNG and has exactly the declared size */
async function checkImage(entry) {
  assert.match(entry.src, /^\/[\w/.-]+\.png$/, entry.src);
  assert.equal(entry.type, 'image/png', entry.src);
  assert.match(entry.sizes, /^\d+x\d+$/, entry.src);
  assert.ok(fs.existsSync(fileOf(entry.src)), `${entry.src} is missing`);
  const meta = await sharp(fileOf(entry.src)).metadata();
  assert.equal(meta.format, 'png', entry.src);
  assert.equal(`${meta.width}x${meta.height}`, entry.sizes, entry.src);
  return meta;
}

test('manifest has every member an installable app needs', () => {
  assert.equal(manifest.name, 'LaughTime');
  assert.ok(manifest.short_name && manifest.short_name.length <= 12, 'short_name fits below a home screen icon');
  assert.ok(manifest.description.length > 20);
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/?source=pwa');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.display_override) && manifest.display_override.includes('standalone'));
  assert.equal(manifest.orientation, 'portrait');
  assert.equal(manifest.theme_color, '#1E0B40');
  assert.equal(manifest.background_color, '#1E0B40');
  assert.equal(manifest.lang, 'en');
  assert.ok(manifest.categories.includes('games'));
});

test('manifest colours match the page', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.jsx'), 'utf8');
  assert.ok(layout.includes(`themeColor: '${manifest.theme_color}'`), 'viewport.themeColor in app/layout.jsx');
  assert.ok(layout.includes("manifest: '/manifest.json'"), 'manifest link in app/layout.jsx');
});

test('icons: 192 and 512 as "any" and as separate maskable icons', async () => {
  const sizes = { any: [], maskable: [], monochrome: [] };
  for (const icon of manifest.icons) {
    const meta = await checkImage(icon);
    assert.ok(['any', 'maskable', 'monochrome'].includes(icon.purpose), `${icon.src}: one purpose per icon`);
    sizes[icon.purpose].push(icon.sizes);
    // launchers fill transparent parts of a maskable icon with white or black
    if (icon.purpose === 'maskable') assert.equal(meta.hasAlpha, false, `${icon.src} must be opaque`);
    if (icon.purpose === 'monochrome') assert.equal(meta.hasAlpha, true, `${icon.src} needs transparency`);
  }
  for (const purpose of ['any', 'maskable']) {
    assert.ok(sizes[purpose].includes('192x192'), `${purpose} 192`);
    assert.ok(sizes[purpose].includes('512x512'), `${purpose} 512`);
  }
  assert.ok(sizes.monochrome.length >= 1);
});

test('maskable icons keep the artwork inside the safe zone', async () => {
  for (const icon of manifest.icons.filter((i) => i.purpose === 'maskable')) {
    const { data, info } = await sharp(fileOf(icon.src)).raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const background = px(0, 0);
    const safe = info.width * 0.4;
    const mid = (info.width - 1) / 2;
    let outside = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (Math.hypot(x - mid, y - mid) <= safe) continue;
        const p = px(x, y);
        if (Math.abs(p[0] - background[0]) + Math.abs(p[1] - background[1]) + Math.abs(p[2] - background[2]) > 24) outside += 1;
      }
    }
    assert.equal(outside, 0, `${icon.src}: ${outside} artwork pixels outside the safe zone`);
    // … and the full-bleed background reaches every corner
    for (const [x, y] of [[info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
      assert.deepEqual(px(x, y), background, `${icon.src} corner ${x},${y}`);
    }
  }
});

test('apple touch icon and badge', async () => {
  const apple = await sharp(path.join(ROOT, 'app', 'apple-icon.png')).metadata();
  assert.equal(`${apple.width}x${apple.height}`, '180x180');
  assert.equal(apple.hasAlpha, false, 'iOS paints transparent corners black');
  const badge = await sharp(path.join(PUBLIC, 'icons', 'badge-96.png')).metadata();
  assert.equal(`${badge.width}x${badge.height}`, '96x96');
  assert.equal(badge.hasAlpha, true);
});

test('shortcuts point to pages of the app and have icons', async () => {
  assert.equal(manifest.shortcuts.length, 3);
  const pages = fs.readdirSync(path.join(ROOT, 'app'));
  for (const shortcut of manifest.shortcuts) {
    assert.ok(shortcut.name && shortcut.short_name && shortcut.description, shortcut.url);
    assert.match(shortcut.url, /^\/(?!\/)/, 'inside the scope');
    const first = new URL(shortcut.url, 'https://laughtime.lol').pathname.split('/')[1];
    if (first) assert.ok(pages.includes(first), `route /${first} exists`);
    assert.ok(shortcut.icons.some((i) => i.sizes === '96x96'), `${shortcut.name}: 96px icon`);
    for (const icon of shortcut.icons) await checkImage(icon);
  }
});

test('screenshots for the rich install dialog: narrow and wide', async () => {
  const forms = new Set();
  for (const shot of manifest.screenshots) {
    const meta = await checkImage(shot);
    assert.ok(['narrow', 'wide'].includes(shot.form_factor), shot.src);
    assert.ok(shot.label, `${shot.src} needs a label`);
    forms.add(shot.form_factor);
    // limits of the install dialog: 320–3840px per side, at most 2.3 : 1
    const [long, short] = [Math.max(meta.width, meta.height), Math.min(meta.width, meta.height)];
    assert.ok(short >= 320 && long <= 3840, shot.src);
    assert.ok(long / short <= 2.3, `${shot.src} is too elongated`);
    if (shot.form_factor === 'narrow') assert.ok(meta.height > meta.width, `${shot.src} is portrait`);
    else assert.ok(meta.width > meta.height, `${shot.src} is landscape`);
  }
  assert.ok(forms.has('narrow') && forms.has('wide'));
});

test('every icon of the manifest comes from the generator', () => {
  const generator = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-icons.mjs'), 'utf8');
  const referenced = [
    ...manifest.icons.map((i) => i.src),
    ...manifest.shortcuts.flatMap((s) => s.icons.map((i) => i.src)),
  ];
  for (const src of referenced) {
    const name = path.basename(src).replace(/-\d+\.png$/, '');
    assert.ok(generator.includes(name.split('-')[0]), `${src} is produced by scripts/generate-icons.mjs`);
  }
});
