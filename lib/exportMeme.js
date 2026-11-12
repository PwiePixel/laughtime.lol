'use client';

// Renders a meme (image or short clip + captions) into a file the player can keep.
// Images -> PNG, clips -> animated GIF (one loop, max 10 s).
// Every file gets the LaughTime "LoL" logo in the bottom-right corner.
// Media is served by our own proxy, so the canvas is never "tainted".

import { inActivity, shareMediaToDiscord } from './activity';

const MAX_W = 1080;
const MIN_W = 800;
// animated GIF settings for clips
const GIF_MAX_W = 480;
const GIF_MIN_W = 360;
const GIF_FPS = 12.5; // 80 ms per frame = exact GIF timing (GIF delays are in 1/100 s)
const GIF_MAX_SECONDS = 10;

function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (let word of words) {
      // break very long words
      while (ctx.measureText(word).width > maxWidth && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut--;
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

export function drawCaptions(ctx, captions, w, h, fontFamily) {
  for (const c of captions) {
    const raw = c.upper ? c.text.toUpperCase() : c.text;
    if (!raw.trim()) continue;
    const size = (c.size / 100) * w;
    ctx.font = `${size}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    const lines = wrapLines(ctx, raw, (c.w / 100) * w);
    const lh = size * 1.08;
    const cx = (c.x / 100) * w;
    const cy = (c.y / 100) * h;
    const top = cy - (lh * (lines.length - 1)) / 2;
    lines.forEach((line, i) => {
      const y = top + i * lh;
      ctx.lineWidth = size * 0.13;
      ctx.strokeStyle = c.color === '#000000' ? '#FFFFFF' : '#000000';
      ctx.strokeText(line, cx, y);
      ctx.fillStyle = c.color;
      ctx.fillText(line, cx, y);
    });
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function loadVideo(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.onloadeddata = () => resolve(v);
    v.onerror = reject;
    v.src = src;
  });
}

let logoPromise = null;

/** Loads the vector logo (crisp at any size); falls back to the PNG. */
function loadLogo() {
  if (!logoPromise) {
    logoPromise = fetch('/logo-mark.svg')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('no svg'))))
      .then((svg) => {
        // explicit size, otherwise some browsers report 0×0 for SVG images
        const sized = svg.replace('<svg ', '<svg width="1240" height="600" ');
        const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
        return loadImage(url);
      })
      .catch(() => loadImage('/logo-mark.png'))
      .catch(() => null);
  }
  return logoPromise;
}

/**
 * Renders the "LoL" logo once, at exactly the pixel size it will be used,
 * with a soft dark outline so it stays readable on bright and dark media.
 */
function prepareWatermark(logo, w, h) {
  if (!logo) return null;
  const ratio = (logo.naturalHeight || 300) / (logo.naturalWidth || 620);
  // small corner mark: ~14 % of the width, never huge on big templates
  const lw = Math.round(Math.max(64, Math.min(180, w * 0.14)));
  const lh = Math.round(lw * ratio);
  const pad = Math.ceil(lw * 0.06);
  const c = document.createElement('canvas');
  c.width = lw + pad * 2;
  c.height = lh + pad * 2;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.shadowColor = 'rgba(0, 0, 0, 0.55)';
  x.shadowBlur = pad * 0.9;
  x.drawImage(logo, pad, pad, lw, lh);
  const m = Math.round(Math.max(6, w * 0.016));
  return { canvas: c, x: w - c.width - m + pad, y: h - c.height - m + pad };
}

const WATERMARK_ALPHA = 0.78;

function drawWatermark(ctx, mark) {
  if (!mark) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false; // 1:1 copy, no resampling
  ctx.globalAlpha = WATERMARK_ALPHA; // slightly see-through so it never covers the joke
  ctx.drawImage(mark.canvas, mark.x, mark.y);
  ctx.restore();
}

function seek(video, t) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish);
    setTimeout(finish, 1500); // never hang on a stubborn frame
    video.currentTime = t;
  });
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Clips are saved as animated GIF: the clip is stepped through frame by frame,
 * captions + logo are drawn on top, then everything is encoded in the browser.
 */
async function exportGif(media, captions, family, logo, onProgress) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const video = await loadVideo(media.src);
  const duration = Math.min(GIF_MAX_SECONDS, Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 4);
  const vw = video.videoWidth || 480;
  const vh = video.videoHeight || 270;
  const width = Math.round(Math.min(GIF_MAX_W, Math.max(GIF_MIN_W, vw)));
  const height = Math.round((width * vh) / vw);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const mark = prepareWatermark(logo, width, height);

  const render = async (t) => {
    await seek(video, Math.min(t, Math.max(0, duration - 0.001)));
    ctx.drawImage(video, 0, 0, width, height);
    drawCaptions(ctx, captions, width, height, family);
    drawWatermark(ctx, mark);
    return ctx.getImageData(0, 0, width, height).data;
  };

  const frames = Math.max(1, Math.round(duration * GIF_FPS));
  const delay = Math.round(1000 / GIF_FPS);

  // 1) one shared palette from a few sample frames -> no colour flicker
  const samples = Math.min(6, frames);
  const sampleSize = width * height * 4;
  const pool = new Uint8Array(sampleSize * samples);
  for (let i = 0; i < samples; i++) {
    const data = await render((duration * (i + 0.5)) / samples);
    pool.set(data, i * sampleSize);
    onProgress?.(Math.round(((i + 1) / samples) * 10));
  }
  const palette = quantize(pool, 256, { format: 'rgb565' });

  // 2) encode every frame
  const gif = GIFEncoder();
  for (let i = 0; i < frames; i++) {
    const data = await render(i / GIF_FPS);
    const index = applyPalette(data, palette, 'rgb565');
    gif.writeFrame(index, width, height, { palette: i === 0 ? palette : undefined, delay, repeat: 0 });
    onProgress?.(10 + Math.round(((i + 1) / frames) * 90));
    if (i % 3 === 0) await nextFrame(); // keep the page responsive
  }
  gif.finish();
  video.removeAttribute('src');
  video.load();
  return { blob: new Blob([gif.bytes()], { type: 'image/gif' }), ext: 'gif' };
}

/**
 * Animated pictures (own GIF / WebP uploads): decoded frame by frame with the
 * browser's ImageDecoder (Chrome, Edge, Opera). Other browsers get a PNG.
 */
async function exportAnimatedImage(media, captions, family, logo, onProgress) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const buf = await (await fetch(media.src)).arrayBuffer();
  const type = /\.webp($|\?)/i.test(media.src) ? 'image/webp' : /\.png($|\?)/i.test(media.src) ? 'image/png' : 'image/gif';
  const decoder = new window.ImageDecoder({ data: buf, type });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  await decoder.completed.catch(() => {});
  const count = Math.min(track?.frameCount || 1, 400);
  if (count < 2) {
    decoder.close();
    return null;
  }
  const first = await decoder.decode({ frameIndex: 0 });
  const vw = first.image.displayWidth || media.width || 480;
  const vh = first.image.displayHeight || media.height || 270;
  first.image.close();
  const width = Math.round(Math.min(GIF_MAX_W, Math.max(GIF_MIN_W, vw)));
  const height = Math.round((width * vh) / vw);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const mark = prepareWatermark(logo, width, height);

  const render = async (i) => {
    const { image } = await decoder.decode({ frameIndex: i });
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const ms = Math.max(20, Math.round((image.duration || 100000) / 1000));
    image.close();
    drawCaptions(ctx, captions, width, height, family);
    drawWatermark(ctx, mark);
    return { data: ctx.getImageData(0, 0, width, height).data, ms };
  };

  const samples = Math.min(6, count);
  const size = width * height * 4;
  const pool = new Uint8Array(size * samples);
  for (let i = 0; i < samples; i++) {
    const { data } = await render(Math.floor((i * count) / samples));
    pool.set(data, i * size);
  }
  const palette = quantize(pool, 256, { format: 'rgb565' });
  const gif = GIFEncoder();
  let total = 0;
  for (let i = 0; i < count && total < 15000; i++) {
    const { data, ms } = await render(i);
    total += ms;
    gif.writeFrame(applyPalette(data, palette, 'rgb565'), width, height, { palette: i === 0 ? palette : undefined, delay: ms, repeat: 0 });
    onProgress?.(Math.round(((i + 1) / count) * 100));
    if (i % 3 === 0) await nextFrame();
  }
  gif.finish();
  decoder.close();
  return { blob: new Blob([gif.bytes()], { type: 'image/gif' }), ext: 'gif' };
}

export async function exportMeme(meme, fontFamily, onProgress) {
  const family = fontFamily || 'Impact, sans-serif';
  try {
    await document.fonts.load(`40px ${family}`);
  } catch {
    /* ignore */
  }
  const { media, captions } = meme;
  const logo = await loadLogo();

  if (media.kind === 'video') return exportGif(media, captions, family, logo, onProgress);
  if (media.animated && typeof window !== 'undefined' && 'ImageDecoder' in window) {
    try {
      const out = await exportAnimatedImage(media, captions, family, logo, onProgress);
      if (out) return out;
    } catch (err) {
      console.warn('animated export failed, saving a PNG instead', err);
    }
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = await loadImage(media.src);
  // small templates are scaled up so text and logo stay sharp
  const scale = Math.min(MAX_W, Math.max(MIN_W, img.naturalWidth)) / img.naturalWidth || 1;
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  drawCaptions(ctx, captions, canvas.width, canvas.height, family);
  drawWatermark(ctx, prepareWatermark(logo, canvas.width, canvas.height));
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  onProgress?.(100);
  return { blob, ext: 'png' };
}

export async function downloadMeme(meme, fontFamily, baseName = 'laughtime-meme', onProgress) {
  const { blob, ext } = await exportMeme(meme, fontFamily, onProgress);
  const file = `${baseName}.${ext}`;
  // inside Discord: share into a channel/DM instead of downloading
  if (inActivity()) {
    try {
      if (await shareMediaToDiscord(blob, file)) return 'shared';
    } catch (err) {
      console.warn('discord share failed, trying a download', err);
    }
  }
  // mobile: use the share sheet when available
  if (navigator.canShare?.({ files: [new File([blob], file, { type: blob.type })] }) && /Mobi|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [new File([blob], file, { type: blob.type })], title: 'laughtime.lol' });
      return;
    } catch {
      /* fall back to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
