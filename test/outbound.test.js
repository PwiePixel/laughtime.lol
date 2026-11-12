import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { cachedJson, createTtlCache, dedupe, outboundFetch, outboundStats, resetOutbound, retryAfterMs } from '../server/lib/outbound.js';

let server;
let base;
let hits = {};
let handlers = {};

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    hits[path] = (hits[path] || 0) + 1;
    const handler = handlers[path];
    if (handler) return handler(req, res, hits[path]);
    res.writeHead(404);
    return res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  hits = {};
  handlers = {};
  resetOutbound();
});

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

test('ttl cache: expiry, size limit and shared loads', async () => {
  const cache = createTtlCache({ ttlMs: 30, max: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), undefined, 'oldest entry is dropped');
  assert.equal(cache.get('c'), 3);
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(cache.get('c'), undefined, 'entries expire');

  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((r) => setTimeout(r, 10));
    return 'value';
  };
  const results = await Promise.all([cache.wrap('k', loader), cache.wrap('k', loader), cache.wrap('k', loader)]);
  assert.deepEqual(results, ['value', 'value', 'value']);
  assert.equal(loads, 1, 'parallel callers share one load');
});

test('ttl cache: stale value is served while the refresh fails', async () => {
  const cache = createTtlCache({ ttlMs: 10 });
  await cache.wrap('k', async () => 'old', { ttlMs: 10, staleMs: 5000 });
  await new Promise((r) => setTimeout(r, 25));
  const value = await cache.wrap(
    'k',
    async () => {
      throw new Error('upstream down');
    },
    { ttlMs: 10, staleMs: 5000 },
  );
  assert.equal(value, 'old');
});

test('dedupe shares a running call', async () => {
  let calls = 0;
  const job = () =>
    dedupe('same', async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return calls;
    });
  const [a, b] = await Promise.all([job(), job()]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await job(), 2, 'a new call starts once the first one is done');
});

test('retryAfterMs reads seconds from both header styles', () => {
  assert.equal(retryAfterMs(new Headers({ 'retry-after': '2' })), 2000);
  assert.equal(retryAfterMs(new Headers({ 'x-ratelimit-reset-after': '0.5' })), 500);
  assert.equal(retryAfterMs(new Headers()), null);
});

test('outboundFetch waits after a 429 and then succeeds', async () => {
  handlers['/limited'] = (req, res, n) => {
    if (n === 1) return sendJson(res, 429, { message: 'slow down' }, { 'Retry-After': '0.2' });
    return sendJson(res, 200, { ok: true });
  };
  const started = Date.now();
  const res = await outboundFetch(`${base}/limited`);
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started >= 180, 'the retry respects Retry-After');
  assert.equal(hits['/limited'], 2);
  const stats = Object.values(outboundStats())[0];
  assert.equal(stats.rateLimited, 1);
});

test('outboundFetch pauses the whole host while it is rate limited', async () => {
  handlers['/a'] = (req, res, n) => (n === 1 ? sendJson(res, 429, {}, { 'Retry-After': '0.25' }) : sendJson(res, 200, {}));
  handlers['/b'] = (req, res) => sendJson(res, 200, { at: Date.now() });
  const first = outboundFetch(`${base}/a`);
  await new Promise((r) => setTimeout(r, 60));
  const started = Date.now();
  const other = await outboundFetch(`${base}/b`);
  assert.equal(other.status, 200);
  assert.ok(Date.now() - started >= 150, 'other requests to the host wait for the pause to end');
  assert.equal((await first).status, 200);
});

test('outboundFetch slows down before the limit when the budget is used up', async () => {
  handlers['/budget'] = (req, res) => sendJson(res, 200, {}, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '0.2' });
  await outboundFetch(`${base}/budget`);
  const started = Date.now();
  await outboundFetch(`${base}/budget`);
  assert.ok(Date.now() - started >= 180, 'the next request waits for the reset');
});

test('outboundFetch retries GETs after a server error but never repeats a POST', async () => {
  handlers['/flaky'] = (req, res, n) => (n === 1 ? sendJson(res, 502, {}) : sendJson(res, 200, { ok: true }));
  assert.equal((await outboundFetch(`${base}/flaky`)).status, 200);
  assert.equal(hits['/flaky'], 2);

  handlers['/post'] = (req, res) => sendJson(res, 500, {});
  const res = await outboundFetch(`${base}/post`, { method: 'POST', body: 'x' });
  assert.equal(res.status, 500);
  assert.equal(hits['/post'], 1);
});

test('cachedJson caches answers and shares requests in flight', async () => {
  handlers['/data'] = (req, res, n) => setTimeout(() => sendJson(res, 200, { n }), 20);
  const [a, b] = await Promise.all([cachedJson(`${base}/data`), cachedJson(`${base}/data`)]);
  assert.deepEqual(a, { n: 1 });
  assert.deepEqual(b, { n: 1 });
  assert.deepEqual(await cachedJson(`${base}/data`), { n: 1 });
  assert.equal(hits['/data'], 1);
});
