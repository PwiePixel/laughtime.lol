// Helpers of the installable web app (plain ESM without browser globals, so they
// can be unit-tested: test/pwa-helpers.test.js). The browser side lives in
// components/v2/PwaBoot.jsx and components/pwa/*, the worker in public/sw.js.

export const SW_URL = '/sw.js';
export const SW_SCOPE = '/';
/** what this device remembers about the install offer (localStorage, JSON) */
export const PWA_STATE_KEY = 'lt_pwa';
/** localStorage '1' = register the worker on localhost too (for testing a production build) */
export const PWA_DEBUG_KEY = 'lt_pwa_debug';

/** page views before the install offer may appear (a played game counts right away) */
export const MIN_VIEWS = 3;
/** how long a dismissed offer stays away … */
export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
/** … and after this many dismissals it never comes back */
export const MAX_DISMISSALS = 3;

/** /play (matchmaking) and /room[/CODE]: a game is running or about to start */
export function isGameRoute(pathname = '') {
  return /^\/(room|play)(\/|$)/.test(String(pathname));
}

/** pages where an install offer would only be in the way */
export function isQuietRoute(pathname = '') {
  return isGameRoute(pathname) || /^\/(install|offline|admin|activity|legal)(\/|$)/.test(String(pathname));
}

export function isLocalHost(hostname = '') {
  const h = String(hostname).toLowerCase();
  return h === 'localhost' || h === '[::1]' || h.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(h);
}

/**
 * True while LaughTime runs as a Discord Activity: Discord shows the page in an
 * iframe on <app id>.discordsays.com and opens it with ?frame_id=…
 */
export function isEmbedded({ hostname = '', search = '', framed = false } = {}) {
  if (framed) return true;
  if (/(^|\.)discordsays\.com$/i.test(String(hostname))) return true;
  try {
    return new URLSearchParams(search).has('frame_id');
  } catch {
    return false;
  }
}

/**
 * May this page register the service worker?
 * Only production builds on a secure origin, never inside the Discord Activity
 * and never on localhost – unless the debug flag is set.
 */
export function shouldRegisterWorker({
  production = false,
  supported = false,
  secure = false,
  hostname = '',
  search = '',
  framed = false,
  debug = false,
} = {}) {
  if (!production || !supported || !secure) return false;
  if (isEmbedded({ hostname, search, framed })) return false;
  if (isLocalHost(hostname) && !debug) return false;
  return true;
}

/**
 * Rough platform detection for the install instructions (never for features).
 * Returns { os: 'ios' | 'android' | 'desktop', browser, inApp }.
 */
export function detectPlatform({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent);
  // iPadOS pretends to be a Mac, but a Mac has no touch screen
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform || ua) && maxTouchPoints > 1);
  const android = !ios && /Android/i.test(ua);
  // in-app browsers (Instagram, TikTok, …) cannot install anything
  const inApp = /FBAN|FBAV|Instagram|Line\/|TikTok|musical_ly|Snapchat|Twitter|Discord|; wv\)/i.test(ua);
  let browser = 'other';
  if (/EdgiOS|EdgA|Edg\//.test(ua)) browser = 'edge';
  else if (/SamsungBrowser/.test(ua)) browser = 'samsung';
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'firefox';
  else if (/OPiOS|OPR\/|OPT\//.test(ua)) browser = 'opera';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'chrome';
  else if (/Safari\//.test(ua)) browser = 'safari';
  return { os: ios ? 'ios' : android ? 'android' : 'desktop', browser, inApp };
}

/**
 * How this visitor can install the app:
 *   'prompt'    the browser handed us an install prompt (Chrome, Edge, Samsung …)
 *   'ios'       iOS: Share -> "Add to Home Screen" (there is no prompt on iOS)
 *   'manual'    look it up in the browser menu
 *   'none'      installed already, or an in-app browser that cannot install
 */
export function installMethod({ platform, hasPrompt = false, standalone = false } = {}) {
  if (standalone) return 'none';
  if (hasPrompt) return 'prompt';
  if (!platform || platform.inApp) return 'none';
  if (platform.os === 'ios') return 'ios';
  return 'manual';
}

const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** the remembered state, robust against anything that may sit in localStorage */
export function parsePwaState(raw) {
  let data = null;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') data = {};
  return {
    views: count(data.views),
    played: data.played === true,
    dismissals: count(data.dismissals),
    dismissedAt: count(data.dismissedAt),
    installed: data.installed === true,
  };
}

/** a page was opened: counts towards "has engaged a little" */
export function recordView(state, pathname = '') {
  const s = parsePwaState(state);
  // the counter only has to reach the threshold – no need to count visits forever
  return { ...s, views: Math.min(s.views + 1, 99), played: s.played || isGameRoute(pathname) };
}

export function recordDismissal(state, now = Date.now()) {
  const s = parsePwaState(state);
  return { ...s, dismissals: s.dismissals + 1, dismissedAt: now };
}

export function hasEngaged(state) {
  const s = parsePwaState(state);
  return s.played || s.views >= MIN_VIEWS;
}

export function isSnoozed(state, now = Date.now()) {
  const s = parsePwaState(state);
  if (s.dismissals >= MAX_DISMISSALS) return true;
  return s.dismissals > 0 && now - s.dismissedAt < SNOOZE_MS;
}

/**
 * Show the install banner now?
 *   method     result of installMethod()
 *   state      remembered state (parsePwaState)
 *   pathname   current page (never during a game)
 */
export function shouldOfferInstall({ method = 'none', state, pathname = '', now = Date.now() } = {}) {
  if (method !== 'prompt' && method !== 'ios') return false;
  if (isQuietRoute(pathname)) return false;
  const s = parsePwaState(state);
  // iOS has no "appinstalled" event; elsewhere a prompt only exists while the app is not installed
  if (s.installed && method !== 'prompt') return false;
  return hasEngaged(s) && !isSnoozed(s, now);
}

/**
 * Where "try again" on the offline page leads: back to the page the visitor
 * wanted, as long as that is a path on this site (no open redirect).
 */
export function retryTarget(href = '', origin = '') {
  try {
    const url = new URL(href, origin || undefined);
    if (origin && url.origin !== origin) return '/';
    if (/^\/offline(\/|$)/.test(url.pathname)) {
      const from = url.searchParams.get('from') || '/';
      return /^\/(?![/\\])/.test(from) ? from : '/';
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}
