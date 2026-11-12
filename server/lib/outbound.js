// Outbound request protection – every call to an external API (Discord, GIPHY,
// KLIPY, Reddit, Imgflip …) should go through this file, so we never run into
// their rate limits:
//
//   createTtlCache()   in-memory cache with expiry, size limit and "stale while revalidate"
//   dedupe()           identical requests that are already running share one promise
//   outboundFetch()    fetch with a queue per host, automatic back-off on HTTP 429
//                      (Retry-After / X-RateLimit-* headers) and retries for GETs
//   cachedJson()       GET + JSON through all of the above
//   setHostBudget()    hard upper limit of calls per hour for one host (free API keys)
//   createBackoff()    exponential pause after failures (media sources, search providers)
//   persistOutbound()  budgets and rate-limit pauses survive a restart
//
// No dependencies, plain Node.

import fsp from 'node:fs/promises';
import path from 'node:path';

const now = () => Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- cache ---------------------------------------------------------------------

/**
 * Small LRU cache with a time to live.
 *   cache.wrap(key, loader, { ttlMs, staleMs })
 * returns the cached value, loads it once when it is missing (parallel callers
 * share the same load) and – with staleMs – keeps serving the old value while a
 * fresh one is loaded in the background or when the loader fails.
 */
export function createTtlCache({ ttlMs = 60_000, max = 500 } = {}) {
  const entries = new Map(); // key -> { value, expires, staleUntil }
  const loading = new Map(); // key -> promise
  const counts = { hits: 0, misses: 0, stale: 0 };

  const touch = (key, entry) => {
    entries.delete(key);
    entries.set(key, entry);
  };

  const cache = {
    get size() {
      return entries.size;
    },
    /** fresh value or undefined */
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) {
        if (entry.staleUntil <= now()) entries.delete(key);
        return undefined;
      }
      touch(key, entry);
      return entry.value;
    },
    /** value even when it is past its ttl (but inside the stale window) */
    peek(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.staleUntil <= now() && entry.expires <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, { ttlMs: ttl = ttlMs, staleMs = 0 } = {}) {
      const expires = now() + ttl;
      touch(key, { value, expires, staleUntil: expires + staleMs });
      while (entries.size > max) entries.delete(entries.keys().next().value);
      return value;
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    /** numbers for /api/status */
    stats() {
      return { size: entries.size, max, ...counts };
    },
    async wrap(key, loader, { ttlMs: ttl = ttlMs, staleMs = 0 } = {}) {
      const fresh = cache.get(key);
      if (fresh !== undefined) {
        counts.hits += 1;
        return fresh;
      }
      const stale = staleMs ? cache.peek(key) : undefined;
      if (stale !== undefined) counts.stale += 1;
      else counts.misses += 1;
      let job = loading.get(key);
      if (!job) {
        job = Promise.resolve()
          .then(loader)
          .then((value) => {
            if (value !== undefined) cache.set(key, value, { ttlMs: ttl, staleMs });
            return value;
          })
          .finally(() => loading.delete(key));
        loading.set(key, job);
      }
      if (stale !== undefined) {
        // answer right away, refresh in the background
        job.catch(() => {});
        return stale;
      }
      return job;
    },
  };
  return cache;
}

// --- request de-duplication ---------------------------------------------------------

const running = new Map();

/** Calls that use the same key while one is still running get the same promise. */
export function dedupe(key, fn) {
  const hit = running.get(key);
  if (hit) return hit;
  const job = Promise.resolve()
    .then(fn)
    .finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

// --- per-host queue ---------------------------------------------------------------

// how hard we may hit a host: parallel requests and the minimum gap between two starts
const HOST_RULES = [
  // file servers of the media sources: no API limits, only keep the parallelism sane
  { test: /^(media\d*|i)\.giphy\.com$/, concurrency: 6, minGapMs: 0 },
  { test: /^i\.imgflip\.com$/, concurrency: 6, minGapMs: 0 },
  { test: /^(?!api\.)[a-z0-9-]+\.klipy\.com$/, concurrency: 6, minGapMs: 0 },
  { test: /(^|\.)discord(app)?\.com$/, concurrency: 4, minGapMs: 40 },
  { test: /(^|\.)giphy\.com$/, concurrency: 2, minGapMs: 120 },
  { test: /(^|\.)klipy\.com$/, concurrency: 2, minGapMs: 250 },
  { test: /(^|\.)reddit\.com$/, concurrency: 1, minGapMs: 1100 },
  { test: /(^|\.)redd\.it$/, concurrency: 4, minGapMs: 0 },
  { test: /(^|\.)imgflip\.com$/, concurrency: 4, minGapMs: 60 },
];
const DEFAULT_RULE = { concurrency: 6, minGapMs: 0 };
const MAX_QUEUE = 400;
const MAX_WAIT_MS = 30_000;
const HOUR_MS = 60 * 60 * 1000;
// longest pause we accept: when the API names a time itself / when we have to guess
const MAX_PAUSE_MS = 15 * 60_000;
const MAX_GUESSED_PAUSE_MS = 120_000;

const hosts = new Map(); // host -> state

function hostState(host) {
  let state = hosts.get(host);
  if (!state) {
    const rule = HOST_RULES.find((r) => r.test.test(host)) || DEFAULT_RULE;
    state = {
      host,
      concurrency: rule.concurrency,
      minGapMs: rule.minGapMs,
      active: 0,
      queue: [],
      lastStart: 0,
      pausedUntil: 0,
      timer: null,
      requests: 0,
      limited: 0,
      retries: 0,
      failures: 0,
      // 429 answers in a row (makes the pause grow) and the optional hourly budget
      strikes: 0,
      perHour: 0,
      reserve: 0,
      stamps: [],
      budgetDenied: 0,
    };
    const saved = restored.get(host);
    if (saved) {
      restored.delete(host);
      state.stamps = saved.stamps;
      state.pausedUntil = saved.pausedUntil;
    }
    hosts.set(host, state);
  }
  return state;
}

function pump(state) {
  if (state.timer) return;
  while (state.queue.length && state.active < state.concurrency) {
    const wait = Math.max(state.pausedUntil - now(), state.lastStart + state.minGapMs - now());
    if (wait > 0) {
      state.timer = setTimeout(() => {
        state.timer = null;
        pump(state);
      }, wait);
      state.timer.unref?.();
      return;
    }
    const job = state.queue.shift();
    if (job.cancelled) continue;
    clearTimeout(job.expiry);
    state.active += 1;
    state.lastStart = now();
    job.run().finally(() => {
      state.active -= 1;
      pump(state);
    });
  }
}

/** Runs `task` as soon as the host's queue allows it (or fails after maxWaitMs in the queue). */
function schedule(host, task, maxWaitMs = MAX_WAIT_MS) {
  const state = hostState(host);
  return new Promise((resolve, reject) => {
    if (state.queue.length >= MAX_QUEUE) {
      reject(Object.assign(new Error(`outbound queue for ${host} is full`), { code: 'queue_full' }));
      return;
    }
    const job = {
      cancelled: false,
      expiry: null,
      run: () => Promise.resolve().then(task).then(resolve, reject),
    };
    job.expiry = setTimeout(() => {
      job.cancelled = true;
      reject(Object.assign(new Error(`outbound queue for ${host} timed out`), { code: 'queue_timeout' }));
    }, Math.max(0, Math.min(maxWaitMs, MAX_WAIT_MS)));
    job.expiry.unref?.();
    state.queue.push(job);
    pump(state);
  });
}

function pauseHost(state, ms, cap = MAX_GUESSED_PAUSE_MS) {
  const until = now() + Math.min(Math.max(ms, 0), cap);
  if (until > state.pausedUntil) {
    state.pausedUntil = until;
    markDirty();
  }
}

// --- hourly budget -----------------------------------------------------------------

const hostOf = (urlOrHost) => {
  const raw = String(urlOrHost);
  try {
    return (raw.includes('://') ? new URL(raw).host : raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
};

/**
 * Hard upper limit of requests per hour for one host (0 = no limit). Free API
 * keys allow about 100 calls per hour – with a budget below that the API can
 * never answer with "rate limit exceeded", no matter how many players search.
 * `reserve` is the share only normal-priority callers may use (the media pool),
 * so a wave of searches cannot starve the regular refresh.
 */
export function setHostBudget(urlOrHost, perHour, { reserve = 0.2 } = {}) {
  const state = hostState(hostOf(urlOrHost));
  state.perHour = Math.max(0, Math.floor(Number(perHour) || 0));
  state.reserve = Math.min(0.9, Math.max(0, reserve));
  if (!state.perHour) state.stamps = [];
  return state.perHour;
}

function budgetUsed(state) {
  const cutoff = now() - HOUR_MS;
  while (state.stamps.length && state.stamps[0] <= cutoff) state.stamps.shift();
  return state.stamps.length;
}

const budgetCap = (state, priority) => (priority === 'low' ? Math.floor(state.perHour * (1 - state.reserve)) : state.perHour);

function takeBudget(state, priority) {
  if (!state.perHour) return true;
  if (budgetUsed(state) >= budgetCap(state, priority)) {
    state.budgetDenied += 1;
    return false;
  }
  state.stamps.push(now());
  markDirty();
  return true;
}

/** milliseconds the host is still paused after a rate limit (0 = free) */
export function hostPausedMs(urlOrHost) {
  const state = hosts.get(hostOf(urlOrHost));
  return state ? Math.max(0, state.pausedUntil - now()) : 0;
}

/** calls that are left in this hour for the host (Infinity without a budget) */
export function hostBudgetLeft(urlOrHost, priority = 'normal') {
  const state = hosts.get(hostOf(urlOrHost));
  if (!state?.perHour) return Infinity;
  return Math.max(0, budgetCap(state, priority) - budgetUsed(state));
}

/** seconds (or a date) from Retry-After / X-RateLimit-Reset-After -> milliseconds */
export function retryAfterMs(headers) {
  const raw = headers.get('retry-after') ?? headers.get('x-ratelimit-reset-after');
  if (raw === null || raw === undefined || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now()) : null;
}

/**
 * fetch() for external APIs.
 *   timeout   ms for one attempt (default 12 s)
 *   retries   extra attempts after 429 / 5xx / network errors (default 2;
 *             requests that are not GET/HEAD are only repeated after a 429,
 *             because then the server has not processed them)
 *   maxWaitMs longest pause we accept for one 429 before giving up (default 8 s)
 *   maxQueueMs  longest time the request may wait for its turn (default 30 s); a host
 *               that is paused for longer fails at once with code 'host_paused'
 *   deadlineMs  upper limit for everything together (queue, attempts, pauses)
 *   priority    'low' leaves the reserved part of an hourly budget untouched
 * Errors carry a code: 'budget_exhausted', 'host_paused', 'queue_full', 'queue_timeout'.
 */
export async function outboundFetch(
  url,
  { timeout = 12_000, retries = 2, maxWaitMs = 8_000, maxQueueMs = MAX_WAIT_MS, deadlineMs = Infinity, priority = 'normal', ...init } = {},
) {
  const target = new URL(String(url));
  const state = hostState(target.host.toLowerCase());
  const method = String(init.method || 'GET').toUpperCase();
  const idempotent = method === 'GET' || method === 'HEAD';
  const started = now();
  const left = () => deadlineMs - (now() - started);

  for (let attempt = 0; ; attempt++) {
    let res;
    let failure;
    try {
      const queueMs = Math.min(maxQueueMs, left());
      if (state.pausedUntil - now() > queueMs) {
        throw Object.assign(new Error(`${state.host} is paused after a rate limit`), { code: 'host_paused' });
      }
      if (!takeBudget(state, priority)) {
        throw Object.assign(new Error(`hourly request budget for ${state.host} is used up`), { code: 'budget_exhausted' });
      }
      res = await schedule(
        state.host,
        () => {
          state.requests += 1;
          return fetch(target, { redirect: 'follow', ...init, signal: AbortSignal.timeout(Math.max(1, Math.min(timeout, left()))) });
        },
        queueMs,
      );
    } catch (err) {
      failure = err;
    }

    if (res) {
      // the API tells us its budget is used up: wait before the next request starts
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining !== null && Number(remaining) <= 0 && res.status !== 429) {
        const wait = retryAfterMs(res.headers);
        if (wait) pauseHost(state, wait);
      }
      if (res.status === 429) {
        state.limited += 1;
        state.strikes += 1;
        // the API names the pause itself – otherwise it doubles with every 429 in a row
        const named = retryAfterMs(res.headers);
        const wait = named ?? 1000 * 2 ** Math.max(attempt, state.strikes - 1);
        pauseHost(state, wait, named === null ? MAX_GUESSED_PAUSE_MS : MAX_PAUSE_MS);
        if (attempt < retries && wait <= maxWaitMs && wait < left()) {
          state.retries += 1;
          res.body?.cancel().catch(() => {});
          continue;
        }
        return res;
      }
      state.strikes = 0;
      const pause = 300 * 2 ** attempt + Math.floor(Math.random() * 200);
      if (res.status >= 500 && idempotent && attempt < retries && pause < left()) {
        state.retries += 1;
        res.body?.cancel().catch(() => {});
        await sleep(pause);
        continue;
      }
      return res;
    }

    const local = ['queue_full', 'queue_timeout', 'host_paused', 'budget_exhausted'].includes(failure?.code);
    const pause = 300 * 2 ** attempt + Math.floor(Math.random() * 200);
    if (!local && idempotent && attempt < retries && pause < left()) {
      state.retries += 1;
      await sleep(pause);
      continue;
    }
    state.failures += 1;
    throw failure;
  }
}

const jsonCache = createTtlCache({ ttlMs: 60_000, max: 1000 });

/**
 * GET a JSON document: cached for ttlMs, identical requests in flight are shared.
 * With staleMs the old answer is kept as a fallback while a new one is loaded.
 */
export function cachedJson(url, { ttlMs = 60_000, staleMs = 0, key = String(url), headers, ...opts } = {}) {
  return jsonCache.wrap(
    key,
    async () => {
      const res = await outboundFetch(url, { ...opts, headers: { Accept: 'application/json', ...headers } });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${new URL(String(url)).host}`), { status: res.status });
      return res.json();
    },
    { ttlMs, staleMs },
  );
}

/** numbers for /api/status and the admin dashboard */
export function outboundStats() {
  const out = {};
  for (const s of hosts.values()) {
    out[s.host] = {
      requests: s.requests,
      rateLimited: s.limited,
      retries: s.retries,
      failures: s.failures,
      queued: s.queue.length,
      active: s.active,
      pausedMs: Math.max(0, s.pausedUntil - now()),
      ...(s.perHour ? { budget: { perHour: s.perHour, used: budgetUsed(s), denied: s.budgetDenied } } : {}),
    };
  }
  return out;
}

// --- back-off ----------------------------------------------------------------------

/** pause after the n-th failure in a row: base, 2x base, 4x base … up to maxMs (± jitter) */
export function backoffDelay(failures, { baseMs = 30_000, maxMs = 15 * 60_000, factor = 2, jitter = 0 } = {}) {
  const raw = Math.min(maxMs, baseMs * factor ** Math.max(0, failures - 1));
  return Math.round(raw * (1 + (Math.random() * 2 - 1) * jitter));
}

/**
 * Circuit breaker for something that can fail (a search provider, a media source):
 *   if (!b.ready()) skip it;  on error b.fail();  on success b.succeed()
 */
export function createBackoff(options = {}) {
  let failures = 0;
  let until = 0;
  return {
    get failures() {
      return failures;
    },
    ready: () => now() >= until,
    waitMs: () => Math.max(0, until - now()),
    /** minMs: pause at least this long (e.g. the Retry-After of the API) */
    fail(minMs = 0) {
      failures += 1;
      const delay = Math.max(backoffDelay(failures, options), minMs);
      until = now() + delay;
      return delay;
    },
    succeed() {
      failures = 0;
      until = 0;
    },
  };
}

// --- persistence -------------------------------------------------------------------

// Hourly budgets and rate-limit pauses are written to a small file, so a server
// that restarts (or crashes in a loop) does not forget what it already used up.
const restored = new Map(); // host -> { stamps, pausedUntil }, applied when the host is first used
let stateFile = null;
let saveTimer = null;

function markDirty() {
  if (!stateFile || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveOutboundState().catch((err) => console.warn('[outbound] could not save state:', err.message));
  }, 2000);
  saveTimer.unref?.();
}

export async function saveOutboundState() {
  if (!stateFile) return;
  const data = { v: 1, savedAt: now(), hosts: {} };
  for (const s of hosts.values()) {
    const used = s.perHour ? budgetUsed(s) : 0;
    if (used || s.pausedUntil > now()) data.hosts[s.host] = { stamps: used ? s.stamps : [], pausedUntil: s.pausedUntil };
  }
  const tmp = `${stateFile}.${process.pid}.tmp`;
  await fsp.mkdir(path.dirname(stateFile), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, stateFile);
}

/** Load the saved state (if any) and keep `file` up to date from now on. */
export async function persistOutbound(file) {
  stateFile = file;
  let data;
  try {
    data = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return false; // first start or unreadable file: begin with empty counters
  }
  if (data?.v !== 1 || !data.hosts || typeof data.hosts !== 'object') return false;
  const t = now();
  for (const [host, saved] of Object.entries(data.hosts)) {
    const stamps = (Array.isArray(saved?.stamps) ? saved.stamps : [])
      .filter((x) => Number.isFinite(x) && x > t - HOUR_MS && x <= t)
      .sort((a, b) => a - b);
    const paused = Number(saved?.pausedUntil) || 0;
    const entry = { stamps, pausedUntil: paused > t && paused <= t + MAX_PAUSE_MS ? paused : 0 };
    const live = hosts.get(host);
    if (live) {
      live.stamps = [...entry.stamps, ...live.stamps].sort((a, b) => a - b);
      if (entry.pausedUntil > live.pausedUntil) live.pausedUntil = entry.pausedUntil;
    } else if (entry.stamps.length || entry.pausedUntil) {
      restored.set(host, entry);
    }
  }
  return true;
}

/** only for tests */
export function resetOutbound() {
  for (const s of hosts.values()) {
    if (s.timer) clearTimeout(s.timer);
    for (const job of s.queue) clearTimeout(job.expiry);
  }
  hosts.clear();
  running.clear();
  jsonCache.clear();
  restored.clear();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  stateFile = null;
}

/** numbers of the shared JSON cache behind cachedJson() */
export const jsonCacheStats = () => jsonCache.stats();
