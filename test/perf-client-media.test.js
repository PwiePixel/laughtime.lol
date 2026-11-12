import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MEDIA_WIDTHS,
  frameSlotWidth,
  hasVariants,
  mediaSizes,
  mediaSrc,
  mediaSrcSet,
  originalSrc,
  preloadMedia,
  responsiveImage,
  slotSizes,
  snapWidth,
} from '../lib/media.js';

const proxied = (url) => `/api/media?u=${encodeURIComponent(url)}`;
const JPG = proxied('https://i.imgflip.com/1otri4.jpg');
const MP4 = proxied('https://i.imgflip.com/an1xzp.mp4');
const GIF = proxied('https://media2.giphy.com/media/abc/giphy.gif?cid=123');
const UPLOAD = '/api/uploads/packs/abc.png';
const DATA = 'data:image/png;base64,AAAA';

test('only pictures behind the media proxy have variants', () => {
  assert.equal(hasVariants(JPG), true);
  assert.equal(hasVariants(MP4), false);
  assert.equal(hasVariants(GIF), false);
  assert.equal(hasVariants(UPLOAD), false);
  assert.equal(hasVariants(DATA), false);
  assert.equal(hasVariants('/api/mediaX?u=1'), false);
  assert.equal(hasVariants(undefined), false);
  assert.equal(hasVariants('/api/media?x=1'), false);
});

test('widths snap up to the next available size', () => {
  assert.equal(snapWidth(1), 160);
  assert.equal(snapWidth(160), 160);
  assert.equal(snapWidth(161), 320);
  assert.equal(snapWidth(700), 960);
  assert.equal(snapWidth(5000), 1280);
  assert.equal(snapWidth(undefined), 160);
});

test('mediaSrc adds the width only where it makes sense', () => {
  assert.equal(mediaSrc(JPG, 300), `${JPG}&w=320`);
  assert.equal(mediaSrc(JPG), JPG);
  assert.equal(mediaSrc(JPG, 0), JPG);
  assert.equal(mediaSrc(MP4, 300), MP4);
  assert.equal(mediaSrc(GIF, 300), GIF);
  assert.equal(mediaSrc(UPLOAD, 300), UPLOAD);
  assert.equal(mediaSrc(DATA, 300), DATA);
});

test('a width that is already there is replaced, never doubled', () => {
  assert.equal(mediaSrc(`${JPG}&w=160`, 900), `${JPG}&w=960`);
  assert.equal(mediaSrc(`/api/media?w=160&u=${encodeURIComponent('https://i.imgflip.com/a.png')}`, 600), `${proxied('https://i.imgflip.com/a.png')}&w=640`);
});

test('originalSrc always leads back to the untouched file', () => {
  assert.equal(originalSrc(`${JPG}&w=640`), JPG);
  assert.equal(originalSrc(JPG), JPG);
  assert.equal(originalSrc(UPLOAD), UPLOAD);
  assert.equal(originalSrc(DATA), DATA);
  assert.equal(originalSrc(`${MP4}&w=320`), MP4);
  for (const w of MEDIA_WIDTHS) assert.equal(originalSrc(mediaSrc(JPG, w)), JPG);
});

test('srcset lists every width, limited by the size of the original', () => {
  assert.equal(
    mediaSrcSet(JPG),
    MEDIA_WIDTHS.map((w) => `${JPG}&w=${w} ${w}w`).join(', '),
  );
  // a 500 px picture: nothing above the step that holds it, described with its real width
  assert.equal(mediaSrcSet(JPG, { intrinsicWidth: 500 }), `${JPG}&w=160 160w, ${JPG}&w=320 320w, ${JPG}&w=480 480w, ${JPG}&w=640 500w`);
  assert.equal(mediaSrcSet(JPG, { intrinsicWidth: 100 }), `${JPG}&w=160 100w`);
  assert.equal(mediaSrcSet(JPG, { maxWidth: 400 }), `${JPG}&w=160 160w, ${JPG}&w=320 320w, ${JPG}&w=480 480w`);
  assert.equal(mediaSrcSet(MP4), undefined);
  assert.equal(mediaSrcSet(UPLOAD), undefined);
  assert.equal(mediaSrcSet(DATA), undefined);
});

test('sizes are built from breakpoints', () => {
  assert.equal(mediaSizes([[600, '100vw'], [1100, '50vw']], '320px'), '(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 320px');
  assert.equal(mediaSizes(), '100vw');
  assert.equal(slotSizes(300), '(max-width: 300px) 100vw, 300px');
});

test('responsiveImage gives an <img> everything it needs', () => {
  const eager = responsiveImage(JPG, { width: 300, intrinsicWidth: 600 });
  assert.equal(eager.src, `${JPG}&w=640`);
  assert.equal(eager.sizes, '(max-width: 300px) 100vw, 300px');
  assert.ok(eager.srcSet.endsWith(`${JPG}&w=640 600w`));
  // lazy pictures let the browser measure the box, with the same fallback
  assert.equal(responsiveImage(JPG, { width: 300, lazy: true }).sizes, 'auto, (max-width: 300px) 100vw, 300px');
  assert.equal(responsiveImage(JPG, { sizes: '50vw' }).sizes, '50vw');
  // without variants the source stays exactly as it is
  assert.deepEqual(responsiveImage(UPLOAD, { width: 300 }), { src: UPLOAD, srcSet: undefined, sizes: undefined });
  assert.deepEqual(responsiveImage(MP4, { width: 300 }), { src: MP4, srcSet: undefined, sizes: undefined });
});

test('the frame width follows from the height limit and the aspect ratio', () => {
  assert.equal(frameSlotWidth('300px', 1), 300);
  assert.equal(frameSlotWidth('300px', 0.5), 160);
  assert.equal(frameSlotWidth('300px', 2), 600);
  assert.equal(frameSlotWidth('min(70vh, 720px)', 1), 720);
  assert.equal(frameSlotWidth('62vh', 1), 720);
  assert.equal(frameSlotWidth('62vh', 3), 960);
  assert.equal(frameSlotWidth(undefined, 0), 720);
});

test('preloading is a no-op outside the browser', async () => {
  assert.equal(await preloadMedia(JPG), false);
  assert.equal(await preloadMedia(MP4, { kind: 'video' }), false);
  assert.equal(await preloadMedia(''), false);
});
