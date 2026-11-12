import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SW_FILE = path.join(ROOT, 'public', 'sw.js');
const ORIGIN = 'https://laughtime.lol';

/** runs the worker script with a stand-in for the worker scope and returns its functions */
function loadWorker() {
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
  };
  const context = vm.createContext({ self, URL, Date, console });
  vm.runInContext(fs.readFileSync(SW_FILE, 'utf8'), context, { filename: 'sw.js' });
  return { context, listeners };
}

const request = (url, { method = 'GET', mode = 'no-cors', destination = '', headers = {} } = {}) => ({
  url: new URL(url, ORIGIN).href,
  method,
  mode,
  destination,
  headers: new Headers(headers),
});

test('public/sw.js is valid JavaScript', () => {
  execFileSync(process.execPath, ['--check', SW_FILE], { stdio: 'pipe' });
});

test('the worker has a version and handles its life cycle', () => {
  const source = fs.readFileSync(SW_FILE, 'utf8');
  assert.match(source, /^const VERSION = 'v\d+';$/m);
  const { listeners } = loadWorker();
  for (const type of ['install', 'activate', 'fetch', 'message']) assert.equal(typeof listeners[type], 'function', type);
  // a new worker waits for the page: skipWaiting() only as an answer to a message
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const install = /addEventListener\('install'[\s\S]*?\n}\);/.exec(code)[0];
  assert.ok(!install.includes('skipWaiting'), 'no skipWaiting() during install');
  assert.equal(code.match(/skipWaiting\(\)/g).length, 1, 'skipWaiting() only in the message handler');
});

test('page loads: network first with the offline page as fallback', () => {
  const { strategyFor } = loadWorker().context;
  const nav = { mode: 'navigate', destination: 'document' };
  for (const url of ['/', '/?source=pwa', '/memes', '/room/AB12C', '/play?game=classic', '/offline', '/u/some.name_1']) {
    assert.equal(strategyFor(request(url, nav), ORIGIN), 'page', url);
  }
});

test('page loads without a fallback: API pages, files and the Discord Activity', () => {
  const { strategyFor } = loadWorker().context;
  const nav = { mode: 'navigate', destination: 'document' };
  for (const url of [
    '/api/auth/discord',
    '/api/auth/discord/callback?code=abc&state=xyz',
    '/api/media?u=https%3A%2F%2Fi.imgflip.com%2Fa.jpg',
    '/?frame_id=1&instance_id=2',
    '/activity',
    '/activity/x',
    '/banner.png',
    '/manifest.json',
  ]) {
    assert.equal(strategyFor(request(url, nav), ORIGIN), 'direct', url);
  }
});

test('hashed build files and fonts: cache first', () => {
  const { strategyFor } = loadWorker().context;
  assert.equal(strategyFor(request('/_next/static/chunks/abc123.js', { destination: 'script' }), ORIGIN), 'static');
  assert.equal(strategyFor(request('/_next/static/chunks/abc123.css', { destination: 'style' }), ORIGIN), 'static');
  assert.equal(strategyFor(request('/_next/static/media/fredoka.woff2', { destination: 'font', mode: 'cors' }), ORIGIN), 'static');
  assert.equal(strategyFor(request('/fonts/extra.woff2', { destination: 'font' }), ORIGIN), 'static');
});

test('images: stale-while-revalidate', () => {
  const { strategyFor } = loadWorker().context;
  assert.equal(strategyFor(request('/logo-mark.svg', { destination: 'image' }), ORIGIN), 'image');
  assert.equal(strategyFor(request('/icons/icon-192.png', { destination: 'image' }), ORIGIN), 'image');
  assert.equal(strategyFor(request('/images/mascots/LoL_Bote-asset.png'), ORIGIN), 'image');
  assert.equal(strategyFor(request('/icon.svg?abc', { destination: 'image' }), ORIGIN), 'image');
  // media proxy, with and without a size variant
  assert.equal(strategyFor(request('/api/media?u=https%3A%2F%2Fi.imgflip.com%2Fa.jpg', { destination: 'image' }), ORIGIN), 'media');
  assert.equal(strategyFor(request('/api/media?u=https%3A%2F%2Fi.imgflip.com%2Fa.jpg&w=480', { destination: 'image' }), ORIGIN), 'media');
  assert.equal(strategyFor(request('/api/media?u=https%3A%2F%2Fi.imgflip.com%2Fa.jpg', { mode: 'cors' }), ORIGIN), 'media');
});

test('never handled: personal API answers, writes, streams, other origins', () => {
  const { strategyFor } = loadWorker().context;
  const untouched = [
    request('/api/me'),
    request('/api/me?pid=abc'),
    request('/api/auth/login', { method: 'POST' }),
    request('/api/rooms', { method: 'POST' }),
    request('/api/rooms/AB12C'),
    request('/api/rooms/AB12C/upload', { method: 'POST' }),
    request('/api/uploads/rooms/AB12C/1.png', { destination: 'image' }),
    request('/api/memes?sort=top'),
    request('/api/status'),
    request('/api/public'),
    request('/api/community'),
    // videos and range requests go straight to the network
    request('/api/media?u=https%3A%2F%2Fi.imgflip.com%2Fa.mp4', { destination: 'video' }),
    request('/api/media?u=https%3A%2F%2Fi.imgflip.com%2Fa.mp4', { headers: { Range: 'bytes=0-' } }),
    request('/api/media?u=https%3A%2F%2Fi.imgflip.com%2Fa.jpg', { destination: 'image', headers: { range: 'bytes=0-99' } }),
    request('/sounds/pop.mp3', { destination: 'audio' }),
    request('/logo-mark.svg', { method: 'HEAD', destination: 'image' }),
    request('/ws'),
    request('/sw.js', { destination: 'serviceworker' }),
    request('/manifest.json', { destination: 'manifest' }),
    // page data of the app router and everything else below /_next/
    request('/memes?_rsc=abc', { mode: 'cors', headers: { RSC: '1' } }),
    request('/_next/image?url=%2Fbanner.png&w=640&q=75', { destination: 'image' }),
    request('/_next/webpack-hmr'),
    // other origins
    request('https://i.imgflip.com/a.jpg', { destination: 'image' }),
    request('https://cdn.discordapp.com/avatars/1/a.png', { destination: 'image' }),
    request('https://evil.example/_next/static/x.js', { destination: 'script' }),
  ];
  for (const req of untouched) assert.equal(strategyFor(req, ORIGIN), null, `${req.method} ${req.url}`);
});

test('only complete same-origin answers are stored', () => {
  const { isStorable, isImageResponse } = loadWorker().context;
  const response = (status, type, headers = {}) => ({ status, type, headers: new Headers(headers) });
  assert.equal(isStorable(response(200, 'basic')), true);
  assert.equal(isStorable(response(200, 'basic', { Vary: 'Accept' })), true);
  assert.equal(isStorable(response(200, 'basic', { Vary: 'Accept, *' })), false);
  assert.equal(isStorable(response(206, 'basic')), false, 'partial content');
  assert.equal(isStorable(response(404, 'basic')), false);
  assert.equal(isStorable(response(0, 'opaque')), false);
  assert.equal(isStorable(response(200, 'cors')), false);
  assert.equal(isStorable(null), false);
  assert.equal(isImageResponse(response(200, 'basic', { 'Content-Type': 'image/webp' })), true);
  assert.equal(isImageResponse(response(200, 'basic', { 'Content-Type': 'video/mp4' })), false);
  assert.equal(isImageResponse(response(200, 'basic', { 'Content-Type': 'application/json' })), false);
});
