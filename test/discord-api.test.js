import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { resetOutbound } from '../server/lib/outbound.js';
import {
  DiscordError,
  activityInstanceUsers,
  discordApiUrl,
  exchangeCode,
  executeWebhook,
  fetchUser,
  parseWebhookUrl,
  resetDiscordCaches,
} from '../server/discord.js';

// A fake Discord API on 127.0.0.1 – DISCORD_API_URL points the client at it.
let server;
let hits = {};
let bodies = {};
let handlers = {};
const savedApiUrl = process.env.DISCORD_API_URL;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hits[path] = (hits[path] || 0) + 1;
      (bodies[path] ||= []).push({ method: req.method, headers: req.headers, text: Buffer.concat(chunks).toString(), url: req.url });
      const handler = handlers[path];
      if (handler) return handler(req, res, hits[path]);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"message":"404: Not Found"}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.DISCORD_API_URL = `http://127.0.0.1:${server.address().port}/api/`;
});

after(async () => {
  if (savedApiUrl === undefined) delete process.env.DISCORD_API_URL;
  else process.env.DISCORD_API_URL = savedApiUrl;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  hits = {};
  bodies = {};
  handlers = {};
  resetOutbound();
  resetDiscordCaches();
});

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const TOKEN = '/api/oauth2/token';
const ME = '/api/users/@me';
const instancePath = (id) => `/api/applications/123456789/activity-instances/${id}`;
const lookup = (instanceId, fresh = false) => activityInstanceUsers({ clientId: '123456789', botToken: 'bot-secret', instanceId, fresh });

test('api url: taken from DISCORD_API_URL without a trailing slash', () => {
  assert.match(discordApiUrl(), /^http:\/\/127\.0\.0\.1:\d+\/api$/);
});

test('token exchange: sends the code once and returns the token', async () => {
  handlers[TOKEN] = (req, res) => sendJson(res, 200, { access_token: 'at-1', scope: 'identify', expires_in: 604800 });
  const tok = await exchangeCode({ clientId: 'cid', clientSecret: 'secret', code: 'code-1', redirectUri: 'https://example.org/cb' });
  assert.equal(tok.access_token, 'at-1');
  assert.equal(hits[TOKEN], 1);
  const sent = bodies[TOKEN][0];
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers['content-type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(sent.text);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('client_id'), 'cid');
  assert.equal(form.get('client_secret'), 'secret');
  assert.equal(form.get('code'), 'code-1');
  assert.equal(form.get('redirect_uri'), 'https://example.org/cb');
});

test('token exchange: the activity flow sends no redirect uri', async () => {
  handlers[TOKEN] = (req, res) => sendJson(res, 200, { access_token: 'at-2' });
  await exchangeCode({ clientId: 'cid', clientSecret: 'secret', code: 'code-2' });
  assert.equal(new URLSearchParams(bodies[TOKEN][0].text).has('redirect_uri'), false);
});

test('token exchange: a refused code is not sent again', async () => {
  handlers[TOKEN] = (req, res) => sendJson(res, 400, { error: 'invalid_grant' });
  await assert.rejects(
    exchangeCode({ clientId: 'cid', clientSecret: 'secret', code: 'used' }),
    (err) => err instanceof DiscordError && err.status === 400,
  );
  assert.equal(hits[TOKEN], 1);
});

test('token exchange: a server error is not repeated (the code may be used up)', async () => {
  handlers[TOKEN] = (req, res) => sendJson(res, 502, {});
  await assert.rejects(exchangeCode({ clientId: 'cid', clientSecret: 'secret', code: 'c' }), (err) => err.status === 502);
  assert.equal(hits[TOKEN], 1);
});

test('token exchange: a dropped connection is not repeated and reports status 0', async () => {
  handlers[TOKEN] = (req) => req.socket.destroy();
  await assert.rejects(exchangeCode({ clientId: 'cid', clientSecret: 'secret', code: 'c' }), (err) => !err.status);
  assert.equal(hits[TOKEN], 1);
});

test('token exchange: repeated after a 429, once the pause is over', async () => {
  let firstAt = 0;
  let secondAt = 0;
  handlers[TOKEN] = (req, res, n) => {
    if (n === 1) {
      firstAt = Date.now();
      return sendJson(res, 429, { message: 'rate limited', retry_after: 0.12 }, { 'Retry-After': '0.12' });
    }
    secondAt = Date.now();
    return sendJson(res, 200, { access_token: 'at-3' });
  };
  const tok = await exchangeCode({ clientId: 'cid', clientSecret: 'secret', code: 'c' });
  assert.equal(tok.access_token, 'at-3');
  assert.equal(hits[TOKEN], 2);
  assert.ok(secondAt - firstAt >= 100, `waited ${secondAt - firstAt} ms before the second attempt`);
});

test('token exchange: gives up when the rate limit lasts too long', async () => {
  handlers[TOKEN] = (req, res) => sendJson(res, 429, {}, { 'Retry-After': '60' });
  await assert.rejects(exchangeCode({ clientId: 'cid', clientSecret: 'secret', code: 'c' }), (err) => err.status === 429);
  assert.equal(hits[TOKEN], 1);
});

test('token exchange: the same code at the same moment shares one request', async () => {
  handlers[TOKEN] = (req, res) => setTimeout(() => sendJson(res, 200, { access_token: 'at-4' }), 30);
  const args = { clientId: 'cid', clientSecret: 'secret', code: 'twice' };
  const [a, b] = await Promise.all([exchangeCode(args), exchangeCode(args)]);
  assert.equal(a.access_token, 'at-4');
  assert.equal(b.access_token, 'at-4');
  assert.equal(hits[TOKEN], 1);
});

test('token exchange: an answer without a token is an error', async () => {
  handlers[TOKEN] = (req, res) => sendJson(res, 200, { nope: true });
  await assert.rejects(exchangeCode({ clientId: 'cid', clientSecret: 'secret', code: 'c' }), DiscordError);
});

test('users/@me: sends the bearer token, repeats a failed GET', async () => {
  handlers[ME] = (req, res, n) => (n === 1 ? sendJson(res, 500, {}) : sendJson(res, 200, { id: '4242424242', username: 'tester' }));
  const profile = await fetchUser('at-9');
  assert.equal(profile.id, '4242424242');
  assert.equal(hits[ME], 2);
  assert.equal(bodies[ME][0].headers.authorization, 'Bearer at-9');
});

test('users/@me: a refused token reports Discord\'s status', async () => {
  handlers[ME] = (req, res) => sendJson(res, 401, { message: '401: Unauthorized' });
  await assert.rejects(fetchUser('bad'), (err) => err instanceof DiscordError && err.status === 401);
  assert.equal(hits[ME], 1);
});

test('activity instance: parallel lookups share one request and the answer is cached', async () => {
  const path = instancePath('i-abc');
  handlers[path] = (req, res) => setTimeout(() => sendJson(res, 200, { users: ['111111', 222222] }), 20);
  const results = await Promise.all([lookup('i-abc'), lookup('i-abc'), lookup('i-abc'), lookup('i-abc')]);
  assert.equal(hits[path], 1);
  for (const users of results) assert.deepEqual([...users], ['111111', '222222']);
  assert.equal(bodies[path][0].headers.authorization, 'Bot bot-secret');

  const again = await lookup('i-abc');
  assert.ok(again.has('111111'));
  assert.equal(hits[path], 1, 'second lookup comes from the cache');

  // "fresh" accepts an answer that is only a moment old – no request per click
  await lookup('i-abc', true);
  assert.equal(hits[path], 1);
});

test('activity instance: a fresh lookup asks again when the answer is older than the gap', async (t) => {
  const path = instancePath('i-old');
  let users = ['111111'];
  handlers[path] = (req, res) => sendJson(res, 200, { users });
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  assert.equal((await lookup('i-old')).has('222222'), false);
  users = ['111111', '222222'];
  t.mock.timers.tick(2500);
  assert.equal((await lookup('i-old')).has('222222'), false, 'the normal lookup still uses the cache');
  assert.equal((await lookup('i-old', true)).has('222222'), true, 'the fresh lookup asked Discord');
  assert.equal(hits[path], 2);
  t.mock.timers.tick(31_000);
  await lookup('i-old');
  assert.equal(hits[path], 3, 'the cache expires after 30 s');
});

test('activity instance: unknown instances are remembered for a moment', async (t) => {
  const path = instancePath('i-gone');
  assert.equal(await lookup('i-gone'), null);
  assert.equal(await lookup('i-gone'), null);
  assert.equal(await lookup('i-gone', true), null);
  assert.equal(hits[path], 1);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.timers.tick(3500);
  handlers[path] = (req, res) => sendJson(res, 200, { users: ['111111'] });
  assert.ok((await lookup('i-gone')).has('111111'), 'asked again after the short negative ttl');
  assert.equal(hits[path], 2);
});

test('activity instance: instances are cached separately', async () => {
  handlers[instancePath('i-one')] = (req, res) => sendJson(res, 200, { users: ['111111'] });
  handlers[instancePath('i-two')] = (req, res) => sendJson(res, 200, { users: ['222222'] });
  assert.ok((await lookup('i-one')).has('111111'));
  assert.ok((await lookup('i-two')).has('222222'));
  assert.equal((await lookup('i-two')).has('111111'), false);
});

test('activity instance: a refused bot token is not asked again right away', async () => {
  const path = instancePath('i-denied');
  handlers[path] = (req, res) => sendJson(res, 401, { message: '401: Unauthorized' });
  await assert.rejects(lookup('i-denied'), (err) => err instanceof DiscordError && err.status === 401);
  await assert.rejects(lookup('i-denied'), (err) => err instanceof DiscordError && err.status === 401);
  await assert.rejects(lookup('i-denied', true), DiscordError);
  assert.equal(hits[path], 1);
});

test('activity instance: a 429 pauses, then the lookup succeeds', async () => {
  const path = instancePath('i-limited');
  handlers[path] = (req, res, n) =>
    n === 1 ? sendJson(res, 429, { retry_after: 0.05 }, { 'Retry-After': '0.05' }) : sendJson(res, 200, { users: ['111111'] });
  assert.ok((await lookup('i-limited')).has('111111'));
  assert.equal(hits[path], 2);
});

test('webhook url: only real Discord webhooks are accepted', () => {
  const id = '123456789012345678';
  const token = 'abcDEF123-_abcDEF123-_abcDEF123-_abcDEF123-_abcDEF123-_abcDEF12345678';
  for (const host of ['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com', 'ptb.discordapp.com', 'canary.discordapp.com']) {
    assert.deepEqual(parseWebhookUrl(`https://${host}/api/webhooks/${id}/${token}`), { id, token, threadId: null }, host);
  }
  assert.deepEqual(parseWebhookUrl(`  https://discord.com/api/v10/webhooks/${id}/${token}/  `), { id, token, threadId: null });
  assert.equal(parseWebhookUrl(`https://discord.com/api/webhooks/${id}/${token}?thread_id=998877665544332211`).threadId, '998877665544332211');
  assert.equal(parseWebhookUrl(`https://discord.com/api/webhooks/${id}/${token}?thread_id=abc`).threadId, null);

  const bad = [
    '',
    null,
    'not a url',
    `http://discord.com/api/webhooks/${id}/${token}`,
    `https://example.org/api/webhooks/${id}/${token}`,
    `https://discord.com.example.org/api/webhooks/${id}/${token}`,
    `https://evil-discord.com/api/webhooks/${id}/${token}`,
    `https://discord.com@example.org/api/webhooks/${id}/${token}`,
    `https://user:pw@discord.com/api/webhooks/${id}/${token}`,
    `https://discord.com:8443/api/webhooks/${id}/${token}`,
    `https://discord.com/api/webhooks/${id}/${token}/github`,
    `https://discord.com/api/webhooks/${id}/${token}/../../users/@me`,
    `https://discord.com/api/webhooks/abc/${token}`,
    `https://discord.com/api/webhooks/${id}/short`,
    `https://discord.com/api/webhooks/${id}`,
    `https://discord.com/api/channels/${id}/messages`,
    `https://127.0.0.1/api/webhooks/${id}/${token}`,
    `javascript:alert(1)//discord.com/api/webhooks/${id}/${token}`,
  ];
  for (const value of bad) assert.equal(parseWebhookUrl(value), null, String(value));
});

test('webhook: posts once, pings nobody, and reports failures without the token', async () => {
  const hook = { id: '123456789012345678', token: 'tok_tok_tok_tok_tok_tok_tok', threadId: null };
  const path = `/api/webhooks/${hook.id}/${hook.token}`;
  handlers[path] = (req, res) => {
    res.writeHead(204);
    res.end();
  };
  await executeWebhook(hook, { content: 'hello @everyone' });
  assert.equal(hits[path], 1);
  const sent = JSON.parse(bodies[path][0].text);
  assert.equal(sent.content, 'hello @everyone');
  assert.deepEqual(sent.allowed_mentions, { parse: [] });

  handlers[path] = (req, res) => sendJson(res, 500, {});
  await assert.rejects(executeWebhook(hook, { content: 'x' }), (err) => err.status === 500 && !err.message.includes(hook.token));
  assert.equal(hits[path], 2, 'a failed POST is not repeated');

  handlers[path] = (req) => req.socket.destroy();
  await assert.rejects(executeWebhook(hook, { content: 'x' }), (err) => !err.status && !err.message.includes(hook.token));

  await assert.rejects(executeWebhook(null, { content: 'x' }), DiscordError);
});

test('webhook: thread id travels as a query parameter', async () => {
  const hook = { id: '123456789012345678', token: 'tok_tok_tok_tok_tok_tok_tok', threadId: '998877665544332211' };
  const path = `/api/webhooks/${hook.id}/${hook.token}`;
  handlers[path] = (req, res) => {
    res.writeHead(204);
    res.end();
  };
  await executeWebhook(hook, { content: 'x' });
  assert.match(bodies[path][0].url, /\?thread_id=998877665544332211$/);
});
