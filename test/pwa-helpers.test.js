import assert from 'node:assert/strict';
import { test } from 'node:test';
import pwaTexts from '../lib/locales/pwa.js';
import {
  MAX_DISMISSALS,
  MIN_VIEWS,
  SNOOZE_MS,
  detectPlatform,
  hasEngaged,
  installMethod,
  isEmbedded,
  isGameRoute,
  isLocalHost,
  isQuietRoute,
  isSnoozed,
  parsePwaState,
  recordDismissal,
  recordView,
  retryTarget,
  shouldOfferInstall,
  shouldRegisterWorker,
} from '../lib/pwa.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.1',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
};

test('game routes: matchmaking and rooms', () => {
  for (const p of ['/play', '/room', '/room/AB12C', '/play/']) assert.equal(isGameRoute(p), true, p);
  for (const p of ['/', '/memes', '/rooms', '/player', '/m/room', '', undefined]) assert.equal(isGameRoute(p), false, String(p));
});

test('quiet routes never show the install offer', () => {
  for (const p of ['/play', '/room/AB12C', '/install', '/offline', '/admin', '/admin/users', '/activity', '/legal']) {
    assert.equal(isQuietRoute(p), true, p);
  }
  for (const p of ['/', '/memes', '/leaderboard', '/login', '/installer']) assert.equal(isQuietRoute(p), false, p);
});

test('localhost detection', () => {
  for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '[::1]', 'app.localhost']) assert.equal(isLocalHost(h), true, h);
  for (const h of ['laughtime.lol', 'beta.laughtime.lol', '10.0.0.5', 'localhost.example.org', '']) assert.equal(isLocalHost(h), false, h);
});

test('the Discord Activity counts as embedded', () => {
  assert.equal(isEmbedded({ hostname: 'laughtime.lol', framed: true }), true);
  assert.equal(isEmbedded({ hostname: '1234567890.discordsays.com' }), true);
  assert.equal(isEmbedded({ hostname: 'laughtime.lol', search: '?frame_id=abc&instance_id=1' }), true);
  assert.equal(isEmbedded({ hostname: 'laughtime.lol', search: '?source=pwa' }), false);
  assert.equal(isEmbedded({ hostname: 'notdiscordsays.com' }), false);
  assert.equal(isEmbedded(), false);
});

test('the worker is only registered where it belongs', () => {
  const ok = { production: true, supported: true, secure: true, hostname: 'laughtime.lol' };
  assert.equal(shouldRegisterWorker(ok), true);
  assert.equal(shouldRegisterWorker({ ...ok, hostname: 'beta.laughtime.lol' }), true);
  assert.equal(shouldRegisterWorker({ ...ok, production: false }), false, 'development build');
  assert.equal(shouldRegisterWorker({ ...ok, supported: false }), false, 'browser without service workers');
  assert.equal(shouldRegisterWorker({ ...ok, secure: false }), false, 'plain http');
  assert.equal(shouldRegisterWorker({ ...ok, framed: true }), false, 'iframe');
  assert.equal(shouldRegisterWorker({ ...ok, search: '?frame_id=1' }), false, 'activity url');
  assert.equal(shouldRegisterWorker({ ...ok, hostname: '42.discordsays.com' }), false, 'discord proxy');
  assert.equal(shouldRegisterWorker({ ...ok, hostname: 'localhost' }), false, 'localhost');
  assert.equal(shouldRegisterWorker({ ...ok, hostname: 'localhost', debug: true }), true, 'localhost with debug flag');
  assert.equal(shouldRegisterWorker({ ...ok, hostname: 'localhost', debug: true, framed: true }), false, 'debug never beats the iframe rule');
  assert.equal(shouldRegisterWorker(), false);
});

test('platform detection', () => {
  assert.deepEqual(detectPlatform({ userAgent: UA.iphone }), { os: 'ios', browser: 'safari', inApp: false });
  assert.deepEqual(detectPlatform({ userAgent: UA.iphoneChrome }), { os: 'ios', browser: 'chrome', inApp: false });
  assert.deepEqual(detectPlatform({ userAgent: UA.ipad, platform: 'MacIntel', maxTouchPoints: 5 }), { os: 'ios', browser: 'safari', inApp: false });
  assert.deepEqual(detectPlatform({ userAgent: UA.ipad, platform: 'MacIntel', maxTouchPoints: 0 }), { os: 'desktop', browser: 'safari', inApp: false });
  assert.deepEqual(detectPlatform({ userAgent: UA.android }), { os: 'android', browser: 'chrome', inApp: false });
  assert.deepEqual(detectPlatform({ userAgent: UA.samsung }), { os: 'android', browser: 'samsung', inApp: false });
  assert.deepEqual(detectPlatform({ userAgent: UA.windows }), { os: 'desktop', browser: 'edge', inApp: false });
  assert.deepEqual(detectPlatform({ userAgent: UA.firefox }), { os: 'desktop', browser: 'firefox', inApp: false });
  assert.equal(detectPlatform({ userAgent: UA.instagram }).inApp, true);
  assert.deepEqual(detectPlatform(), { os: 'desktop', browser: 'other', inApp: false });
});

test('install method', () => {
  const ios = detectPlatform({ userAgent: UA.iphone });
  const android = detectPlatform({ userAgent: UA.android });
  assert.equal(installMethod({ platform: android, hasPrompt: true }), 'prompt');
  assert.equal(installMethod({ platform: android, hasPrompt: true, standalone: true }), 'none');
  assert.equal(installMethod({ platform: android }), 'manual');
  assert.equal(installMethod({ platform: ios }), 'ios');
  assert.equal(installMethod({ platform: ios, standalone: true }), 'none');
  assert.equal(installMethod({ platform: detectPlatform({ userAgent: UA.instagram }) }), 'none');
  assert.equal(installMethod(), 'none');
});

test('remembered state survives broken storage content', () => {
  const empty = { views: 0, played: false, dismissals: 0, dismissedAt: 0, installed: false };
  for (const raw of [null, undefined, '', 'nope', '[1,2]', '{"views":-4,"played":"yes","dismissals":"x"}', 42]) {
    assert.deepEqual(parsePwaState(raw), empty, String(raw));
  }
  assert.deepEqual(parsePwaState('{"views":2.9,"played":true,"dismissals":1,"dismissedAt":5,"installed":true,"x":1}'), {
    views: 2,
    played: true,
    dismissals: 1,
    dismissedAt: 5,
    installed: true,
  });
});

test('engagement: a few page views or one game', () => {
  let s = parsePwaState(null);
  assert.equal(hasEngaged(s), false);
  for (let i = 0; i < MIN_VIEWS - 1; i += 1) s = recordView(s, '/');
  assert.equal(hasEngaged(s), false);
  s = recordView(s, '/memes');
  assert.equal(hasEngaged(s), true);
  assert.equal(hasEngaged(recordView(null, '/room/AB12C')), true, 'a game counts right away');
  let many = parsePwaState(null);
  for (let i = 0; i < 500; i += 1) many = recordView(many, '/');
  assert.equal(many.views, 99, 'the counter is capped');
});

test('a dismissed offer stays away for a while, then for good', () => {
  const now = 1_800_000_000_000;
  const once = recordDismissal(null, now);
  assert.equal(isSnoozed(once, now + 1000), true);
  assert.equal(isSnoozed(once, now + SNOOZE_MS + 1), false);
  let s = null;
  for (let i = 0; i < MAX_DISMISSALS; i += 1) s = recordDismissal(s, now);
  assert.equal(isSnoozed(s, now + 100 * SNOOZE_MS), true);
  assert.equal(isSnoozed(null, now), false);
});

test('when the install banner shows', () => {
  const now = 1_800_000_000_000;
  const engaged = { views: MIN_VIEWS, played: false, dismissals: 0, dismissedAt: 0, installed: false };
  assert.equal(shouldOfferInstall({ method: 'prompt', state: engaged, pathname: '/', now }), true);
  assert.equal(shouldOfferInstall({ method: 'ios', state: engaged, pathname: '/memes', now }), true);
  assert.equal(shouldOfferInstall({ method: 'manual', state: engaged, pathname: '/', now }), false, 'nothing to offer');
  assert.equal(shouldOfferInstall({ method: 'none', state: engaged, pathname: '/', now }), false, 'installed already');
  assert.equal(shouldOfferInstall({ method: 'prompt', state: null, pathname: '/', now }), false, 'first visit');
  assert.equal(shouldOfferInstall({ method: 'prompt', state: engaged, pathname: '/room/AB12C', now }), false, 'during a game');
  assert.equal(shouldOfferInstall({ method: 'prompt', state: engaged, pathname: '/play', now }), false, 'during matchmaking');
  assert.equal(shouldOfferInstall({ method: 'prompt', state: engaged, pathname: '/install', now }), false);
  assert.equal(shouldOfferInstall({ method: 'prompt', state: recordDismissal(engaged, now), pathname: '/', now: now + 5 }), false, 'dismissed');
  assert.equal(
    shouldOfferInstall({ method: 'prompt', state: recordDismissal(engaged, now), pathname: '/', now: now + SNOOZE_MS + 5 }),
    true,
    'after the snooze',
  );
  assert.equal(shouldOfferInstall({ method: 'ios', state: { ...engaged, installed: true }, pathname: '/', now }), false);
  assert.equal(shouldOfferInstall(), false);
});

test('"try again" on the offline page only leads to pages of this site', () => {
  const origin = 'https://laughtime.lol';
  assert.equal(retryTarget('https://laughtime.lol/room/AB12C', origin), '/room/AB12C');
  assert.equal(retryTarget('https://laughtime.lol/memes?sort=new#top', origin), '/memes?sort=new');
  assert.equal(retryTarget('https://laughtime.lol/offline', origin), '/');
  assert.equal(retryTarget('https://laughtime.lol/offline?from=%2Fleaderboard%3Fp%3D2', origin), '/leaderboard?p=2');
  assert.equal(retryTarget('https://laughtime.lol/offline?from=https%3A%2F%2Fevil.example', origin), '/');
  assert.equal(retryTarget('https://laughtime.lol/offline?from=%2F%2Fevil.example', origin), '/');
  assert.equal(retryTarget('https://laughtime.lol/offline?from=%2F%5Cevil.example', origin), '/');
  assert.equal(retryTarget('https://evil.example/x', origin), '/');
  assert.equal(retryTarget('', origin), '/');
  assert.equal(retryTarget('not a url', ''), '/');
});

test('every pwa text exists in English and German', () => {
  const en = Object.keys(pwaTexts.en).sort();
  const de = Object.keys(pwaTexts.de).sort();
  assert.deepEqual(de, en);
  assert.ok(en.length > 20);
  for (const key of en) {
    assert.match(key, /^pwa\./);
    assert.ok(pwaTexts.en[key].trim() && pwaTexts.de[key].trim(), key);
  }
});
