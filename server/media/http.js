import { getConfig } from '../config.js';
import { outboundFetch, setHostBudget } from '../lib/outbound.js';

// Every request of the media layer (APIs, template pages and the files the
// proxy downloads) goes through the outbound queue: one queue per host,
// automatic pause after HTTP 429, retries with back-off and an hourly budget
// for the APIs with a key. Nothing in server/media/ calls fetch() directly.

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 laughtime.lol';

const hostOfBase = (base, fallback) => {
  try {
    return new URL(base || fallback).host;
  } catch {
    return new URL(fallback).host;
  }
};

let budgetsSet = false;
/** hourly limits from the settings – applied once, before the first request */
export function applyBudgets() {
  if (budgetsSet) return;
  budgetsSet = true;
  const cfg = getConfig();
  // two APIs behind the same host (an own gateway) share the smaller limit
  const limits = new Map();
  const add = (host, limit) => {
    if (limit > 0) limits.set(host, Math.min(limits.get(host) ?? Infinity, limit));
  };
  add(hostOfBase(cfg.giphyApiBase, 'https://api.giphy.com'), cfg.giphyHourlyLimit);
  add(hostOfBase(cfg.klipyApiBase, 'https://api.klipy.com'), cfg.klipyHourlyLimit);
  add('imgflip.com', cfg.imgflipHourlyLimit);
  for (const [host, limit] of limits) setHostBudget(host, limit);
}

/**
 * fetch() for the media layer. Besides the usual fetch options:
 *   timeout     ms for one attempt
 *   retries, maxWaitMs, maxQueueMs, deadlineMs, priority  -> see outboundFetch()
 */
export async function fetchWithTimeout(url, { timeout = 12000, headers = {}, ...opts } = {}) {
  applyBudgets();
  return outboundFetch(url, {
    timeout,
    ...opts,
    headers: { 'User-Agent': BROWSER_UA, Accept: '*/*', ...headers },
    redirect: 'follow',
  });
}

/** error for an answer that is not 2xx – never contains the query string (API keys live there) */
function httpError(res, url) {
  return Object.assign(new Error(`HTTP ${res.status} for ${new URL(url).host}`), { status: res.status });
}

export async function getJson(url, opts) {
  const res = await fetchWithTimeout(url, { ...opts, headers: { Accept: 'application/json', ...(opts?.headers || {}) } });
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw httpError(res, url);
  }
  return res.json();
}

export async function getText(url, opts) {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw httpError(res, url);
  }
  return res.text();
}

export function decodeHtml(s = '') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const pickSome = (arr, n) => shuffle(arr).slice(0, n);

/** only for tests */
export const _test = {
  resetBudgets() {
    budgetsSet = false;
  },
};
