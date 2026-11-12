// Renders every app icon from the logo artwork (app/icon.svg).
//
//   node scripts/generate-icons.mjs
//
// The PNGs are committed, so this only has to run again when the logo changes.
// Output:
//   public/icons/icon-{192,512}.png          the tile as it is (purpose "any")
//   public/icons/maskable-{192,512}.png      full-bleed, artwork inside the safe zone
//   public/icons/monochrome-192.png          white silhouette (purpose "monochrome")
//   public/icons/badge-96.png                the same silhouette as notification badge
//   public/icons/shortcut-*-{96,192}.png     icons of the home screen shortcuts
//   app/apple-icon.png                       180px, full-bleed (iOS rounds the corners itself)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Globe, Lock, Trophy } from 'lucide-react';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'icons');

const TILE = '#2A1057';
const INK = '#170A2E';
const YELLOW = '#FFD23F';
const PINK = '#FF4FA3';
const CYAN = '#35E0FF';

// Maskable icons are cropped to a circle, a squircle or a rounded square by the
// launcher. Only the inner circle with 80% of the width is guaranteed to stay
// visible: the face is scaled down a little and the sparkle (which sits in the
// corner of the tile) moves next to it, so both fit in there.
const MASKABLE_FACE_SCALE = 0.86;
const MASKABLE_SPARKLE = 'translate(378 134) scale(0.7) translate(-414 -104)';
// iOS only rounds the corners (about as much as the tile itself), a little air is enough
const APPLE_SCALE = 0.96;

/** the logo without its rounded tile: the face and the sparkle */
async function loadArtwork() {
  const svg = await fs.readFile(path.join(ROOT, 'app', 'icon.svg'), 'utf8');
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/, '')
    // the first two rects are the tile and its outline
    .replace(/<rect[^>]*rx="112"[^>]*\/>/g, '');
  // the sparkle is the yellow path at the end
  const sparkle = /<path[^>]*fill="#FFD23F"[^>]*\/>/.exec(inner)?.[0];
  if (!inner.includes('<circle') || !sparkle) throw new Error('app/icon.svg does not look like the logo any more');
  return { face: inner.replace(sparkle, ''), sparkle };
}

const around = (scale) => `translate(256 256) scale(${scale}) translate(-256 -256)`;

const fullBleed = (parts) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${TILE}"/>
  ${parts}
</svg>`;

const maskableSvg = ({ face, sparkle }) =>
  fullBleed(`<g transform="${around(MASKABLE_FACE_SCALE)}">${face}</g><g transform="${MASKABLE_SPARKLE}">${sparkle}</g>`);

const appleSvg = ({ face, sparkle }) => fullBleed(`<g transform="${around(APPLE_SCALE)}">${face}${sparkle}</g>`);

// The laughing face as a one-colour silhouette (same geometry as the logo):
// eyes and mouth are cut out, the tears stay.
const MONOCHROME = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="196 69 208 208">
  <defs>
    <mask id="cut" maskUnits="userSpaceOnUse" x="196" y="69" width="208" height="208">
      <rect x="196" y="69" width="208" height="208" fill="#fff"/>
      <path d="M252.96 166.28 q16.8 -25.2 33.6 0" fill="none" stroke="#000" stroke-width="12.6" stroke-linecap="round"/>
      <path d="M313.44 166.28 q16.8 -25.2 33.6 0" fill="none" stroke="#000" stroke-width="12.6" stroke-linecap="round"/>
      <path d="M251.28 184.76 H348.72 Q347.04 241.88 300 243.56 Q252.96 241.88 251.28 184.76Z" fill="#000" stroke="#000" stroke-width="5" stroke-linejoin="round"/>
      <path d="M242.04 174.68 c-8.4 11.76 -13.44 21.84 -5.04 28.56 c8.4 5.04 16.8 -5.04 8.4 -28.56z" fill="#000" stroke="#000" stroke-width="11" stroke-linejoin="round"/>
      <path d="M357.96 174.68 c8.4 11.76 13.44 21.84 5.04 28.56 c-8.4 5.04 -16.8 -5.04 -8.4 -28.56z" fill="#000" stroke="#000" stroke-width="11" stroke-linejoin="round"/>
    </mask>
  </defs>
  <circle cx="300" cy="173" r="91" fill="#fff" mask="url(#cut)"/>
  <path d="M242.04 174.68 c-8.4 11.76 -13.44 21.84 -5.04 28.56 c8.4 5.04 16.8 -5.04 8.4 -28.56z" fill="#fff"/>
  <path d="M357.96 174.68 c8.4 11.76 13.44 21.84 5.04 28.56 c-8.4 5.04 -16.8 -5.04 -8.4 -28.56z" fill="#fff"/>
</svg>`;

/** a shortcut icon: round party-coloured tile with an ink outline and a line icon */
function shortcutSvg(IconComponent, color) {
  const glyph = renderToStaticMarkup(
    createElement(IconComponent, { x: 25, y: 25, width: 46, height: 46, color: INK, strokeWidth: 2.4 }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <circle cx="48" cy="48" r="44" fill="${color}" stroke="${INK}" stroke-width="6"/>
  ${glyph}
</svg>`;
}

async function render(svg, size, file, { opaque = false } = {}) {
  let img = sharp(Buffer.from(svg), { density: 72 * Math.max(1, Math.ceil(size / 96)) }).resize(size, size);
  // no alpha channel where the system would fill transparency with black
  if (opaque) img = img.flatten({ background: TILE }).removeAlpha();
  await img.png({ compressionLevel: 9 }).toFile(file);
  console.log(`  ${path.relative(ROOT, file)}  ${size}x${size}`);
}

const artwork = await loadArtwork();
const tile = await fs.readFile(path.join(ROOT, 'app', 'icon.svg'), 'utf8');
await fs.mkdir(OUT, { recursive: true });

console.log('Rendering icons from app/icon.svg');
for (const size of [192, 512]) {
  await render(tile, size, path.join(OUT, `icon-${size}.png`));
  await render(maskableSvg(artwork), size, path.join(OUT, `maskable-${size}.png`), { opaque: true });
}
await render(appleSvg(artwork), 180, path.join(ROOT, 'app', 'apple-icon.png'), { opaque: true });
await render(MONOCHROME, 192, path.join(OUT, 'monochrome-192.png'));
await render(MONOCHROME, 96, path.join(OUT, 'badge-96.png'));

const shortcuts = { quick: [Globe, YELLOW], private: [Lock, CYAN], memes: [Trophy, PINK] };
for (const [name, [IconComponent, color]] of Object.entries(shortcuts)) {
  for (const size of [96, 192]) {
    await render(shortcutSvg(IconComponent, color), size, path.join(OUT, `shortcut-${name}-${size}.png`));
  }
}
console.log('Done.');
