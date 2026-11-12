import assert from 'node:assert/strict';
import http from 'node:http';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { resetOutbound } from '../server/lib/outbound.js';
import {
  createModNotifier,
  moderatorMessage,
  notifyModerators,
  resetWebhooks,
  sendAnnouncement,
  sendModeratorTest,
  webhookStatus,
} from '../server/webhook.js';

const HOOK_ID = '123456789012345678';
const HOOK_TOKEN = 'abcDEF123-_abcDEF123-_abcDEF123-_abcDEF123-_abcDEF123-_abcDEF12345678';
const HOOK_URL = `https://discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`;
const HOOK_PATH = `/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`;
const ENV_KEYS = ['DISCORD_API_URL', 'DISCORD_WEBHOOK_URL', 'DISCORD_MOD_WEBHOOK_URL', 'DISCORD_WEBHOOK_LANG'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

// fake Discord API: the webhook URL only names id and token, the request goes to DISCORD_API_URL
let server;
let received = [];
let respond = null;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString() });
      if (respond) return respond(req, res);
      res.writeHead(204);
      return res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await new Promise((resolve) => server.close(resolve));
});

let warnings = [];
const realWarn = console.warn;

beforeEach(() => {
  received = [];
  respond = null;
  warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  resetOutbound();
  resetWebhooks();
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.DISCORD_API_URL = `http://127.0.0.1:${server.address().port}/api`;
});

afterEach(() => {
  console.warn = realWarn;
  resetWebhooks();
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('announcement: off by default, nothing is sent', async () => {
  assert.deepEqual(webhookStatus(), { announcements: false, moderators: false });
  assert.deepEqual(await sendAnnouncement({ title: 'Hello', text: 'World' }), { ok: false, reason: 'not_configured' });
  assert.equal(received.length, 0);
  assert.equal(warnings.length, 0);
});

test('announcement: an embed in the brand colour goes to the configured webhook', async () => {
  process.env.DISCORD_WEBHOOK_URL = HOOK_URL;
  const result = await sendAnnouncement({ title: '  LaughTime v2 is live  ', text: 'New game modes!\r\nHave fun.', url: 'https://laughtime.lol/news' });
  assert.deepEqual(result, { ok: true });
  assert.equal(received.length, 1);
  assert.equal(received[0].method, 'POST');
  assert.equal(received[0].path, HOOK_PATH);
  const payload = JSON.parse(received[0].body);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.embeds.length, 1);
  assert.deepEqual(payload.embeds[0], {
    title: 'LaughTime v2 is live',
    url: 'https://laughtime.lol/news',
    color: 0xffd23f,
    description: 'New game modes!\nHave fun.',
  });
});

test('announcement: needs a title, falls back to the public url, cuts long texts', async () => {
  process.env.DISCORD_WEBHOOK_URL = HOOK_URL;
  assert.deepEqual(await sendAnnouncement({ title: '   ', text: 'x' }), { ok: false, reason: 'invalid_input' });
  assert.deepEqual(await sendAnnouncement(), { ok: false, reason: 'invalid_input' });
  assert.equal(received.length, 0);

  await sendAnnouncement({ title: 'T'.repeat(400), text: 'x'.repeat(5000), url: 'javascript:alert(1)' });
  const embed = JSON.parse(received[0].body).embeds[0];
  assert.equal(embed.title.length, 256);
  assert.equal(embed.description.length, 4000);
  assert.match(embed.url, /^https?:\/\//);
});

test('announcement: a URL that is not a Discord webhook is never called', async () => {
  for (const url of [`http://127.0.0.1:${server.address().port}${HOOK_PATH}`, `https://example.org${HOOK_PATH}`, 'nonsense']) {
    process.env.DISCORD_WEBHOOK_URL = url;
    assert.deepEqual(await sendAnnouncement({ title: 'Hello' }), { ok: false, reason: 'invalid_url' });
  }
  assert.equal(received.length, 0);
  assert.equal(warnings.length, 1, 'the problem is logged once');
  assert.ok(warnings[0].includes('DISCORD_WEBHOOK_URL'));
  assert.ok(!warnings[0].includes('example.org') && !warnings[0].includes(HOOK_TOKEN), 'the value is never printed');
});

test('announcement: fails silently when Discord is down and logs it once', async () => {
  process.env.DISCORD_WEBHOOK_URL = HOOK_URL;
  respond = (req, res) => {
    res.writeHead(503);
    res.end();
  };
  assert.deepEqual(await sendAnnouncement({ title: 'One' }), { ok: false, reason: 'failed', status: 503 });
  assert.deepEqual(await sendAnnouncement({ title: 'Two' }), { ok: false, reason: 'failed', status: 503 });
  assert.equal(received.length, 2, 'a failed POST is not repeated by itself');
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes(HOOK_TOKEN));

  // works again: the next failure would be logged again
  respond = null;
  assert.deepEqual(await sendAnnouncement({ title: 'Three' }), { ok: true });
  respond = (req) => req.socket.destroy();
  assert.equal((await sendAnnouncement({ title: 'Four' })).ok, false);
  assert.equal(warnings.length, 2);
  assert.ok(!warnings[1].includes(HOOK_TOKEN));
});

test('moderator message: only counts, reason categories and the admin link', () => {
  const message = moderatorMessage(
    { report: { total: 3, reasons: new Map([['spam', 1], ['harassment', 2]]) }, pack_review: { total: 1, reasons: new Map() } },
    { language: 'en', adminUrl: 'https://laughtime.lol/admin' },
  );
  assert.equal(message.embeds.length, 1);
  const embed = message.embeds[0];
  assert.equal(embed.url, 'https://laughtime.lol/admin');
  assert.equal(embed.color, 0xff4fa3);
  assert.equal(
    embed.description,
    '3 new reports (2× Insults or harassment, 1× Spam or advertising)\n1 pack is waiting for a review\n\n[Open the admin area](https://laughtime.lol/admin)',
  );
  assert.deepEqual(Object.keys(embed).sort(), ['color', 'description', 'title', 'url']);

  const german = moderatorMessage({ report: { total: 1, reasons: new Map([['other', 1]]) } }, { language: 'de', adminUrl: 'https://laughtime.lol/admin' });
  assert.match(german.embeds[0].description, /^1 neue Meldung \(1× Etwas anderes\)/);
});

test('report coalescing: a burst becomes one message with a count', async () => {
  const sent = [];
  const notifier = createModNotifier({ send: async (batch) => sent.push(batch), intervalMs: 120, settleMs: 25 });
  notifier.notify('report', 'spam');
  notifier.notify('report', 'spam');
  notifier.notify('report', 'meme');
  notifier.notify('pack_review');
  notifier.notify('report', 'made-up-reason');
  notifier.notify('something-else');
  assert.equal(sent.length, 0, 'nothing is sent right away');
  assert.equal(notifier.pending(), 5);
  await wait(60);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].report.total, 4);
  assert.deepEqual([...sent[0].report.reasons].sort(), [['meme', 1], ['other', 1], ['spam', 2]]);
  assert.equal(sent[0].pack_review.total, 1);
  assert.equal(notifier.pending(), 0);
  notifier.stop();
});

test('report coalescing: at most one message per interval', async () => {
  const sent = [];
  const notifier = createModNotifier({ send: async (batch) => sent.push({ at: Date.now(), batch }), intervalMs: 150, settleMs: 10 });
  notifier.notify('report', 'spam');
  await wait(40);
  assert.equal(sent.length, 1);
  // more reports right after the first message: they wait for the interval
  notifier.notify('report', 'name');
  await wait(30);
  notifier.notify('report', 'name');
  await wait(40);
  assert.equal(sent.length, 1, 'still inside the interval');
  await wait(120);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].batch.report.total, 2);
  assert.ok(sent[1].at - sent[0].at >= 140, `gap was ${sent[1].at - sent[0].at} ms`);
  await wait(200);
  assert.equal(sent.length, 2, 'nothing new: no further message');
  notifier.stop();
});

test('report coalescing: a failed delivery is added to the next message, then dropped', async () => {
  const attempts = [];
  let fail = true;
  const notifier = createModNotifier({
    send: async (batch) => {
      attempts.push(batch.report.total);
      return !fail;
    },
    intervalMs: 40,
    settleMs: 5,
    maxFailures: 3,
  });
  notifier.notify('report', 'spam');
  await wait(25);
  assert.deepEqual(attempts, [1]);
  assert.equal(notifier.pending(), 1, 'kept for the next message');
  notifier.notify('report', 'meme');
  await wait(50);
  assert.deepEqual(attempts, [1, 2]);
  await wait(60);
  assert.deepEqual(attempts, [1, 2, 2], 'third failure in a row');
  assert.equal(notifier.pending(), 0, 'given up: the numbers are dropped');
  await wait(80);
  assert.equal(attempts.length, 3, 'no endless retries');

  fail = false;
  notifier.notify('report', 'spam');
  await wait(70);
  assert.deepEqual(attempts, [1, 2, 2, 1]);
  notifier.stop();
});

test('report coalescing: stop() cancels the waiting message', async () => {
  const sent = [];
  const notifier = createModNotifier({ send: async (batch) => sent.push(batch), intervalMs: 50, settleMs: 20 });
  notifier.notify('report', 'spam');
  notifier.stop();
  await wait(50);
  assert.equal(sent.length, 0);
});

test('moderators: nothing happens without DISCORD_MOD_WEBHOOK_URL', async () => {
  notifyModerators('report', 'spam');
  notifyModerators('pack_review');
  assert.deepEqual(await sendModeratorTest(), { ok: false, reason: 'not_configured' });
  assert.equal(received.length, 0);
});

test('moderators: the test message reaches the moderators\' webhook only', async () => {
  process.env.DISCORD_MOD_WEBHOOK_URL = HOOK_URL;
  process.env.DISCORD_WEBHOOK_LANG = 'de';
  assert.deepEqual(webhookStatus(), { announcements: false, moderators: true });
  assert.deepEqual(await sendModeratorTest(), { ok: true });
  assert.equal(received.length, 1);
  assert.equal(received[0].path, HOOK_PATH);
  const embed = JSON.parse(received[0].body).embeds[0];
  assert.equal(embed.title, 'Neue Arbeit im Admin-Bereich');
  assert.match(embed.url, /\/admin$/);
});
