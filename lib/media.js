// Optimised image variants of the media proxy.
//
//   /api/media?u=<url>&w=<width>   w is one of MEDIA_WIDTHS
//
// The server picks the format (AVIF / WebP) from the Accept header; without
// `w` it returns the untouched original. Only pictures behind /api/media have
// variants: clips ignore `w`, own uploads (/api/uploads/…) already come with a
// small preview and data: URLs are complete in themselves – all of these pass
// through unchanged. A server that does not know `w` yet answers with the
// original, so everything here also works without the variants.
//
// The file download / GIF export (lib/exportMeme.js) must always get the
// original: use originalSrc() when in doubt.

import { useEffect, useState } from 'react';

export const MEDIA_WIDTHS = [160, 320, 480, 640, 960, 1280];

const PROXY_PREFIX = '/api/media?';
// clips never have variants; animated GIFs keep their original so they stay animated
const NO_VARIANT_EXT = /\.(?:mp4|webm|m4v|mov|gif)$/i;

function proxyParts(src) {
  if (typeof src !== 'string' || !src.startsWith(PROXY_PREFIX)) return null;
  const params = src.slice(PROXY_PREFIX.length).split('&').filter(Boolean);
  const u = params.find((p) => p.startsWith('u='));
  if (!u) return null;
  return { u, rest: params.filter((p) => p !== u && !p.startsWith('w=')) };
}

function upstreamPath(u) {
  try {
    return new URL(decodeURIComponent(u.slice(2))).pathname;
  } catch {
    return '';
  }
}

/** true when the proxy can deliver smaller versions of this picture */
export function hasVariants(src) {
  const parts = proxyParts(src);
  return Boolean(parts) && !NO_VARIANT_EXT.test(upstreamPath(parts.u));
}

/** the smallest available width that covers `px` (the largest one for huge requests) */
export function snapWidth(px) {
  const wanted = Math.ceil(Number(px) || 0);
  return MEDIA_WIDTHS.find((w) => w >= wanted) || MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1];
}

/** the untouched file (any `w` removed) */
export function originalSrc(src) {
  const parts = proxyParts(src);
  if (!parts) return src;
  return PROXY_PREFIX + [parts.u, ...parts.rest].join('&');
}

/**
 * URL of the variant that is at least `width` pixels wide.
 * No width (or a source without variants) returns the original.
 */
export function mediaSrc(src, width) {
  if (!width || !hasVariants(src)) return originalSrc(src);
  return `${originalSrc(src)}&w=${snapWidth(width)}`;
}

/**
 * srcset with every useful width: "…&w=160 160w, …&w=320 320w, …".
 *   intrinsicWidth  width of the original (when known): nothing bigger is offered
 *   maxWidth        the widest the picture is ever shown (device pixels)
 * Returns undefined for sources without variants.
 */
export function mediaSrcSet(src, { intrinsicWidth = 0, maxWidth = MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1] } = {}) {
  if (!hasVariants(src)) return undefined;
  const cap = Math.min(snapWidth(maxWidth), intrinsicWidth > 0 ? snapWidth(intrinsicWidth) : Infinity);
  return MEDIA_WIDTHS.filter((w) => w <= cap)
    .map((w) => {
      // the last step is the full picture: describe it with its real width
      const described = intrinsicWidth > 0 ? Math.min(w, Math.round(intrinsicWidth)) : w;
      return `${mediaSrc(src, w)} ${described}w`;
    })
    .join(', ');
}

/**
 * sizes attribute from breakpoints:
 *   mediaSizes([[600, '100vw'], [1100, '50vw']], '320px')
 *   -> "(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 320px"
 */
export function mediaSizes(breakpoints = [], fallback = '100vw') {
  return [...breakpoints.map(([maxViewport, size]) => `(max-width: ${maxViewport}px) ${size}`), fallback].join(', ');
}

/** sizes for a box that is `px` wide, or as wide as a narrow screen allows */
export const slotSizes = (px) => mediaSizes([[Math.round(px), '100vw']], `${Math.round(px)}px`);

/**
 * Everything an <img> needs for a picture shown about `width` CSS pixels wide:
 * { src, srcSet, sizes }. Lazy pictures let the browser measure the box itself
 * ("auto"), the given width is the fallback.
 */
export function responsiveImage(src, { width = 640, intrinsicWidth = 0, sizes, lazy = false } = {}) {
  const srcSet = mediaSrcSet(src, { intrinsicWidth });
  if (!srcSet) return { src, srcSet: undefined, sizes: undefined };
  const fallback = sizes || slotSizes(width);
  return {
    // browsers without srcset get a middle-sized picture
    src: mediaSrc(src, Math.min(width * 2, intrinsicWidth || Infinity)),
    srcSet,
    sizes: lazy ? `auto, ${fallback}` : fallback,
  };
}

/**
 * How wide (CSS pixels) a meme frame gets at most: it is limited by its height
 * (maxHeight, e.g. "300px", "62vh" or "min(70vh, 720px)") times the aspect ratio.
 */
export function frameSlotWidth(maxHeight, ratio = 1) {
  const px = [...String(maxHeight ?? '').matchAll(/([\d.]+)px/g)].map((m) => Number(m[1])).filter((n) => n > 0);
  // heights given in vh only: assume a tall desktop window
  const height = px.length ? Math.min(...px) : 720;
  return Math.max(MEDIA_WIDTHS[0], Math.min(960, Math.ceil(height * (ratio > 0 ? ratio : 1))));
}

// --- preloading ---------------------------------------------------------------

const preloaded = new Map();
const PRELOAD_MEMORY = 150;

function remember(key, promise) {
  preloaded.set(key, promise);
  if (preloaded.size > PRELOAD_MEMORY) preloaded.delete(preloaded.keys().next().value);
  return promise;
}

/**
 * Loads (and decodes) media ahead of time, e.g. the next picture of a round
 * or the big version of a thumbnail the pointer is resting on.
 *   preloadMedia(src)                           the original
 *   preloadMedia(src, { width: 640 })           one variant
 *   preloadMedia(src, { srcSet, sizes })        whatever the <img> will pick
 *   preloadMedia(src, { kind: 'video' })        the start of a clip
 * Resolves to true when the media is ready; never rejects. Every source is
 * loaded only once. Visitors who asked their browser to save data are spared.
 */
export function preloadMedia(src, { kind = 'image', width = 0, srcSet, sizes } = {}) {
  if (typeof window === 'undefined' || typeof src !== 'string' || !src) return Promise.resolve(false);
  if (navigator.connection?.saveData) return Promise.resolve(false);
  const url = kind === 'video' ? src : mediaSrc(src, width);
  const key = `${kind}|${url}|${srcSet || ''}|${sizes || ''}`;
  const known = preloaded.get(key);
  if (known) return known;

  if (kind === 'video') {
    return remember(
      key,
      new Promise((resolve) => {
        // the first bytes are enough: the proxy fetches the clip and the browser learns its size
        const video = document.createElement('video');
        const done = (ok) => {
          video.onloadedmetadata = null;
          video.onerror = null;
          // let go of the connection, the element is not needed any more
          video.removeAttribute('src');
          video.load();
          resolve(ok);
        };
        video.muted = true;
        video.preload = 'metadata';
        video.onloadedmetadata = () => done(true);
        video.onerror = () => done(false);
        video.src = src;
      }),
    );
  }

  return remember(
    key,
    new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      if (srcSet) {
        if (sizes) img.sizes = sizes;
        img.srcset = srcSet;
      }
      img.src = url;
      if (typeof img.decode === 'function') {
        img.decode().then(
          () => resolve(true),
          () => resolve(false),
        );
      } else {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
      }
    }),
  );
}

// --- visibility -----------------------------------------------------------------

/**
 * true while the element is (nearly) on screen.
 *   rootMargin  how early "nearly" starts, e.g. '300px'
 *   threshold   how much of the element has to be visible (0…1)
 *   once        stay true after the first sighting (lazy loading)
 *   enabled     false = do not observe (the result is then false)
 * Browsers without IntersectionObserver treat everything as visible.
 */
export function useInView(ref, { rootMargin = '0px', threshold = 0, once = false, enabled = true } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) {
      setInView(false);
      return undefined;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // several records can arrive at once: the last one is the current state
        const visible = entries[entries.length - 1].isIntersecting;
        if (visible && once) observer.disconnect();
        if (visible || !once) setInView(visible);
      },
      { rootMargin, threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, threshold, once, enabled]);
  return inView;
}
