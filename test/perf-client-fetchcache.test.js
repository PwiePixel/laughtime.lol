import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { setActivitySdk, setActivitySession } from '../lib/activity.js';
import { ApiError, api, onApiWrite } from '../lib/api.js';
import { cachedGet, createFetchCache, createPoller, fetchCache, peekCached, survivesWrite } from '../lib/fetchCache.js';

/** a fetcher whose answers are released by hand */
function manualFetcher() {
  const calls = [];
  const fetcher = (url) =>
    new Promise((resolve, reject) => {
      calls.push({ url, resolve, reject });
    });
  return { calls, fetcher };
}

function countingFetcher() {
  const hits = {};
  const fetcher = async (url) => {
    hits[url] = (hits[url] || 0) + 1;
    return { url, n: hits[url] };
  };
  return { hits, fetcher };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// --- the cache --------------------------------------------------------------

test('identical requests in flight share one call', async () => {
  const { calls, fetcher } = manualFetcher();
  const cache = createFetchCache({ fetcher });
  const a = cache.get('/api/x');
  const b = cache.get('/api/x');
  const other = cache.get('/api/y');
  await settle();
  assert.equal(calls.length, 2);
  calls[0].resolve({ ok: 1 });
  calls[1].resolve({ ok: 2 });
  assert.deepEqual(await Promise.all([a, b, other]), [{ ok: 1 }, { ok: 1 }, { ok: 2 }]);
  assert.equal(cache.stats().shared, 1);
});

test('answers are reused while they are fresh', async () => {
  let time = 1000;
  const { hits, fetcher } = countingFetcher();
  const cache = createFetchCache({ fetcher, now: () => time });
  assert.equal((await cache.get('/api/x', { ttl: 5000 })).n, 1);
  time += 4999;
  assert.equal((await cache.get('/api/x', { ttl: 5000 })).n, 1);
  time += 1;
  assert.equal((await cache.get('/api/x', { ttl: 5000 })).n, 2);
  // no ttl = always ask, force = ask even when fresh
  assert.equal((await cache.get('/api/x')).n, 3);
  assert.equal((await cache.get('/api/x', { ttl: 5000, force: true })).n, 4);
  assert.equal(hits['/api/x'], 4);
});

test('stale-while-revalidate answers at once and refreshes in the background', async () => {
  let time = 0;
  const { calls, fetcher } = manualFetcher();
  const cache = createFetchCache({ fetcher, now: () => time });
  const first = cache.get('/api/x', { ttl: 1000 });
  await settle();
  calls[0].resolve('old');
  assert.equal(await first, 'old');
  time = 5000;
  const seen = [];
  cache.subscribe('/api/x', (snap) => seen.push([snap.data, snap.loading]));
  assert.equal(await cache.get('/api/x', { ttl: 1000, swr: true }), 'old');
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(cache.peek('/api/x').loading, true);
  calls[1].resolve('new');
  await settle();
  assert.equal(cache.peek('/api/x').data, 'new');
  assert.deepEqual(seen, [['old', true], ['new', false]]);
});

test('a failed request rejects, keeps the old data and is not cached', async () => {
  let fail = false;
  let n = 0;
  const cache = createFetchCache({
    fetcher: async () => {
      n++;
      if (fail) throw new Error('down');
      return `v${n}`;
    },
  });
  assert.equal(await cache.get('/api/x', { ttl: 0 }), 'v1');
  fail = true;
  await assert.rejects(cache.get('/api/x'), /down/);
  const snap = cache.peek('/api/x');
  assert.equal(snap.data, 'v1');
  assert.equal(snap.error.message, 'down');
  assert.equal(snap.loading, false);
  fail = false;
  assert.equal(await cache.get('/api/x'), 'v3');
  assert.equal(cache.peek('/api/x').error, null);
});

test('peek returns the same object until something changes', async () => {
  const { fetcher } = countingFetcher();
  const cache = createFetchCache({ fetcher });
  const empty = cache.peek('/api/x');
  assert.equal(empty.data, undefined);
  assert.equal(cache.peek('/api/unknown'), empty);
  await cache.get('/api/x', { ttl: 1000 });
  const loaded = cache.peek('/api/x');
  assert.equal(cache.peek('/api/x'), loaded);
  await cache.get('/api/x', { ttl: 1000 });
  assert.equal(cache.peek('/api/x'), loaded);
});

test('invalidate drops unused entries and flags the ones on screen', async () => {
  const { hits, fetcher } = countingFetcher();
  const cache = createFetchCache({ fetcher });
  await cache.get('/api/memes?sort=top', { ttl: 60000 });
  await cache.get('/api/memes?sort=new', { ttl: 60000 });
  await cache.get('/api/sources', { ttl: 60000 });
  const stop = cache.subscribe('/api/memes?sort=top', () => {});
  assert.equal(cache.invalidate('/api/memes'), 2);
  // on screen: data stays, but it is stale and the next get() reloads it
  assert.equal(cache.peek('/api/memes?sort=top').data.n, 1);
  assert.equal(cache.peek('/api/memes?sort=top').stale, true);
  assert.equal(cache.peek('/api/memes?sort=new').data, undefined);
  assert.equal(cache.peek('/api/sources').data.n, 1);
  assert.equal((await cache.get('/api/memes?sort=top', { ttl: 60000 })).n, 2);
  assert.equal(cache.peek('/api/memes?sort=top').stale, false);
  assert.equal((await cache.get('/api/sources', { ttl: 60000 })).n, 1);
  stop();
  // RegExp, function and "everything"
  assert.equal(cache.invalidate(/sources$/), 1);
  assert.equal(cache.invalidate((url) => url.includes('sort=top')), 1);
  await cache.get('/api/a', { ttl: 1 });
  assert.equal(cache.invalidate(), 1);
  assert.equal(cache.stats().entries, 0);
  assert.equal(hits['/api/memes?sort=top'], 2);
});

test('an answer that was on its way during a write counts as stale', async () => {
  const { calls, fetcher } = manualFetcher();
  const cache = createFetchCache({ fetcher });
  const pending = cache.get('/api/memes', { ttl: 60000 });
  await settle();
  cache.invalidate('/api/memes');
  calls[0].resolve('before the write');
  assert.equal(await pending, 'before the write');
  assert.equal(cache.peek('/api/memes').stale, true);
  const again = cache.get('/api/memes', { ttl: 60000 });
  await settle();
  assert.equal(calls.length, 2);
  calls[1].resolve('after the write');
  assert.equal(await again, 'after the write');
  assert.equal(cache.peek('/api/memes').stale, false);
});

test('mutate replaces the data and tells the subscribers', async () => {
  const { fetcher } = countingFetcher();
  const cache = createFetchCache({ fetcher });
  const seen = [];
  const stop = cache.subscribe('/api/x', (snap) => seen.push(snap.data));
  cache.mutate('/api/x', { likes: 1 });
  cache.mutate('/api/x', (d) => ({ likes: d.likes + 1 }));
  stop();
  cache.mutate('/api/x', { likes: 99 });
  assert.deepEqual(seen, [{ likes: 1 }, { likes: 2 }]);
  assert.deepEqual(await cache.get('/api/x', { ttl: 1000 }), { likes: 99 });
});

test('a new identity starts with an empty cache', async () => {
  let who = '';
  const { calls, fetcher } = manualFetcher();
  const cache = createFetchCache({ fetcher, scope: () => who });
  const first = cache.get('/api/community', { ttl: 60000 });
  await settle();
  calls[0].resolve('for guests');
  await first;
  const slow = cache.get('/api/memes', { ttl: 60000 });
  await settle();
  who = 'Bearer abc';
  // nothing of the previous identity is visible any more
  assert.equal(cache.peek('/api/community').data, undefined);
  const mine = cache.get('/api/community', { ttl: 60000 });
  await settle();
  // an answer for the old identity arrives late: the caller gets it, the cache does not
  calls[1].resolve('late, for guests');
  assert.equal(await slow, 'late, for guests');
  assert.equal(cache.peek('/api/memes').data, undefined);
  calls[2].resolve('for me');
  assert.equal(await mine, 'for me');
  assert.equal(cache.peek('/api/community').data, 'for me');
});

test('the cache stays small', async () => {
  const { fetcher } = countingFetcher();
  const cache = createFetchCache({ fetcher, maxEntries: 3 });
  const stop = cache.subscribe('/api/keep', () => {});
  for (let i = 0; i < 10; i++) await cache.get(`/api/item/${i}`, { ttl: 60000 });
  assert.ok(cache.stats().entries <= 3);
  // entries with a subscriber are never thrown out
  await cache.get('/api/keep', { ttl: 60000 });
  for (let i = 10; i < 20; i++) await cache.get(`/api/item/${i}`, { ttl: 60000 });
  assert.equal(cache.peek('/api/keep').data.n, 1);
  stop();
});

test('live numbers, sources and search results survive writes, lists do not', () => {
  for (const url of ['/api/public', '/api/sources', '/api/showcase', '/api/studio/search?kind=any&q=cat']) assert.equal(survivesWrite(url), true, url);
  for (const url of ['/api/community', '/api/memes?sort=top', '/api/leaderboard?metric=points', '/api/packs?scope=mine', '/api/users/someone', '/api/publicity']) {
    assert.equal(survivesWrite(url), false, url);
  }
});

// --- polling ------------------------------------------------------------------

function fakeEnv() {
  const env = {
    time: 0,
    hidden: false,
    timers: [],
    listeners: new Set(),
    now: () => env.time,
    isHidden: () => env.hidden,
    setTimeout: (fn, ms) => {
      const timer = { fn, at: env.time + ms };
      env.timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      env.timers = env.timers.filter((x) => x !== timer);
    },
    onVisibility: (fn) => {
      env.listeners.add(fn);
      return () => env.listeners.delete(fn);
    },
    /** move the clock, running every timer that is due */
    async advance(ms) {
      const end = env.time + ms;
      for (;;) {
        const next = env.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        env.time = next.at;
        env.timers = env.timers.filter((x) => x !== next);
        next.fn();
        await settle();
      }
      env.time = end;
    },
    show(visible) {
      env.hidden = !visible;
      for (const fn of env.listeners) fn();
    },
  };
  return env;
}

test('the poller runs in its rhythm and stops for good', async () => {
  const env = fakeEnv();
  let runs = 0;
  const stop = createPoller({ run: () => runs++, intervalMs: 1000, env });
  await env.advance(999);
  assert.equal(runs, 0);
  await env.advance(1);
  assert.equal(runs, 1);
  await env.advance(3000);
  assert.equal(runs, 4);
  stop();
  await env.advance(5000);
  assert.equal(runs, 4);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.length, 0);
});

test('the poller can start right away', async () => {
  const env = fakeEnv();
  let runs = 0;
  const stop = createPoller({ run: () => runs++, intervalMs: 1000, immediate: true, env });
  await env.advance(0);
  assert.equal(runs, 1);
  stop();
});

test('the poller pauses while the tab is hidden and catches up when it is shown', async () => {
  const env = fakeEnv();
  let runs = 0;
  const stop = createPoller({ run: () => runs++, intervalMs: 1000, env });
  await env.advance(1000);
  assert.equal(runs, 1);
  env.show(false);
  assert.equal(env.timers.length, 0);
  await env.advance(60000);
  assert.equal(runs, 1);
  // back after a long time: one run at once, then the normal rhythm
  env.show(true);
  await env.advance(0);
  assert.equal(runs, 2);
  await env.advance(1000);
  assert.equal(runs, 3);
  // a short look away does not trigger an extra run
  env.show(false);
  await env.advance(300);
  env.show(true);
  await env.advance(0);
  assert.equal(runs, 3);
  await env.advance(700);
  assert.equal(runs, 4);
  // focus events while visible change nothing
  env.show(true);
  env.show(true);
  assert.equal(env.timers.length, 1);
  stop();
});

test('a slow answer never overlaps with the next run, a failing one does not stop the poller', async () => {
  const env = fakeEnv();
  let active = 0;
  let most = 0;
  let runs = 0;
  let release;
  const stop = createPoller({
    intervalMs: 1000,
    env,
    run: () => {
      runs++;
      active++;
      most = Math.max(most, active);
      if (runs === 2) {
        active--;
        throw new Error('boom');
      }
      return new Promise((resolve) => {
        release = () => {
          active--;
          resolve();
        };
      });
    },
  });
  await env.advance(1000);
  assert.equal(runs, 1);
  await env.advance(5000);
  assert.equal(runs, 1, 'waits for the answer');
  release();
  await settle();
  await env.advance(1000);
  assert.equal(runs, 2);
  await env.advance(1000);
  assert.equal(runs, 3, 'keeps going after an error');
  assert.equal(most, 1);
  stop();
});

// --- api(): the real requests ----------------------------------------------------

let requests;
let respond;
const realFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  respond = () => ({ status: 200, body: { ok: true } });
  globalThis.fetch = async (url, init) => {
    requests.push({ url, ...init });
    await settle();
    const { status, body } = respond(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setActivitySdk(null, null, null);
  setActivitySession(null);
  fetchCache.clear();
});

test('api: identical GETs in flight share one request', async () => {
  const [a, b] = await Promise.all([api('/api/sources'), api('/api/sources')]);
  assert.equal(requests.length, 1);
  assert.equal(a, b);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].credentials, 'same-origin');
  // once it is answered, the next call asks again (api() itself never caches)
  await api('/api/sources');
  assert.equal(requests.length, 2);
  await Promise.all([api('/api/a'), api('/api/b')]);
  assert.equal(requests.length, 4);
});

test('api: writes are never shared or cached', async () => {
  await Promise.all([
    api('/api/memes/abc/like', { method: 'POST', body: {} }),
    api('/api/memes/abc/like', { method: 'POST', body: {} }),
    api('/api/memes/abc', { method: 'DELETE' }),
    api('/api/memes/abc', { method: 'DELETE' }),
  ]);
  assert.equal(requests.length, 4);
  assert.equal(requests[0].body, '{}');
  assert.equal(requests[0].headers['Content-Type'], 'application/json');
  assert.equal(requests[2].body, undefined);
});

test('api: a GET from before a write is not handed to callers after it', async () => {
  const before = api('/api/me');
  await api('/api/auth/login', { method: 'POST', body: { name: 'x' } });
  const after = api('/api/me');
  await Promise.all([before, after]);
  assert.equal(requests.filter((r) => r.url === '/api/me').length, 2);
});

test('api: errors carry the code of the server', async () => {
  respond = () => ({ status: 404, body: { error: 'user_not_found' } });
  await assert.rejects(api('/api/users/nobody'), (err) => err instanceof ApiError && err.code === 'user_not_found' && err.status === 404);
  globalThis.fetch = async () => {
    throw new TypeError('offline');
  };
  await assert.rejects(api('/api/users/nobody'), (err) => err instanceof ApiError && err.code === 'network' && err.status === 0);
});

test('api: inside the Discord Activity the session travels as a bearer token', async () => {
  await api('/api/me');
  assert.equal(requests[0].headers.Authorization, undefined);
  setActivitySdk({}, 'discord-token', 'client-id');
  setActivitySession('session-1');
  await api('/api/me');
  await api('/api/me', { method: 'PATCH', body: { avatar: 'cat|1' } });
  assert.equal(requests[1].headers.Authorization, 'Bearer session-1');
  assert.equal(requests[2].headers.Authorization, 'Bearer session-1');
  // two identities never share a request
  const guest = api('/api/community');
  setActivitySession('session-2');
  const other = api('/api/community');
  await Promise.all([guest, other]);
  assert.equal(requests.filter((r) => r.url === '/api/community').length, 2);
});

test('writes through api() drop the cached lists, but not the write-proof answers', async () => {
  const seen = [];
  const off = onApiWrite((path, method) => seen.push(`${method} ${path}`));
  await cachedGet('/api/community', { ttl: 60000 });
  await cachedGet('/api/sources', { ttl: 60000 });
  await cachedGet('/api/community', { ttl: 60000 });
  assert.equal(requests.length, 2);
  await api('/api/memes/abc/like', { method: 'POST', body: {} });
  off();
  assert.deepEqual(seen, ['POST /api/memes/abc/like']);
  assert.equal(peekCached('/api/community'), undefined);
  assert.deepEqual(peekCached('/api/sources'), { ok: true });
  await cachedGet('/api/community', { ttl: 60000 });
  await cachedGet('/api/sources', { ttl: 60000 });
  assert.equal(requests.filter((r) => r.url === '/api/community').length, 2);
  assert.equal(requests.filter((r) => r.url === '/api/sources').length, 1);
});

test('the app cache forgets everything when the session changes', async () => {
  await cachedGet('/api/community', { ttl: 60000 });
  setActivitySdk({}, 'discord-token', 'client-id');
  setActivitySession('session-1');
  assert.equal(peekCached('/api/community'), undefined);
  await cachedGet('/api/community', { ttl: 60000 });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers.Authorization, 'Bearer session-1');
});
