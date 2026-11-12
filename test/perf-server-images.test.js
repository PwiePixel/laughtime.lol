import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import gifenc from 'gifenc';
import sharp from 'sharp';
import { getConfig } from '../server/config.js';
import { resetOutbound } from '../server/lib/outbound.js';
import { IMAGE_WIDTHS, _test, acceptsType, handleMediaRequest, negotiateFormat, pickWidth, proxyStats, sweepCache } from '../server/proxy.js';

// The media proxy end to end: a local server plays the media host, a second
// one runs the proxy handler. Nothing leaves the machine.

const CHROME = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const SAFARI_OLD = 'image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5';
const PLAIN = '*/*';

let upstream;
let proxy;
let origin;
let proxyBase;
let dir;
const files = {}; // path -> { type, body }
const upstreamHits = {};

const noisy = (width, height, channels = 3) =>
  sharp({ create: { width, height, channels, background: { r: 200, g: 60, b: 120, alpha: 1 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } });

/** animated GIF with `frames` different frames */
function makeGif(width, height, frames, flat = false) {
  const gif = gifenc.GIFEncoder();
  for (let f = 0; f < frames; f++) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const v = flat ? f * 60 : (i * 31 + f * 97 + ((i * i) % 251)) % 256;
      rgba.set([v, (v * 3) % 256, 255 - v, 255], i * 4);
    }
    const palette = gifenc.quantize(rgba, 64);
    gif.writeFrame(gifenc.applyPalette(rgba, palette), width, height, { palette, delay: 80 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

const media = (name, query = '', headers = {}) =>
  fetch(`${proxyBase}/api/media?u=${encodeURIComponent(`${origin}/${name}`)}${query}`, { headers });

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lt-images-'));
  Object.assign(getConfig(), { cacheDir: dir, cacheMaxBytes: 500 * 1024 * 1024, imageVariants: true, imageAvif: true, imageWorkers: 2 });

  files['photo.jpg'] = { type: 'image/jpeg', body: await noisy(1000, 800).jpeg({ quality: 92 }).toBuffer() };
  files['small.png'] = { type: 'image/png', body: await noisy(300, 200).png().toBuffer() };
  files['tiny.jpg'] = { type: 'image/jpeg', body: await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } }).jpeg({ quality: 30 }).toBuffer() };
  files['anim.gif'] = { type: 'image/gif', body: makeGif(240, 160, 6) };
  files['flat.gif'] = { type: 'image/gif', body: makeGif(8, 8, 2, true) };
  files['broken.png'] = { type: 'image/png', body: Buffer.from('this is not a picture at all, but it claims to be one'.repeat(20)) };
  files['clip.mp4'] = { type: 'video/mp4', body: Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251)) };
  files['page.html'] = { type: 'text/html', body: Buffer.from('<h1>no</h1>') };

  upstream = http.createServer((req, res) => {
    const name = req.url.slice(1);
    upstreamHits[name] = (upstreamHits[name] || 0) + 1;
    const file = files[name];
    if (!file) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.body.length });
    return res.end(file.body);
  });
  proxy = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    handleMediaRequest(req, res, url.searchParams).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${upstream.address().port}`;
  proxyBase = `http://127.0.0.1:${proxy.address().port}`;
  resetOutbound();
  _test.reset();
  _test.allowOrigin(origin);
});

after(async () => {
  await new Promise((resolve) => upstream.close(resolve));
  await new Promise((resolve) => proxy.close(resolve));
  _test.reset();
  await fsp.rm(dir, { recursive: true, force: true });
});

test('width: only the fixed list, anything else snaps to the nearest entry', () => {
  assert.deepEqual(IMAGE_WIDTHS, [160, 320, 480, 640, 960, 1280]);
  for (const w of IMAGE_WIDTHS) assert.equal(pickWidth(String(w)), w);
  assert.equal(pickWidth('1'), 160);
  assert.equal(pickWidth('200'), 160);
  assert.equal(pickWidth('240'), 320, 'in the middle: the bigger one');
  assert.equal(pickWidth('500'), 480);
  assert.equal(pickWidth('800'), 960);
  assert.equal(pickWidth('99999'), 1280);
  assert.equal(pickWidth('640.4'), 640);
  for (const bad of [null, '', 'abc', '0', '-320', 'NaN', 'Infinity']) assert.equal(pickWidth(bad), null, `"${bad}" is no width`);
});

test('format: decided by the Accept header', () => {
  assert.equal(acceptsType(CHROME, 'image/avif'), true);
  assert.equal(acceptsType(SAFARI_OLD, 'image/avif'), false);
  assert.equal(acceptsType('image/avif;q=0, image/webp;q=0.9', 'image/avif'), false);
  assert.equal(acceptsType('IMAGE/WEBP', 'image/webp'), true);
  assert.equal(acceptsType(PLAIN, 'image/webp'), false, 'a wildcard is no promise');

  const small = { type: 'image/jpeg', pixels: 320 * 240 };
  assert.equal(negotiateFormat({ ...small, accept: CHROME }), 'avif');
  assert.equal(negotiateFormat({ ...small, accept: SAFARI_OLD }), 'webp');
  assert.equal(negotiateFormat({ ...small, accept: PLAIN }), 'jpeg');
  assert.equal(negotiateFormat({ ...small, accept: undefined }), 'jpeg');
  assert.equal(negotiateFormat({ type: 'image/png', pixels: 1000, accept: PLAIN }), 'png');
  assert.equal(negotiateFormat({ type: 'image/gif', pixels: 1000, accept: PLAIN }), 'png', 'a still GIF becomes a PNG');
  // AVIF only where it is cheap enough
  assert.equal(negotiateFormat({ type: 'image/jpeg', pixels: 1280 * 960, accept: CHROME }), 'webp', 'large pictures: WebP');
  assert.equal(negotiateFormat({ ...small, accept: CHROME, busy: true }), 'webp', 'conversions piling up: WebP');
  assert.equal(negotiateFormat({ ...small, accept: CHROME, avif: false }), 'webp', 'AVIF switched off');
  // animations stay animated (WebP) or stay as they are
  assert.equal(negotiateFormat({ type: 'image/gif', animated: true, accept: CHROME }), 'webp');
  assert.equal(negotiateFormat({ type: 'image/gif', animated: true, accept: PLAIN }), null);
});

test('without w the original is returned byte for byte', async () => {
  const res = await media('photo.jpg', '', { Accept: CHROME });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('vary'), null, 'no negotiation without w');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.match(res.headers.get('cache-control'), /max-age=\d{7,}/);
  assert.ok(res.headers.get('etag'));
  assert.ok(res.headers.get('last-modified'));
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), files['photo.jpg'].body);
});

test('with w the picture is scaled and converted once, then served from disk', async () => {
  const before = proxyStats().variants.made;
  // six browsers ask at the same moment
  const answers = await Promise.all(Array.from({ length: 6 }, () => media('photo.jpg', '&w=320', { Accept: CHROME })));
  const bodies = await Promise.all(answers.map(async (r) => Buffer.from(await r.arrayBuffer())));
  for (const res of answers) {
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/avif');
    assert.equal(res.headers.get('vary'), 'Accept');
    assert.match(res.headers.get('cache-control'), /public, max-age=\d{7,}, immutable/);
  }
  for (const body of bodies) assert.deepEqual(body, bodies[0]);
  assert.equal(proxyStats().variants.made - before, 1, 'converted once for all six');
  const info = await sharp(bodies[0]).metadata();
  assert.equal(info.format, 'heif');
  assert.equal(info.width, 320);
  assert.equal(info.height, 256);
  assert.ok(bodies[0].length < files['photo.jpg'].body.length / 4);
  assert.equal(upstreamHits['photo.jpg'], 1, 'the original was downloaded once');

  // the variant lies next to the original in the cache folder
  const names = await fsp.readdir(dir);
  assert.ok(names.some((n) => /^[0-9a-f]{40}\.320\.avif\.bin$/.test(n)), names.join(', '));

  await media('photo.jpg', '&w=320', { Accept: CHROME });
  assert.equal(proxyStats().variants.made - before, 1, 'the second visitor gets the stored file');
});

test('the same address gives WebP or the original format to browsers without AVIF', async () => {
  const webp = await media('photo.jpg', '&w=320', { Accept: SAFARI_OLD });
  assert.equal(webp.headers.get('content-type'), 'image/webp');
  assert.equal((await sharp(Buffer.from(await webp.arrayBuffer())).metadata()).width, 320);

  const jpeg = await media('photo.jpg', '&w=320', { Accept: PLAIN });
  assert.equal(jpeg.headers.get('content-type'), 'image/jpeg');
  assert.equal(jpeg.headers.get('vary'), 'Accept');
  const info = await sharp(Buffer.from(await jpeg.arrayBuffer())).metadata();
  assert.deepEqual([info.format, info.width], ['jpeg', 320]);

  // three representations, three different validators
  const tags = new Set([webp.headers.get('etag'), jpeg.headers.get('etag'), (await media('photo.jpg', '&w=320', { Accept: CHROME })).headers.get('etag')]);
  assert.equal(tags.size, 3);
});

test('odd widths snap to the list and pictures are never scaled up', async () => {
  const snapped = await media('photo.jpg', '&w=333', { Accept: SAFARI_OLD });
  assert.equal((await sharp(Buffer.from(await snapped.arrayBuffer())).metadata()).width, 320);

  const large = await media('photo.jpg', '&w=4000', { Accept: SAFARI_OLD });
  assert.equal(large.headers.get('content-type'), 'image/webp');
  assert.equal((await sharp(Buffer.from(await large.arrayBuffer())).metadata()).width, 1000, 'w=4000 -> 1280 -> not wider than the original');

  const small = await media('small.png', '&w=1280', { Accept: SAFARI_OLD });
  assert.equal((await sharp(Buffer.from(await small.arrayBuffer())).metadata()).width, 300);

  // no usable width: the original
  const none = await media('photo.jpg', '&w=abc', { Accept: CHROME });
  assert.equal(none.headers.get('content-type'), 'image/jpeg');
  assert.equal(Number(none.headers.get('content-length')), files['photo.jpg'].body.length);
});

test('a variant that would not be smaller is replaced by the original', async () => {
  const res = await media('tiny.jpg', '&w=640', { Accept: PLAIN });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), files['tiny.jpg'].body);
  assert.equal(res.headers.get('vary'), 'Accept');
});

test('animated GIFs stay animated as WebP, or stay as they are', async () => {
  const res = await media('anim.gif', '&w=160', { Accept: CHROME });
  assert.equal(res.headers.get('content-type'), 'image/webp');
  const body = Buffer.from(await res.arrayBuffer());
  const info = await sharp(body, { animated: true }).metadata();
  assert.equal(info.pages, 6, 'all frames are still there');
  assert.equal(info.width, 160);
  assert.ok(body.length < files['anim.gif'].body.length);

  // a browser without WebP gets the untouched GIF
  const plain = await media('anim.gif', '&w=160', { Accept: PLAIN });
  assert.equal(plain.headers.get('content-type'), 'image/gif');
  assert.deepEqual(Buffer.from(await plain.arrayBuffer()), files['anim.gif'].body);

  // a tiny animation: WebP only if that really is smaller, never a broken picture
  const flat = await media('flat.gif', '&w=320', { Accept: CHROME });
  const flatBody = Buffer.from(await flat.arrayBuffer());
  if (flat.headers.get('content-type') === 'image/gif') assert.deepEqual(flatBody, files['flat.gif'].body);
  else assert.ok(flatBody.length < files['flat.gif'].body.length);
});

test('a picture that cannot be converted falls back to the original', async () => {
  for (let i = 0; i < 2; i++) {
    const res = await media('broken.png', '&w=320', { Accept: CHROME });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), files['broken.png'].body);
  }
});

test('videos ignore w and range requests work as before', async () => {
  const full = await media('clip.mp4', '&w=320', { Accept: CHROME });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('vary'), null);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), files['clip.mp4'].body);

  const part = await media('clip.mp4', '', { Range: 'bytes=100-299' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-299/5000');
  assert.equal(part.headers.get('content-length'), '200');
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), files['clip.mp4'].body.subarray(100, 300));

  const tail = await media('clip.mp4', '', { Range: 'bytes=-100' });
  assert.equal(tail.headers.get('content-range'), 'bytes 4900-4999/5000');
  const open = await media('clip.mp4', '', { Range: 'bytes=4000-' });
  assert.equal(open.headers.get('content-range'), 'bytes 4000-4999/5000');
  const beyond = await media('clip.mp4', '', { Range: 'bytes=9000-' });
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers.get('content-range'), 'bytes */5000');

  // If-Range: the part only for the version the browser already knows
  const etag = full.headers.get('etag');
  assert.equal((await media('clip.mp4', '', { Range: 'bytes=0-9', 'If-Range': etag })).status, 206);
  const changed = await media('clip.mp4', '', { Range: 'bytes=0-9', 'If-Range': '"something-else"' });
  assert.equal(changed.status, 200);
  assert.equal(changed.headers.get('content-length'), '5000');
});

test('304 for browsers that already have the file', async () => {
  const first = await media('photo.jpg', '&w=480', { Accept: SAFARI_OLD });
  await first.arrayBuffer();
  const etag = first.headers.get('etag');
  assert.match(etag, /^"[^"]+"$/, 'a strong validator');

  const same = await media('photo.jpg', '&w=480', { Accept: SAFARI_OLD, 'If-None-Match': etag });
  assert.equal(same.status, 304);
  assert.equal(same.headers.get('etag'), etag);
  assert.equal(same.headers.get('vary'), 'Accept');
  assert.equal((await same.arrayBuffer()).byteLength, 0);

  const listed = await media('photo.jpg', '&w=480', { Accept: SAFARI_OLD, 'If-None-Match': `"zzz", ${etag}` });
  assert.equal(listed.status, 304);
  // another representation of the same address: no match
  const other = await media('photo.jpg', '&w=480', { Accept: CHROME, 'If-None-Match': etag });
  assert.equal(other.status, 200);
  await other.arrayBuffer();

  const since = await media('photo.jpg', '', { 'If-Modified-Since': first.headers.get('last-modified') });
  assert.equal(since.status, 304);
  const older = await media('photo.jpg', '', { 'If-Modified-Since': new Date(Date.now() - 86_400_000).toUTCString() });
  assert.equal(older.status, 200);
  await older.arrayBuffer();

  const head = await fetch(`${proxyBase}/api/media?u=${encodeURIComponent(`${origin}/photo.jpg`)}&w=480`, { method: 'HEAD', headers: { Accept: SAFARI_OLD } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), first.headers.get('content-length'));
});

test('other hosts and other file types are refused', async () => {
  const foreign = await fetch(`${proxyBase}/api/media?u=${encodeURIComponent('https://example.com/a.jpg')}&w=320`);
  assert.equal(foreign.status, 400);
  const html = await media('page.html', '&w=320');
  assert.equal(html.status, 415);
  assert.equal(html.headers.get('cache-control'), 'no-store');
  const missing = await media('nothing.jpg', '&w=320');
  assert.equal(missing.status, 502);
});

test('variants count towards the cache limit and leave together with their original', async () => {
  const cfg = getConfig();
  const before = await sweepCache();
  const names = await fsp.readdir(dir);
  const variants = names.filter((n) => /^[0-9a-f]{40}\.\d+\.[a-z]+\.bin$/.test(n));
  assert.ok(variants.length >= 5);
  let sum = 0;
  for (const n of names) if (n.endsWith('.bin')) sum += (await fsp.stat(path.join(dir, n))).size;
  assert.equal(before, sum, 'originals and variants are counted');
  assert.equal(proxyStats().cacheBytes, sum);

  // something that does not belong to the proxy must survive every clean-up
  await fsp.writeFile(path.join(dir, 'pool.json'), '{}');
  cfg.cacheMaxBytes = 1;
  const left = await sweepCache();
  cfg.cacheMaxBytes = 500 * 1024 * 1024;
  assert.equal(left, 0);
  assert.deepEqual(await fsp.readdir(dir), ['pool.json']);

  // and everything comes back on demand
  const again = await media('photo.jpg', '&w=320', { Accept: SAFARI_OLD });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('content-type'), 'image/webp');
  await again.arrayBuffer();
});
