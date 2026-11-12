import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { getConfig } from '../server/config.js';
import { hostBudgetLeft, outboundStats, resetOutbound, setHostBudget } from '../server/lib/outbound.js';
import { _test as httpTest } from '../server/media/http.js';
import { _test as redditTest } from '../server/media/reddit.js';
import { _test as searchTest, findKnownItem, searchKey, searchMedia, searchStats } from '../server/media/search.js';

// A local server plays GIPHY, KLIPY, Imgflip and Reddit – no request leaves the machine.

let server;
let base;
let second; // KLIPY lives on its own host, like in the real world (pauses and budgets are per host)
let klipyBase;
let hits = {};
let handlers = {};
const cfg = getConfig();

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const giphyClip = (id, title) => ({
  id,
  title,
  url: `https://giphy.com/gifs/${id}`,
  images: { original_mp4: { mp4: `https://media.giphy.com/media/${id}/giphy.mp4`, width: '480', height: '270' } },
});

const klipyClip = (id, title) => ({ id, title, slug: id, file: { mp4: `https://static.klipy.com/clips/${id}.mp4` } });

function route(req, res) {
  const path = req.url.split('?')[0];
  hits[path] = (hits[path] || 0) + 1;
  const handler = handlers[path];
  if (handler) return handler(req, res, hits[path]);
  res.writeHead(404);
  return res.end();
}

before(async () => {
  server = http.createServer(route);
  second = http.createServer(route);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => second.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  klipyBase = `http://127.0.0.1:${second.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => second.close(resolve));
});

beforeEach(() => {
  hits = {};
  handlers = {};
  resetOutbound();
  httpTest.resetBudgets();
  searchTest.reset();
  redditTest.resetToken();
  // only GIPHY by default; single tests switch more providers on
  Object.assign(cfg, {
    imgflipEnabled: false,
    giphyKey: 'test-key',
    giphyApiBase: `${base}/giphy`,
    klipyKey: '',
    klipyApiBase: `${klipyBase}/klipy`,
    klipyTypes: ['clips'],
    giphyHourlyLimit: 0,
    klipyHourlyLimit: 0,
    imgflipHourlyLimit: 0,
    searchCacheMs: 60_000,
    searchCacheMax: 500,
  });
  searchTest.endpoints.imgflipSearch = `${base}/memesearch`;
});

test('search key ignores case, spaces and punctuation at the ends', () => {
  assert.equal(searchKey('  Funny   CAT!! ', 'video'), 'video|funny cat');
  assert.equal(searchKey('funny cat', 'video'), searchKey('FUNNY CAT?', 'video'));
  assert.notEqual(searchKey('funny cat', 'video'), searchKey('funny cat', 'image'));
});

test('identical searches share one request and are answered from the cache afterwards', async () => {
  handlers['/giphy/search'] = (req, res) => setTimeout(() => sendJson(res, 200, { data: [giphyClip('a1', 'Dancing cat')] }), 30);
  const all = await Promise.all([
    searchMedia('dancing cat', { kind: 'video' }),
    searchMedia('Dancing  Cat', { kind: 'video' }),
    searchMedia('dancing cat!', { kind: 'video' }),
  ]);
  for (const items of all) assert.deepEqual(items.map((i) => i.id), ['giphy:a1']);
  assert.equal(hits['/giphy/search'], 1, 'three players, one API call');

  await searchMedia('DANCING CAT', { kind: 'video' });
  assert.equal(hits['/giphy/search'], 1, 'the repeat comes from the cache');
  const stats = searchStats();
  assert.equal(stats.cache.misses, 1);
  assert.equal(stats.cache.shared, 2);
  assert.equal(stats.cache.hits, 1);
  assert.ok(findKnownItem('giphy:a1'), 'results can be added to a pack by id');

  // another kind is another search
  await searchMedia('dancing cat', { kind: 'any' });
  assert.equal(hits['/giphy/search'], 2);
});

test('"nothing found" is cached too', async () => {
  handlers['/giphy/search'] = (req, res) => sendJson(res, 200, { data: [] });
  assert.deepEqual(await searchMedia('qqzzxx', { kind: 'video' }), []);
  assert.deepEqual(await searchMedia('qqzzxx', { kind: 'video' }), []);
  assert.equal(hits['/giphy/search'], 1);
});

test('the cache has a size limit', async () => {
  cfg.searchCacheMax = 3;
  searchTest.reset();
  handlers['/giphy/search'] = (req, res) => sendJson(res, 200, { data: [giphyClip('x', 'Clip')] });
  for (const q of ['one', 'two', 'three', 'four', 'five']) await searchMedia(q, { kind: 'video' });
  assert.equal(searchStats().cache.size, 3);
  await searchMedia('five', { kind: 'video' });
  assert.equal(hits['/giphy/search'], 5, 'the newest entry is still there');
  await searchMedia('one', { kind: 'video' });
  assert.equal(hits['/giphy/search'], 6, 'the oldest one was dropped');
});

test('a rate limited provider is skipped while the others still answer', async () => {
  cfg.klipyKey = 'klipy-key';
  handlers['/giphy/search'] = (req, res) => sendJson(res, 429, { message: 'slow down' }, { 'Retry-After': '30' });
  handlers['/klipy/klipy-key/clips/search'] = (req, res) => sendJson(res, 200, { data: { data: [klipyClip('k1', 'Party parrot')] } });

  const first = await searchMedia('party', { kind: 'video' });
  assert.deepEqual(first.map((i) => i.id), ['klipy:clips:k1'], 'KLIPY answers although GIPHY is limited');
  assert.equal(hits['/giphy/search'], 1, 'no retry storm against the limited API');

  await searchMedia('parrot', { kind: 'video' });
  await searchMedia('birthday', { kind: 'video' });
  assert.equal(hits['/giphy/search'], 1, 'GIPHY is left alone while it is paused');
  assert.equal(hits['/klipy/klipy-key/clips/search'], 3);

  const stats = searchStats();
  assert.equal(stats.providers.giphy.skipped, 2);
  assert.ok(stats.providers.giphy.pausedMs > 20_000, 'the pause follows Retry-After');
  assert.equal(stats.cache.degraded, 3);
  const host = Object.entries(outboundStats()).find(([, v]) => v.rateLimited)[1];
  assert.equal(host.rateLimited, 1);
  assert.ok(host.pausedMs > 20_000);
});

test('a provider that is down does not break the search and gets a growing pause', async () => {
  handlers['/giphy/search'] = (req, res) => sendJson(res, 503, {});
  const started = Date.now();
  assert.deepEqual(await searchMedia('offline', { kind: 'video' }), []);
  assert.ok(Date.now() - started < 4000, 'the player does not wait long');
  assert.equal(hits['/giphy/search'], 2, 'one retry, then the provider is given up');
  const firstPause = searchStats().providers.giphy.pausedMs;
  assert.ok(firstPause > 10_000);

  await searchMedia('still offline', { kind: 'video' });
  assert.equal(hits['/giphy/search'], 2, 'no request during the pause');

  // the pause is over (simulated) and the provider fails again: the next pause is longer
  searchTest.breakers.giphy.succeed();
  searchTest.breakers.giphy.fail();
  searchTest.breakers.giphy.fail();
  assert.ok(searchTest.breakers.giphy.waitMs() > 30_000);
});

test('a degraded answer is only cached for a moment and never replaces a complete one', async () => {
  let down = false;
  handlers['/giphy/search'] = (req, res) => (down ? sendJson(res, 500, {}) : sendJson(res, 200, { data: [giphyClip('g1', 'Good one')] }));
  cfg.searchCacheMs = 40; // the complete answer expires quickly, but stays as a fallback
  searchTest.reset();
  assert.equal((await searchMedia('fallback', { kind: 'video' })).length, 1);
  await new Promise((r) => setTimeout(r, 70));
  down = true;
  const again = await searchMedia('fallback', { kind: 'video' });
  assert.deepEqual(again.map((i) => i.id), ['giphy:g1'], 'the earlier complete answer is served while the provider is down');
});

test('the hourly budget stops requests before the API can complain', async () => {
  cfg.giphyHourlyLimit = 5;
  httpTest.resetBudgets();
  handlers['/giphy/search'] = (req, res) => sendJson(res, 200, { data: [giphyClip('b1', 'Budget')] });
  for (let i = 0; i < 8; i++) await searchMedia(`query number ${i}`, { kind: 'video' });
  // searches run with low priority: one fifth of the budget is kept for the media pool
  assert.equal(hits['/giphy/search'], 4);
  assert.equal(hostBudgetLeft(base, 'low'), 0);
  assert.equal(hostBudgetLeft(base, 'normal'), 1);
  const budget = Object.values(outboundStats()).find((v) => v.budget).budget;
  assert.deepEqual({ perHour: budget.perHour, used: budget.used }, { perHour: 5, used: 4 });
  assert.equal(budget.denied, 4);
});

test('Imgflip search pages are parsed, cached and limited like the APIs', async () => {
  cfg.imgflipEnabled = true;
  cfg.giphyKey = '';
  const page = `<div class="mt-box"><a href="/meme/123/Grumpy-Cat">Grumpy Cat</a>
    <img style="width:150px;height:100px" src="//i.imgflip.com/4/abc12.jpg"></div>`;
  handlers['/memesearch'] = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page);
  };
  const items = await searchMedia('grumpy', { kind: 'image' });
  assert.equal(items[0].id, 'imgflip:123');
  assert.equal(items[0].url, 'https://i.imgflip.com/abc12.jpg');
  await searchMedia('Grumpy', { kind: 'image' });
  assert.equal(hits['/memesearch'], 1);
});

test('Reddit: one token request for many listings, reused until shortly before it expires', async () => {
  handlers['/token'] = (req, res) => setTimeout(() => sendJson(res, 200, { access_token: `token-${hits['/token']}`, expires_in: 3600 }), 20);
  const settings = { redditClientId: 'id', redditClientSecret: 'secret', redditUserAgent: 'test' };
  const tokens = await Promise.all(Array.from({ length: 10 }, () => redditTest.getToken(settings, `${base}/token`)));
  assert.deepEqual(new Set(tokens), new Set(['token-1']));
  assert.equal(hits['/token'], 1);
  assert.equal(await redditTest.getToken(settings, `${base}/token`), 'token-1');
  assert.equal(hits['/token'], 1, 'still valid: no new request');
});

test('Reddit: a failed login is not repeated for every listing', async () => {
  handlers['/token'] = (req, res) => sendJson(res, 401, { error: 'invalid_client' });
  const settings = { redditClientId: 'id', redditClientSecret: 'wrong', redditUserAgent: 'test' };
  await assert.rejects(redditTest.getToken(settings, `${base}/token`), /401/);
  await assert.rejects(redditTest.getToken(settings, `${base}/token`), /401/);
  assert.equal(hits['/token'], 1);
});

test('budgets can be set per host and switched off again', () => {
  assert.equal(setHostBudget('api.example.test', 10), 10);
  assert.equal(hostBudgetLeft('api.example.test'), 10);
  assert.equal(hostBudgetLeft('api.example.test', 'low'), 8);
  setHostBudget('api.example.test', 0);
  assert.equal(hostBudgetLeft('api.example.test'), Infinity);
});
