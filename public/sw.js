/* LaughTime service worker (hand-written, no build step).
 *
 * What it does:
 *   - page loads (navigations)   network first; when the network is gone, the cached
 *                                offline page (/offline) is shown instead. Pages
 *                                themselves are never stored.
 *   - /_next/static/*, fonts     cache first (the file names contain a hash: immutable)
 *   - images of the site and     stale-while-revalidate with an entry limit
 *     image answers of /api/media
 *
 * What it never touches (the browser talks to the server directly):
 *   - every other /api/* request – accounts, sessions, rooms and uploads are personal
 *   - anything that is not a GET, range requests and videos/audio (streaming)
 *   - the WebSocket (/ws), the Discord Activity and other origins
 *
 * Updates: a new worker installs in the background and then WAITS. The page shows
 * "update available" and sends { type: 'SKIP_WAITING' } when the visitor agrees –
 * so nobody is reloaded in the middle of a game.
 */

// Bump this to throw away every cache of older versions (see "activate").
const VERSION = 'v1';

const PREFIX = 'laughtime-';
const CACHE_PAGES = `${PREFIX}pages-${VERSION}`; // only the offline page
const CACHE_STATIC = `${PREFIX}static-${VERSION}`; // /_next/static/* and fonts
const CACHE_IMAGES = `${PREFIX}images-${VERSION}`; // logo, icons, mascots …
const CACHE_MEDIA = `${PREFIX}media-${VERSION}`; // meme templates from /api/media
const CURRENT_CACHES = [CACHE_PAGES, CACHE_STATIC, CACHE_IMAGES, CACHE_MEDIA];

// Entry limits: the oldest entries are removed first, so no cache grows without bounds.
const LIMITS = {
  [CACHE_STATIC]: 300,
  [CACHE_IMAGES]: 80,
  [CACHE_MEDIA]: 120,
};

// A cached image younger than this is served without asking the network again.
const FRESH_MS = {
  [CACHE_IMAGES]: 60 * 60 * 1000,
  // media URLs never change their content (the server marks them immutable)
  [CACHE_MEDIA]: 24 * 60 * 60 * 1000,
};

const OFFLINE_URL = '/offline';
// small images the offline page shows (header logo, app icon)
const OFFLINE_IMAGES = ['/logo-mark.svg', '/icons/icon-192.png'];

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i;
const FONT_FILE = /\.(?:woff2?|ttf|otf)$/i;

/**
 * Decides what happens with a request:
 *   'page'    page load with the offline page as fallback
 *   'direct'  page load that is only passed on (never a fallback)
 *   'static' | 'image' | 'media'  -> answered from a cache, see below
 *   null      not handled at all, the browser talks to the network itself
 */
function strategyFor(request, origin) {
  if (request.method !== 'GET') return null;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const path = url.pathname;
  const dest = request.destination || '';

  if (request.mode === 'navigate') {
    // Every page load is answered here (with the preloaded answer, see "activate"),
    // so the request is never sent twice – important for the login redirects.
    // API pages (Discord login), files and the Discord Activity (it runs in
    // Discord's iframe and has its own loading screens) get no offline page.
    if (path.startsWith('/api/') || /\.[a-z0-9]{2,5}$/i.test(path)) return 'direct';
    if (url.searchParams.has('frame_id') || path === '/activity' || path.startsWith('/activity/')) return 'direct';
    return 'page';
  }

  // streaming: videos ask for byte ranges, a cached full answer would break seeking
  if (request.headers.has('range')) return null;
  if (dest === 'video' || dest === 'audio' || dest === 'track') return null;
  if (path === '/ws' || path === '/sw.js' || path === '/manifest.json') return null;

  if (path.startsWith('/api/')) {
    // the media proxy is the only API whose answers are public and never change
    if (path === '/api/media' && (dest === 'image' || dest === '')) return 'media';
    return null;
  }

  if (path.startsWith('/_next/static/')) return 'static';
  // everything else below /_next/ (image optimizer, dev tools) stays untouched
  if (path.startsWith('/_next/')) return null;
  if (dest === 'font' || FONT_FILE.test(path)) return 'static';
  if (dest === 'image' || IMAGE_FILE.test(path)) return 'image';
  // page data of the app router, downloads … : network only
  return null;
}

/** only complete, same-origin answers may be stored (no 206, no redirects, no errors) */
function isStorable(response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return false;
  // "Vary: *" can never be matched again (and cache.put() refuses it)
  return !/(^|,)\s*\*\s*(,|$)/.test(response.headers.get('Vary') || '');
}

function isImageResponse(response) {
  return /^image\//i.test(response.headers.get('Content-Type') || '');
}

/** removes the oldest entries until the cache is inside its limit */
async function trimCache(cacheName) {
  const max = LIMITS[cacheName];
  if (!max) return;
  const cache = await caches.open(cacheName);
  // keys() lists the oldest entry first; variants of one URL (Vary) count separately
  const keys = await cache.keys();
  const extra = keys.length - max;
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i]);
}

async function store(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
    await trimCache(cacheName);
  } catch {
    // storage full or blocked: the answer was delivered anyway
  }
}

/** age of a cached answer in ms (from its Date header), Infinity when unknown */
function ageOf(response) {
  const date = Date.parse(response.headers.get('Date') || '');
  return Number.isFinite(date) ? Date.now() - date : Infinity;
}

// --- strategies ------------------------------------------------------------------

/** the page as the network delivers it; uses the preloaded answer when there is one */
async function fromNetwork(event) {
  // navigation preload: the request already started while this worker was booting
  const preloaded = await event.preloadResponse;
  return preloaded || fetch(event.request);
}

async function networkFirstPage(event) {
  try {
    const response = await fromNetwork(event);
    // the server itself is away (restart, gateway error): better than a bare error page,
    // an installed app has no reload button
    if (response.status >= 502 && response.status <= 504) {
      const offline = await offlinePage();
      if (offline) return offline;
    }
    return response;
  } catch (err) {
    const offline = await offlinePage();
    if (offline) return offline;
    throw err;
  }
}

async function offlinePage() {
  const cache = await caches.open(CACHE_PAGES);
  // the stored answer carries "Vary" headers of the app router – they do not matter here
  return cache.match(OFFLINE_URL, { ignoreVary: true, ignoreSearch: true });
}

async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (isStorable(response)) event.waitUntil(store(cacheName, event.request, response.clone()));
  return response;
}

/**
 * Cached answer right away, refreshed in the background once it is older than
 * FRESH_MS. cache.match() respects the "Vary" header of the stored answer, so
 * formats negotiated by "Accept" (AVIF/WebP/PNG for the same URL) are never mixed
 * up: an image request and a fetch() for the export get their own entry.
 */
async function staleWhileRevalidate(event, cacheName, accept = () => true) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);

  const refresh = async () => {
    const response = await fetch(event.request);
    if (isStorable(response) && accept(response)) await store(cacheName, event.request, response.clone());
    return response;
  };

  if (!cached) return refresh();
  if (ageOf(cached) > FRESH_MS[cacheName]) event.waitUntil(refresh().catch(() => {}));
  return cached;
}

// --- offline page ----------------------------------------------------------------

/**
 * Stores the offline page together with the scripts, styles and fonts it needs
 * (read from its HTML, because their file names change with every build).
 */
async function cacheOfflinePage() {
  const response = await fetch(new Request(OFFLINE_URL, { cache: 'reload', credentials: 'same-origin' }));
  if (!response.ok || response.redirected) throw new Error(`offline page: HTTP ${response.status}`);
  const html = await response.clone().text();
  const pages = await caches.open(CACHE_PAGES);
  await pages.put(OFFLINE_URL, response);

  const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s<>()]+/g) || []);
  const statics = await caches.open(CACHE_STATIC);
  const images = await caches.open(CACHE_IMAGES);
  // a missing file must not stop the installation
  await Promise.all([
    ...[...assets].map(async (url) => {
      if (!(await statics.match(url))) await statics.add(url).catch(() => {});
    }),
    ...OFFLINE_IMAGES.map((url) => images.add(url).catch(() => {})),
  ]);
}

// --- life cycle ------------------------------------------------------------------

self.addEventListener('install', (event) => {
  // no skipWaiting() here: the page decides when a new version takes over
  event.waitUntil(cacheOfflinePage());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(PREFIX) && !CURRENT_CACHES.includes(name)).map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
      // take over open pages, so the offline page works without a second visit
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === 'page') event.respondWith(networkFirstPage(event));
  else if (strategy === 'direct') event.respondWith(fromNetwork(event));
  else if (strategy === 'static') event.respondWith(cacheFirst(event, CACHE_STATIC));
  else if (strategy === 'image') event.respondWith(staleWhileRevalidate(event, CACHE_IMAGES, isImageResponse));
  else if (strategy === 'media') event.respondWith(staleWhileRevalidate(event, CACHE_MEDIA, isImageResponse));
  // no respondWith(): the browser handles the request as if there was no worker
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') {
    // the visitor clicked "reload" in the update toast
    self.skipWaiting();
  } else if (type === 'REFRESH_OFFLINE') {
    // the language changed: store the offline page in the new language
    event.waitUntil(cacheOfflinePage().catch(() => {}));
  } else if (type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});
