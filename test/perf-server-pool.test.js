import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { resetOutbound } from '../server/lib/outbound.js';
import { getJson } from '../server/media/http.js';
import { createMediaPool } from '../server/media/pool.js';

// The pool engine with sources that read from a local server: schedule,
// back-off after errors and the copy on disk.

let server;
let base;
let dir;
const dirs = [];
let hits = {};
let handlers = {};
const quiet = { log() {}, warn() {} };
const MIN = 60_000;

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const clip = (id, title = `Clip ${id}`) => ({ id: `fake:${id}`, kind: 'video', url: `https://media.giphy.com/media/${id}/giphy.mp4`, title, source: 'fake' });
const picture = (id, title = `Picture ${id}`) => ({ id: `fake:${id}`, kind: 'image', url: `https://i.imgflip.com/${id}.jpg`, title, source: 'fake' });

/** a source that asks the local server (through the same outbound layer as the real ones) */
const source = (key, kind, extra = {}) => ({
  key,
  kind,
  source: 'fake',
  on: () => true,
  // no retries here: the tests count requests exactly
  load: async () => (await getJson(`${base}/${key}`, { retries: 0 })).items,
  ...extra,
});

function newPool(sources, options = {}) {
  return createMediaPool({
    sources,
    file: path.join(dir, 'pool.json'),
    getCfg: () => ({ blocked: ['forbidden'] }),
    allow: (item, cfg) => !cfg.blocked.some((w) => String(item.title).toLowerCase().includes(w)),
    refreshMs: 30 * MIN,
    retryMs: 5 * MIN,
    maxRetryMs: 6 * 60 * MIN,
    jitter: 0,
    log: quiet,
    ...options,
  });
}

before(async () => {
  server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    hits[p] = (hits[p] || 0) + 1;
    const handler = handlers[p];
    if (handler) return handler(req, res, hits[p]);
    return sendJson(res, 404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await Promise.all(dirs.map((d) => fsp.rm(d, { recursive: true, force: true })));
});

beforeEach(async () => {
  hits = {};
  handlers = {
    '/images': (req, res) => sendJson(res, 200, { items: [picture('a'), picture('b'), picture('c', 'Forbidden word')] }),
    '/videos': (req, res) => sendJson(res, 200, { items: [clip('v1'), clip('v2'), clip('v1')] }),
  };
  resetOutbound();
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lt-pool-'));
  dirs.push(dir);
});

test('a good load is filtered, scheduled 30 minutes ahead and written to disk', async () => {
  const pool = newPool([source('images', 'image'), source('videos', 'video')]);
  await pool.start();
  pool.stop();
  const images = pool.entries.get('images');
  const videos = pool.entries.get('videos');
  assert.deepEqual(images.items.map((i) => i.id), ['fake:a', 'fake:b'], 'blocked titles are removed');
  assert.deepEqual(videos.items.map((i) => i.id), ['fake:v1', 'fake:v2'], 'duplicates are removed');
  assert.equal(images.status, 'ok');
  assert.equal(images.failures, 0);
  const wait = images.nextAt - Date.now();
  assert.ok(wait > 29 * MIN && wait <= 30 * MIN, `next load in ~30 min (${wait} ms)`);

  const saved = JSON.parse(await fsp.readFile(path.join(dir, 'pool.json'), 'utf8'));
  assert.equal(saved.v, 1);
  assert.equal(saved.sources.images.items.length, 2);
  assert.equal(saved.sources.videos.failures, 0);
});

test('the refresh time gets jitter so the sources do not all load in the same second', async () => {
  const pool = newPool([source('images', 'image'), source('videos', 'video')], { jitter: 0.1 });
  const waits = [];
  for (let i = 0; i < 12; i++) {
    await pool.refreshDue({ force: true });
    waits.push(pool.entries.get('images').nextAt - Date.now());
  }
  for (const w of waits) assert.ok(w >= 27 * MIN - 1000 && w <= 33 * MIN, `inside 30 min ± 10 % (${w})`);
  assert.ok(new Set(waits.map((w) => Math.round(w / 1000))).size > 1, 'not always the same time');
});

test('after a restart the saved pool is served at once – without a single request', async () => {
  const first = newPool([source('images', 'image'), source('videos', 'video')]);
  await first.start();
  first.stop();
  assert.deepEqual(hits, { '/images': 1, '/videos': 1 });

  // five restarts in a row
  for (let i = 0; i < 5; i++) {
    const pool = newPool([source('images', 'image'), source('videos', 'video')]);
    await pool.start();
    pool.stop();
    assert.equal(pool.entries.get('images').items.length, 2);
    assert.equal(pool.entries.get('videos').items.length, 2);
    assert.equal(pool.entries.get('images').restored, true);
    assert.equal(pool.stats().restoredItems, 4);
  }
  assert.deepEqual(hits, { '/images': 1, '/videos': 1 }, 'restarts do not multiply API calls');
});

test('a failing source backs off exponentially and keeps its old items', async () => {
  const pool = newPool([source('images', 'image'), source('videos', 'video')]);
  await pool.refreshDue();
  handlers['/videos'] = (req, res) => sendJson(res, 500, { error: 'down' });

  const pauses = [];
  for (let i = 0; i < 9; i++) {
    await pool.refreshDue({ force: true });
    const e = pool.entries.get('videos');
    pauses.push(Math.round((e.nextAt - Date.now()) / MIN));
    assert.equal(e.failures, i + 1);
    assert.equal(e.items.length, 2, 'the last good items stay in the game');
    assert.equal(e.status, 'ok');
    assert.match(e.error, /HTTP 500/);
  }
  assert.deepEqual(pauses, [5, 10, 20, 40, 80, 160, 320, 360, 360], 'doubling pause with an upper limit');

  // not due yet: nothing is requested, however often the timer looks
  const before = hits['/videos'];
  assert.deepEqual(await pool.refreshDue(), []);
  assert.equal(hits['/videos'], before);

  // back to normal after the first good answer
  handlers['/videos'] = (req, res) => sendJson(res, 200, { items: [clip('v9')] });
  await pool.refreshDue({ force: true });
  const e = pool.entries.get('videos');
  assert.equal(e.failures, 0);
  assert.equal(e.error, null);
  assert.deepEqual(e.items.map((i) => i.id), ['fake:v9']);
  assert.equal(Math.round((e.nextAt - Date.now()) / MIN), 30);
});

test('a source without any items reports an error and is retried later, not every few minutes', async () => {
  handlers['/videos'] = (req, res) => sendJson(res, 200, { items: [] });
  const pool = newPool([source('videos', 'video')]);
  await pool.refreshDue();
  const e = pool.entries.get('videos');
  assert.equal(e.status, 'error');
  assert.equal(e.error, 'no items returned');
  await pool.refreshDue({ force: true });
  await pool.refreshDue({ force: true });
  assert.equal(Math.round((e.nextAt - Date.now()) / MIN), 20);
});

test('the back-off survives a restart', async () => {
  handlers['/videos'] = (req, res) => sendJson(res, 503, {});
  const first = newPool([source('images', 'image'), source('videos', 'video')]);
  await first.refreshDue();
  await first.refreshDue({ force: true });
  assert.equal(hits['/videos'], 2);

  const pool = newPool([source('images', 'image'), source('videos', 'video')]);
  await pool.start();
  pool.stop();
  const e = pool.entries.get('videos');
  assert.equal(e.failures, 2);
  assert.equal(e.status, 'error');
  assert.ok(e.nextAt - Date.now() > 9 * MIN, 'still waiting for the second pause');
  assert.equal(hits['/videos'], 2, 'the broken source is not asked again right after the restart');
});

test('a crash in the middle of loading counts as an attempt (no hammering in a crash loop)', async () => {
  let release;
  handlers['/videos'] = (req, res) => {
    release = () => sendJson(res, 200, { items: [clip('late')] });
  };
  const crashed = newPool([source('videos', 'video')]);
  const hanging = crashed.refreshDue();
  // wait until the request is out – the attempt is on disk by then
  while (!hits['/videos']) await new Promise((r) => setTimeout(r, 5));

  for (let i = 0; i < 4; i++) {
    const pool = newPool([source('videos', 'video')]);
    await pool.start();
    pool.stop();
    assert.equal(pool.entries.get('videos').failures, 1);
    assert.ok(pool.entries.get('videos').nextAt > Date.now() + 30_000);
  }
  assert.equal(hits['/videos'], 1, 'four restarts, no further request');
  release();
  await hanging;
  crashed.stop();
});

test('a source that was switched off is not served from the saved pool', async () => {
  const first = newPool([source('images', 'image'), source('videos', 'video')]);
  await first.refreshDue();
  const pool = newPool([source('images', 'image'), source('videos', 'video', { on: () => false })]);
  await pool.start();
  pool.stop();
  assert.equal(pool.entries.get('videos').items.length, 0);
  assert.equal(pool.entries.get('videos').status, 'off');
  assert.equal(pool.entries.get('images').items.length, 2);
  assert.equal(hits['/videos'], 1);
});

test('changed settings of a source lead to a fresh load after the restart', async () => {
  const first = newPool([source('videos', 'video', { sig: () => 'terms-a' })]);
  await first.refreshDue();
  const same = newPool([source('videos', 'video', { sig: () => 'terms-a' })]);
  await same.start();
  same.stop();
  assert.equal(hits['/videos'], 1);
  const changed = newPool([source('videos', 'video', { sig: () => 'terms-b' })]);
  await changed.start();
  // the old items are there at once, the new ones follow in the background
  assert.equal(changed.entries.get('videos').items.length, 2);
  await changed.refreshDue();
  changed.stop();
  assert.equal(hits['/videos'], 2);
});

test('a damaged pool file is ignored', async () => {
  await fsp.writeFile(path.join(dir, 'pool.json'), '{"v":1,"sources":{"videos":{"items":[{"id":5,"url":"javascript:alert(1)"}');
  const pool = newPool([source('videos', 'video')]);
  await pool.start();
  pool.stop();
  assert.deepEqual(pool.entries.get('videos').items.map((i) => i.id), ['fake:v1', 'fake:v2']);

  // readable, but with entries that are not media items
  await fsp.writeFile(
    path.join(dir, 'pool.json'),
    JSON.stringify({ v: 1, sources: { videos: { items: [{ id: 5, url: 'javascript:alert(1)', kind: 'video' }, clip('ok'), picture('wrong-kind')], nextAt: Date.now() + MIN } } }),
  );
  const second = newPool([source('videos', 'video')]);
  assert.equal(await second.restore(), 1);
  assert.deepEqual(second.entries.get('videos').items.map((i) => i.id), ['fake:ok']);
});
