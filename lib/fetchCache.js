// Client-side GET layer for the public, cacheable parts of the API:
//   - identical requests in flight share one network call
//   - answers are kept for a while (TTL), so going back to a page paints at once
//   - stale answers stay visible while a fresh one is loaded in the background
//   - polling pauses while the tab is hidden and catches up when it is shown again
//   - writes drop what they may have changed
// The cache itself is plain JavaScript (see createFetchCache); the hooks at the
// bottom connect it to React.

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { authHeaders } from './activity.js';
import { api, onApiWrite } from './api.js';

const EMPTY = Object.freeze({ data: undefined, error: null, updatedAt: 0, loading: false, stale: false });
const noop = () => {};

function matcher(match) {
  if (match === undefined || match === null) return () => true;
  if (typeof match === 'function') return match;
  if (match instanceof RegExp) return (url) => match.test(url);
  const prefix = String(match);
  return (url) => url.startsWith(prefix);
}

/**
 * A small cache for GET requests.
 *   fetcher(url)  loads the data (returns a promise)
 *   scope()       who is asking (e.g. the session); when it changes, everything
 *                 cached for the previous identity is thrown away
 *   now()         clock, replaceable in tests
 *   maxEntries    upper bound; the oldest unused entries are dropped first
 */
export function createFetchCache({ fetcher, scope = () => '', now = Date.now, maxEntries = 120 } = {}) {
  if (typeof fetcher !== 'function') throw new TypeError('createFetchCache needs a fetcher');
  const entries = new Map();
  const counters = { hits: 0, misses: 0, shared: 0, revalidations: 0 };

  let owner = scope();

  /** a new identity must never see what was loaded for the previous one */
  function syncScope() {
    const current = scope();
    if (current === owner) return;
    owner = current;
    clear();
  }

  function entryFor(url, create) {
    let e = entries.get(url);
    if (!e && create) {
      e = { url, data: undefined, has: false, error: null, updatedAt: 0, invalid: false, epoch: 0, promise: null, listeners: new Set(), snapshot: EMPTY };
      entries.set(url, e);
      prune();
    }
    return e;
  }

  function publish(e) {
    e.snapshot = { data: e.data, error: e.error, updatedAt: e.updatedAt, loading: Boolean(e.promise), stale: e.invalid };
    for (const fn of [...e.listeners]) fn(e.snapshot);
  }

  function prune() {
    if (entries.size <= maxEntries) return;
    for (const [key, e] of entries) {
      if (entries.size <= maxEntries) break;
      // entries somebody is looking at (or waiting for) stay
      if (e.listeners.size === 0 && !e.promise) entries.delete(key);
    }
  }

  const isFresh = (e, ttl) => e.has && !e.invalid && ttl > 0 && now() - e.updatedAt < ttl;

  function load(e) {
    if (e.promise) {
      counters.shared++;
      return e.promise;
    }
    const epoch = e.epoch;
    const run = Promise.resolve()
      .then(() => fetcher(e.url))
      .then(
        (data) => {
          // detached by clear(): the answer belongs to an identity that is gone
          if (e.promise !== run) return data;
          e.promise = null;
          e.data = data;
          e.has = true;
          e.error = null;
          // invalidated while the request was running: the answer may predate
          // the write, so it is shown but counts as stale
          e.invalid = e.epoch !== epoch;
          e.updatedAt = now();
          publish(e);
          return data;
        },
        (error) => {
          if (e.promise !== run) throw error;
          e.promise = null;
          e.error = error;
          publish(e);
          throw error;
        },
      );
    e.promise = run;
    publish(e);
    return run;
  }

  /**
   * Returns the data for `url`.
   *   ttl    how long (ms) an answer counts as fresh; 0 = always ask the server
   *   swr    stale-while-revalidate: hand out a stale answer at once and refresh it in the background
   *   force  skip the cache (still shares a request that is already running)
   */
  function get(url, { ttl = 0, swr = false, force = false } = {}) {
    syncScope();
    const e = entryFor(url, true);
    if (!force && isFresh(e, ttl)) {
      counters.hits++;
      return Promise.resolve(e.data);
    }
    if (!force && swr && e.has) {
      counters.revalidations++;
      load(e).catch(noop);
      return Promise.resolve(e.data);
    }
    counters.misses++;
    return load(e);
  }

  const refresh = (url) => get(url, { force: true });

  /** current state of an entry: { data, error, updatedAt, loading, stale } (same object until it changes) */
  const peek = (url) => (scope() === owner && entryFor(url, false)?.snapshot) || EMPTY;

  function subscribe(url, fn) {
    const e = entryFor(url, true);
    e.listeners.add(fn);
    return () => {
      e.listeners.delete(fn);
    };
  }

  /** Replace (or update) the cached data by hand, e.g. after an optimistic change. */
  function mutate(url, next) {
    syncScope();
    const e = entryFor(url, true);
    e.data = typeof next === 'function' ? next(e.data) : next;
    e.has = true;
    e.error = null;
    e.updatedAt = now();
    e.epoch++;
    publish(e);
    return e.data;
  }

  /**
   * Marks answers as outdated. `match` is a URL prefix, a RegExp, a function
   * or nothing (= everything). Entries that are on screen keep their data
   * (flagged stale) and reload with the next get(); all others are dropped.
   */
  function invalidate(match) {
    syncScope();
    const test = matcher(match);
    let n = 0;
    for (const [key, e] of entries) {
      if (!test(e.url)) continue;
      n++;
      e.epoch++;
      if (e.listeners.size === 0 && !e.promise) {
        entries.delete(key);
      } else if (e.has && !e.invalid) {
        e.invalid = true;
        publish(e);
      }
    }
    return n;
  }

  function clear() {
    for (const e of entries.values()) {
      e.epoch++;
      e.promise = null;
      e.data = undefined;
      e.has = false;
      e.error = null;
      e.updatedAt = 0;
      e.invalid = false;
      if (e.listeners.size) publish(e);
    }
    for (const [key, e] of entries) if (e.listeners.size === 0) entries.delete(key);
  }

  const stats = () => ({ ...counters, entries: entries.size });

  return { get, refresh, peek, subscribe, mutate, invalidate, clear, stats };
}

/**
 * Calls run() every `intervalMs`, but only while the page is visible.
 * When the page comes back (tab shown, window focused) a missed run is caught
 * up at once. A run that returns a promise is awaited before the next one is
 * planned, so slow answers never pile up. Returns stop().
 *
 * `env` is the browser by default; tests pass their own.
 */
export function createPoller({ run, intervalMs, immediate = false, env = browserEnv() }) {
  let timer = null;
  let stopped = false;
  let running = false;
  let lastRun = immediate ? -Infinity : env.now();

  const plan = (delay) => {
    if (stopped || timer !== null || env.isHidden()) return;
    timer = env.setTimeout(tick, Math.max(0, delay));
  };

  async function tick() {
    timer = null;
    if (stopped || running) return;
    if (env.isHidden()) return; // wake() plans the next run
    running = true;
    lastRun = env.now();
    try {
      await run();
    } catch {
      /* the next round tries again */
    } finally {
      running = false;
      plan(intervalMs);
    }
  }

  const wake = () => {
    if (stopped) return;
    if (env.isHidden()) {
      if (timer !== null) env.clearTimeout(timer);
      timer = null;
      return;
    }
    if (timer !== null || running) return;
    plan(intervalMs - (env.now() - lastRun));
  };

  const unlisten = env.onVisibility(wake);
  plan(immediate ? 0 : intervalMs);

  return () => {
    stopped = true;
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    unlisten();
  };
}

function browserEnv() {
  const hasDoc = typeof document !== 'undefined';
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    isHidden: () => hasDoc && document.visibilityState === 'hidden',
    onVisibility: (fn) => {
      if (!hasDoc) return noop;
      document.addEventListener('visibilitychange', fn);
      window.addEventListener('focus', fn);
      // pages restored from the back/forward cache
      window.addEventListener('pageshow', fn);
      return () => {
        document.removeEventListener('visibilitychange', fn);
        window.removeEventListener('focus', fn);
        window.removeEventListener('pageshow', fn);
      };
    },
  };
}

// --- the cache of the app -------------------------------------------------------

// answers no write of ours can change (live numbers, source list, sample media, search results)
const WRITE_PROOF = /^\/api\/(?:public|sources|showcase|studio\/search)(?:[/?]|$)/;

/** Does a write to `path` leave the cached answer for `url` untouched? */
export const survivesWrite = (url) => WRITE_PROOF.test(url);

export const fetchCache = createFetchCache({
  fetcher: (url) => api(url),
  // inside the Discord Activity the session is a header: a new session starts with an empty cache
  scope: () => authHeaders().Authorization || '',
});

// every write through api() may change lists, profiles and counters: drop them
onApiWrite(() => fetchCache.invalidate((url) => !survivesWrite(url)));

/** GET with cache: cachedGet('/api/sources', { ttl: 300000 }) */
export const cachedGet = (url, options) => fetchCache.get(url, options);
/** what the cache knows right now (may be undefined): for painting before the request returns */
export const peekCached = (url) => fetchCache.peek(url).data;
/** explicit invalidation, for writes that do not go through api() (uploads, plain fetch) */
export const invalidateCache = (match) => fetchCache.invalidate(match);
export const mutateCached = (url, next) => fetchCache.mutate(url, next);

// --- React ------------------------------------------------------------------

/**
 * Runs fn() every `intervalMs` while the tab is visible (see createPoller).
 * intervalMs = 0 switches it off. Always calls the latest fn.
 */
export function usePolling(fn, intervalMs, { immediate = false } = {}) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) return undefined;
    return createPoller({ run: () => latest.current(), intervalMs, immediate });
  }, [intervalMs, immediate]);
}

/**
 * Data of a cacheable GET.
 *   ttl        how long an answer is fresh (ms)
 *   refreshMs  reload this often while the tab is visible (0 = never)
 *   enabled    false = do not load (yet)
 * Returns { data, error, loading, stale, refresh, mutate }. A cached answer is
 * there on the first render; a stale one stays until the fresh one arrives.
 */
export function useCachedFetch(url, { ttl = 30_000, refreshMs = 0, enabled = true, cache = fetchCache } = {}) {
  const active = Boolean(url) && enabled;
  const subscribe = useCallback((fn) => (active ? cache.subscribe(url, fn) : noop), [cache, url, active]);
  const getSnapshot = useCallback(() => (active ? cache.peek(url) : EMPTY), [cache, url, active]);
  // the server (and the first paint after it) never has data: same markup on both sides
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  // nothing there and nothing on its way (first use, or the cache was emptied): load
  const missing = active && snap.data === undefined && !snap.loading && !snap.error;
  useEffect(() => {
    if (active) cache.get(url, { ttl }).catch(noop);
  }, [cache, url, ttl, active, missing]);

  // while several components poll the same URL the fastest one sets the pace:
  // an answer younger than half an interval is not asked for again
  usePolling(() => cache.get(url, { ttl: refreshMs / 2 }).catch(noop), active ? refreshMs : 0);

  const refresh = useCallback(() => (active ? cache.refresh(url) : Promise.resolve(undefined)), [cache, url, active]);
  const mutate = useCallback((next) => (active ? cache.mutate(url, next) : undefined), [cache, url, active]);

  return useMemo(
    () => ({
      data: snap.data,
      error: snap.error,
      loading: active && snap.data === undefined && !snap.error,
      stale: snap.stale,
      refresh,
      mutate,
    }),
    [snap, active, refresh, mutate],
  );
}
