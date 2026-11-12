// Outbound request protection – every call to an external API (Discord, GIPHY,
// KLIPY, Reddit, Imgflip …) should go through this file, so we never run into
// their rate limits:
//
//   createTtlCache()   in-memory cache with expiry, size limit and "stale while revalidate"
//   dedupe()           identical requests that are already running share one promise
//   outboundFetch()    fetch with a queue per host, automatic back-off on HTTP 429
//                      (Retry-After / X-RateLimit-* headers) and retries for GETs
//   cachedJson()       GET + JSON through all of the above
//
// No dependencies, plain Node.

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
    async wrap(key, loader, { ttlMs: ttl = ttlMs, staleMs = 0 } = {}) {
      const fresh = cache.get(key);
      if (fresh !== undefined) return fresh;
      const stale = staleMs ? cache.peek(key) : undefined;
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
    };
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

/** Runs `task` as soon as the host's queue allows it. */
function schedule(host, task) {
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
    }, MAX_WAIT_MS);
    job.expiry.unref?.();
    state.queue.push(job);
    pump(state);
  });
}

function pauseHost(state, ms) {
  const until = now() + Math.min(Math.max(ms, 0), 120_000);
  if (until > state.pausedUntil) state.pausedUntil = until;
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
 */
export async function outboundFetch(url, { timeout = 12_000, retries = 2, maxWaitMs = 8_000, ...init } = {}) {
  const target = new URL(String(url));
  const state = hostState(target.host.toLowerCase());
  const method = String(init.method || 'GET').toUpperCase();
  const idempotent = method === 'GET' || method === 'HEAD';

  for (let attempt = 0; ; attempt++) {
    let res;
    let failure;
    try {
      res = await schedule(state.host, () => {
        state.requests += 1;
        return fetch(target, { redirect: 'follow', ...init, signal: AbortSignal.timeout(timeout) });
      });
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
        const wait = retryAfterMs(res.headers) ?? 1000 * 2 ** attempt;
        pauseHost(state, wait);
        if (attempt < retries && wait <= maxWaitMs) {
          state.retries += 1;
          res.body?.cancel().catch(() => {});
          continue;
        }
        return res;
      }
      if (res.status >= 500 && idempotent && attempt < retries) {
        state.retries += 1;
        res.body?.cancel().catch(() => {});
        await sleep(300 * 2 ** attempt + Math.floor(Math.random() * 200));
        continue;
      }
      return res;
    }

    const queueProblem = failure?.code === 'queue_full' || failure?.code === 'queue_timeout';
    if (!queueProblem && idempotent && attempt < retries) {
      state.retries += 1;
      await sleep(300 * 2 ** attempt + Math.floor(Math.random() * 200));
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
    };
  }
  return out;
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
}
