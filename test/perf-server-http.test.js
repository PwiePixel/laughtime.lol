import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import zlib from 'node:zlib';
import {
  backoffDelay,
  createBackoff,
  hostBudgetLeft,
  hostPausedMs,
  outboundFetch,
  persistOutbound,
  resetOutbound,
  saveOutboundState,
  setHostBudget,
} from '../server/lib/outbound.js';
import { compressJson, createMicroCache, invalidateAfterWrite, apiCache, pickEncoding } from '../server/lib/respond.js';
import { createWorkQueue } from '../server/lib/work.js';

// HTTP layer of the custom server (compression, micro cache, 304) and the
// parts of the outbound protection that are new in this package.

let server;
let base;
let handler = (req, res) => res.end();
let dir;

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lt-http-'));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(dir, { recursive: true, force: true });
});

beforeEach(() => resetOutbound());

/** raw request: fetch() would hide the compression */
function request(pathname, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${pathname}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const bigList = { items: Array.from({ length: 80 }, (_, i) => ({ id: `meme-${i}`, title: `A fairly ordinary meme title number ${i}`, likes: i * 3 })) };
const plainJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

test('Accept-Encoding: brotli first, gzip second, nothing when switched off', () => {
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(undefined), null);
});

test('larger JSON answers are compressed, small ones and other content are left alone', async () => {
  handler = (req, res) => {
    compressJson(req, res);
    if (req.url === '/big') return plainJson(res, 200, bigList);
    if (req.url === '/small') return plainJson(res, 200, { ok: true });
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/somewhere', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (req.url === '/stream') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"part":1,');
      return res.end('"part2":2}');
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('x'.repeat(5000));
  };
  const raw = Buffer.from(JSON.stringify(bigList));

  const br = await request('/big', { 'Accept-Encoding': 'gzip, deflate, br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers.vary, 'Accept-Encoding');
  assert.equal(br.headers['cache-control'], 'no-store', 'the other headers are untouched');
  assert.equal(Number(br.headers['content-length']), br.body.length);
  assert.ok(br.body.length < raw.length / 3, `${raw.length} -> ${br.body.length}`);
  assert.deepEqual(zlib.brotliDecompressSync(br.body), raw);

  const gz = await request('/big', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.deepEqual(zlib.gunzipSync(gz.body), raw);

  const none = await request('/big');
  assert.equal(none.headers['content-encoding'], undefined);
  assert.deepEqual(none.body, raw);

  const small = await request('/small', { 'Accept-Encoding': 'br' });
  assert.equal(small.headers['content-encoding'], undefined);
  assert.equal(small.body.toString(), '{"ok":true}');

  const redirect = await request('/redirect', { 'Accept-Encoding': 'br' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.location, '/somewhere');

  const stream = await request('/stream', { 'Accept-Encoding': 'br' });
  assert.equal(stream.headers['content-encoding'], undefined);
  assert.equal(stream.body.toString(), '{"part":1,"part2":2}');

  const text = await request('/text', { 'Accept-Encoding': 'br' });
  assert.equal(text.headers['content-encoding'], undefined);
  assert.equal(text.body.length, 5000);
});

test('micro cache: one computation for many readers, ETag and 304, fresh after a write', async () => {
  const cache = createMicroCache({ max: 3 });
  let computed = 0;
  let data = bigList;
  handler = (req, res) => {
    compressJson(req, res); // both layers together, like in the server
    const key = new URL(req.url, base).searchParams.get('key') || 'list';
    return cache.send(req, res, key, 60_000, () => {
      computed += 1;
      return data;
    });
  };
  const first = await request('/list', { 'Accept-Encoding': 'br' });
  const second = await request('/list', { 'Accept-Encoding': 'gzip' });
  const third = await request('/list');
  assert.equal(computed, 1);
  assert.equal(first.headers['content-encoding'], 'br');
  assert.equal(second.headers['content-encoding'], 'gzip');
  assert.equal(third.headers['content-encoding'], undefined);
  assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(first.body)), bigList);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(second.body)), bigList);
  assert.deepEqual(JSON.parse(third.body), bigList);
  assert.equal(first.headers['cache-control'], 'no-cache', 'browsers may keep it, but ask every time');
  assert.equal(first.headers.vary, 'Accept-Encoding');
  const etag = first.headers.etag;
  assert.ok(etag);
  assert.equal(second.headers.etag, etag);

  const unchanged = await request('/list', { 'Accept-Encoding': 'br', 'If-None-Match': etag });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body.length, 0);

  // a write changes the answer: the cache is dropped, the old tag no longer matches
  data = { items: [{ id: 'new' }] };
  cache.invalidate();
  const fresh = await request('/list', { 'If-None-Match': etag });
  assert.equal(fresh.status, 200);
  assert.deepEqual(JSON.parse(fresh.body), data);
  assert.equal(computed, 2);
  assert.notEqual(fresh.headers.etag, etag);

  // keys come from request parameters: the size is bounded
  for (const key of ['a', 'b', 'c', 'd', 'e']) await request(`/list?key=${key}`);
  assert.equal(cache.size, 3);
  const stats = cache.stats();
  assert.equal(stats.notModified, 1);
  assert.ok(stats.hits >= 3);
});

test('micro cache: values, prefixes and failing producers', () => {
  const cache = createMicroCache();
  let n = 0;
  assert.equal(cache.value('community', 1000, () => ++n), 1);
  assert.equal(cache.value('community', 1000, () => ++n), 1);
  cache.value('memes:top', 1000, () => 'm');
  cache.invalidate('memes');
  assert.equal(cache.size, 1);
  assert.throws(() => cache.value('bad', 1000, () => {
    throw new Error('bad request');
  }));
  assert.equal(cache.size, 1, 'errors are not cached');
});

test('writes drop the cached public answers, creating a room does not', () => {
  apiCache.value('leaderboard:points:all:50', 60_000, () => 'rows');
  invalidateAfterWrite('/api/rooms');
  invalidateAfterWrite('/api/rooms/ABCDE/upload');
  assert.equal(apiCache.size, 1);
  invalidateAfterWrite('/api/memes/abc123/like');
  assert.equal(apiCache.size, 0);
});

test('back-off: doubling pause with an upper limit, reset after a success', () => {
  const opts = { baseMs: 1000, maxMs: 10_000 };
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, opts)), [1000, 2000, 4000, 8000, 10_000, 10_000]);
  const jittered = backoffDelay(3, { ...opts, jitter: 0.2 });
  assert.ok(jittered >= 3200 && jittered <= 4800);

  const breaker = createBackoff(opts);
  assert.equal(breaker.ready(), true);
  breaker.fail();
  assert.equal(breaker.ready(), false);
  assert.ok(breaker.waitMs() > 900);
  assert.ok(breaker.fail(60_000) >= 60_000, 'an API may ask for a longer pause');
  breaker.succeed();
  assert.equal(breaker.ready(), true);
  assert.equal(breaker.failures, 0);
});

test('a paused host fails fast instead of queueing a waiting player', async () => {
  let hits = 0;
  handler = (req, res) => {
    hits += 1;
    res.writeHead(429, { 'Retry-After': '20' });
    res.end();
  };
  const limited = await outboundFetch(`${base}/api`, { retries: 2 });
  assert.equal(limited.status, 429);
  assert.equal(hits, 1, 'a long Retry-After is not waited out');
  assert.ok(hostPausedMs(base) > 15_000);
  const started = Date.now();
  await assert.rejects(outboundFetch(`${base}/api`, { maxQueueMs: 500 }), { code: 'host_paused' });
  assert.ok(Date.now() - started < 200);
  assert.equal(hits, 1);
});

test('a deadline limits the whole request including retries', async () => {
  let hits = 0;
  handler = (req, res) => {
    hits += 1;
    setTimeout(() => {
      res.writeHead(503);
      res.end();
    }, 150);
  };
  const started = Date.now();
  const res = await outboundFetch(`${base}/slow`, { retries: 5, deadlineMs: 400 });
  assert.equal(res.status, 503);
  assert.ok(Date.now() - started < 1500, 'no five retries with growing pauses');
  assert.ok(hits <= 2);
});

test('hourly budgets and rate-limit pauses survive a restart', async () => {
  const file = path.join(dir, 'outbound.json');
  handler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  };
  await persistOutbound(file);
  setHostBudget(base, 5);
  for (let i = 0; i < 3; i++) await outboundFetch(`${base}/x`);
  assert.equal(hostBudgetLeft(base), 2);
  await saveOutboundState();

  // "restart": all counters in memory are gone
  resetOutbound();
  assert.equal(hostBudgetLeft(base), Infinity);
  assert.equal(await persistOutbound(file), true);
  setHostBudget(base, 5);
  assert.equal(hostBudgetLeft(base), 2, 'the calls from before the restart still count');
  await outboundFetch(`${base}/x`);
  await outboundFetch(`${base}/x`);
  await assert.rejects(outboundFetch(`${base}/x`), { code: 'budget_exhausted' });

  // a broken file never stops the server
  await fsp.writeFile(file, '{not json');
  resetOutbound();
  assert.equal(await persistOutbound(file), false);
});

test('work queue: limited parallelism, bounded waiting list', async () => {
  const queue = createWorkQueue({ concurrency: 2, maxQueue: 3 });
  let running = 0;
  let peak = 0;
  const job = () =>
    queue.run(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
      return 'done';
    });
  const jobs = [job(), job(), job(), job(), job()];
  await assert.rejects(job(), { code: 'queue_full' });
  assert.deepEqual(await Promise.all(jobs), Array(5).fill('done'));
  assert.equal(peak, 2);
  assert.deepEqual(queue.stats(), { active: 0, waiting: 0, done: 5, rejected: 1 });
});
