#!/usr/bin/env node
// Optimises the static pictures in public/.
//
//   node scripts/optimize-assets.mjs           write what is missing or outdated
//   node scripts/optimize-assets.mjs --force   write everything again
//   node scripts/optimize-assets.mjs --check   change nothing, exit with 1 if something is to do
//
// What it does:
//   Only PNGs the site really uses are touched – found by looking for their
//   names in the source code. Everything else in public/ is listed and left alone.
//   1. A used PNG is re-packed losslessly (same pixels, smaller file). It is
//      only replaced when the result is pixel-identical and really smaller.
//   2. PNGs that the pages show as pictures get an .avif and a .webp next to
//      them (<picture> uses them, the PNG stays as fallback).
//
// Run it after replacing a picture in public/ (e.g. a mascot) – the generated
// files are committed, the server never converts anything at runtime.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
// where pictures can be referenced from
const SOURCE_DIRS = ['app', 'components', 'lib'];
// app icons belong to the install/offline part of the site and are handled there
const SKIP_DIRS = new Set(['icons']);

// These must stay PNG wherever they are used (no modern siblings):
//   banner.png     Open Graph / Twitter preview – crawlers want PNG or JPEG
//   logo-mark.png  fallback watermark that is drawn onto a canvas
const PNG_ONLY = new Set(['banner.png', 'logo-mark.png']);

// Largest size a picture is ever drawn at (device pixels). Bigger files are
// scaled down for the modern formats; the PNG itself is never resized.
const MAX_SIZE = [{ under: 'images/mascots/', px: 320 }];

const AVIF = { quality: 60, effort: 9 };
const WEBP = { quality: 82, alphaQuality: 90, effort: 6 };
// a re-packed PNG has to save at least this much, otherwise the file stays as it is
const MIN_PNG_GAIN = 0.02;
// how far a generated picture may be from its source (0–255, mean per channel) before it counts as outdated
const SAME_PICTURE = 6;

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const FORCE = args.has('--force');

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const rel = (file) => path.relative(PUBLIC, file).split(path.sep).join('/');

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

async function readSources() {
  const texts = [];
  for (const dir of SOURCE_DIRS) {
    const files = await walk(path.join(ROOT, dir)).catch(() => []);
    for (const file of files) {
      if (/\.(jsx?|mjs|css)$/.test(file)) texts.push(await fs.readFile(file, 'utf8'));
    }
  }
  return texts.join('\n');
}

/** tiny fingerprint of a picture: tells whether two files show the same thing */
async function fingerprint(input) {
  // on a grey ground, so the (undefined) colour of fully transparent pixels does not count
  return sharp(input).flatten({ background: '#808080' }).resize(24, 24, { fit: 'fill' }).removeAlpha().raw().toBuffer();
}

function distance(a, b) {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

async function sizeOf(file) {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

/** 1. same pixels, smaller PNG */
async function repackPng(file) {
  const before = await sizeOf(file);
  const original = await fs.readFile(file);
  const meta = await sharp(original).metadata();
  let pipeline = sharp(original);
  // colours must not shift: an embedded profile travels along
  if (meta.icc) pipeline = pipeline.keepIccProfile();
  const packed = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  const [a, b] = await Promise.all([sharp(original).ensureAlpha().raw().toBuffer(), sharp(packed).ensureAlpha().raw().toBuffer()]);
  const identical = a.equals(b);
  const worthIt = identical && packed.length < before * (1 - MIN_PNG_GAIN);
  if (worthIt && !CHECK) await fs.writeFile(file, packed);
  return { before, after: worthIt ? packed.length : before, changed: worthIt };
}

/** 2. modern siblings of a PNG the pages show */
async function modernSiblings(file, pngBytes) {
  const name = rel(file);
  const limit = MAX_SIZE.find((m) => name.startsWith(m.under))?.px;
  const meta = await sharp(file).metadata();
  const scale = limit ? Math.min(1, limit / Math.max(meta.width, meta.height)) : 1;
  const width = Math.round(meta.width * scale);
  const source = () => (width < meta.width ? sharp(file).resize({ width }) : sharp(file));
  const want = await fingerprint(await source().png().toBuffer());
  const results = [];
  for (const [ext, encode] of [
    ['avif', (s) => s.avif(AVIF)],
    ['webp', (s) => s.webp(WEBP)],
  ]) {
    const target = file.replace(/\.png$/i, `.${ext}`);
    let current = false;
    if (!FORCE && (await sizeOf(target))) {
      const existing = await sharp(target).metadata().catch(() => null);
      current = Boolean(existing) && existing.width === width && distance(want, await fingerprint(target)) < SAME_PICTURE;
    }
    let bytes = await sizeOf(target);
    if (!current) {
      const out = await encode(source()).toBuffer();
      bytes = out.length;
      if (!CHECK) await fs.writeFile(target, out);
    }
    results.push({ name: rel(target), bytes, changed: !current, saved: pngBytes - bytes });
  }
  return results;
}

const sources = await readSources();
const pngs = (await walk(PUBLIC)).filter((f) => /\.png$/i.test(f)).sort();
let todo = 0;
let pngBefore = 0;
let pngAfter = 0;
const lines = [];

for (const file of pngs) {
  const name = rel(file);
  // referenced as "/images/x.png" or, for <picture>, as '/images/x' (the extension is added in the markup)
  const base = `/${name.replace(/\.png$/i, '')}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const used = new RegExp(`${base}(?:\\.png|['"\`])`).test(sources);
  if (!used) {
    lines.push(`${name.padEnd(42)} png  ${kb(await sizeOf(file)).padStart(9)}                 left alone (not referenced by the site)`);
    continue;
  }
  const packed = await repackPng(file);
  pngBefore += packed.before;
  pngAfter += packed.after;
  if (packed.changed) todo++;
  lines.push(`${name.padEnd(42)} png  ${kb(packed.before).padStart(9)} -> ${kb(packed.after).padStart(9)}  ${packed.changed ? (CHECK ? 'can shrink' : 're-packed') : 'ok'}`);
  if (PNG_ONLY.has(path.basename(file))) continue;
  for (const s of await modernSiblings(file, packed.after)) {
    if (s.changed) todo++;
    const share = Math.round((s.saved / packed.after) * 100);
    lines.push(`${s.name.padEnd(42)}      ${''.padStart(9)}    ${kb(s.bytes).padStart(9)}  ${s.changed ? (CHECK ? 'missing or outdated' : 'written') : 'ok'}  (${share} % smaller than the PNG)`);
  }
}

console.log(lines.join('\n'));
console.log(`\nPNG files in use: ${kb(pngBefore)} -> ${kb(pngAfter)}`);
if (CHECK && todo) {
  console.log(`\n${todo} file(s) to update – run: node scripts/optimize-assets.mjs`);
  process.exit(1);
}
console.log(todo ? `\n${todo} file(s) written.` : '\nEverything is up to date.');
