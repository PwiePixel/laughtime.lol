import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { beforeEach, test } from 'node:test';

process.env.PUBLIC_URL = 'https://laughtime.lol';
process.env.TRUST_PROXY = 'true';
process.env.ADMIN_USERNAMES = 'boss';
process.env.DISCORD_CLIENT_ID = '424242';
process.env.DISCORD_CLIENT_SECRET = 'secret';
delete process.env.ACTIVITY_ENABLED;

const { handleBetaApi, loginHandover, loginReturn, redeemLoginHandover } = await import('../server/beta.js');
const { HttpError } = await import('../server/http.js');

const player = { id: 7, username: 'player', is_admin: 0 };
const boss = { id: 1, username: 'boss', is_admin: 0 };
let ipCounter = 0;

function request({ method = 'GET', headers = {}, body } = {}) {
  const req = body === undefined ? Readable.from([]) : Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = { host: 'laughtime.lol', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers };
  req.socket = {};
  return req;
}

function response() {
  return {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
    },
    end(text) {
      this.body = text ? JSON.parse(text) : null;
    },
  };
}

/** runs one route the way handleApi does; a fresh IP per call keeps the rate limiter out of the way */
async function call(path, { method = 'GET', headers, body, user = null, secure = false, activity = false, ip = `10.0.0.${++ipCounter}` } = {}) {
  const req = request({ method, headers, body });
  const res = response();
  const handled = await handleBetaApi(req, res, { ip, user, secure, activity }, path, method);
  return { handled, res };
}

const rejects = (promise, status, code) =>
  assert.rejects(promise, (err) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });

beforeEach(() => {
  for (const key of ['BETA_ENABLED', 'BETA_HOSTS', 'BETA_ACCESS', 'FEATURE_FLAGS', 'BETA_FEEDBACK_URL']) delete process.env[key];
});

test('GET /api/beta describes the beta for a stable visitor', async () => {
  process.env.BETA_FEEDBACK_URL = 'https://discord.gg/example';
  const { handled, res } = await call('/api/beta');
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.equal(res.body.channel, 'stable');
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.access, 'open');
  assert.equal(res.body.mayJoin, true);
  assert.equal(res.body.optedIn, false);
  assert.equal(res.body.onBetaHost, false);
  assert.equal(res.body.mainUrl, 'https://laughtime.lol');
  assert.equal(res.body.feedbackUrl, 'https://discord.gg/example');
  assert.match(res.body.version, /^\d+\.\d+\.\d+/);
  assert.deepEqual(res.body.features.find((f) => f.key === 'liveStatus'), { key: 'liveStatus', enabled: false });
  assert.ok(Array.isArray(res.body.modes));
});

test('GET /api/beta on the beta host and with the opt-in', async () => {
  const onHost = await call('/api/beta', { headers: { host: 'beta.laughtime.lol' } });
  assert.equal(onHost.res.body.channel, 'beta');
  assert.equal(onHost.res.body.onBetaHost, true);
  assert.equal(onHost.res.body.features.find((f) => f.key === 'liveStatus').enabled, true);
  const optedIn = await call('/api/beta', { headers: { cookie: 'lt_beta=1' } });
  assert.equal(optedIn.res.body.channel, 'beta');
  assert.equal(optedIn.res.body.optedIn, true);
  assert.equal(optedIn.res.body.onBetaHost, false);
});

test('a promoted feature leaves the beta list', async () => {
  process.env.FEATURE_FLAGS = 'liveStatus=stable';
  const { res } = await call('/api/beta');
  assert.equal(res.body.features.some((f) => f.key === 'liveStatus'), false);
});

test('POST /api/beta sets the opt-in cookie for one year', async () => {
  const { res } = await call('/api/beta', { method: 'POST', body: { on: true } });
  assert.equal(res.status, 200);
  assert.equal(res.body.channel, 'beta');
  assert.equal(res.body.optedIn, true);
  assert.equal(res.headers['Set-Cookie'], 'lt_beta=1; Path=/; SameSite=Lax; Max-Age=31536000; HttpOnly');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('POST /api/beta marks the cookie Secure on https', async () => {
  const { res } = await call('/api/beta', { method: 'POST', body: { on: true }, secure: true });
  assert.equal(res.headers['Set-Cookie'], 'lt_beta=1; Path=/; SameSite=Lax; Max-Age=31536000; HttpOnly; Secure');
});

test('POST /api/beta { on: false } clears the cookie', async () => {
  const { res } = await call('/api/beta', { method: 'POST', body: { on: false }, headers: { cookie: 'lt_beta=1' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.channel, 'stable');
  assert.equal(res.body.optedIn, false);
  assert.equal(res.headers['Set-Cookie'], 'lt_beta=; Path=/; SameSite=Lax; Max-Age=0; HttpOnly');
});

test('leaving on the beta host clears the cookie but the host stays beta', async () => {
  const { res } = await call('/api/beta', { method: 'POST', body: { on: false }, headers: { host: 'beta.laughtime.lol', cookie: 'lt_beta=1' } });
  assert.equal(res.body.channel, 'beta');
  assert.equal(res.body.onBetaHost, true);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
});

test('POST /api/beta wants { on: true | false } as JSON', async () => {
  await rejects(call('/api/beta', { method: 'POST', body: { on: 'yes' } }), 400, 'bad_request');
  await rejects(call('/api/beta', { method: 'POST', body: {} }), 400, 'bad_request');
  await rejects(call('/api/beta', { method: 'POST', body: { on: true }, headers: { 'content-type': 'text/plain' } }), 415, 'json_required');
});

test('POST /api/beta respects BETA_ACCESS', async () => {
  process.env.BETA_ACCESS = 'accounts';
  await rejects(call('/api/beta', { method: 'POST', body: { on: true } }), 401, 'login_required');
  const joined = await call('/api/beta', { method: 'POST', body: { on: true }, user: player });
  assert.equal(joined.res.body.channel, 'beta');
  assert.match(joined.res.headers['Set-Cookie'], /^lt_beta=1;/);

  process.env.BETA_ACCESS = 'admins';
  await rejects(call('/api/beta', { method: 'POST', body: { on: true } }), 401, 'login_required');
  await rejects(call('/api/beta', { method: 'POST', body: { on: true }, user: player }), 403, 'beta_restricted');
  const team = await call('/api/beta', { method: 'POST', body: { on: true }, user: boss });
  assert.equal(team.res.body.channel, 'beta');
  // the page learns that this visitor may not join
  const info = await call('/api/beta', { user: player });
  assert.equal(info.res.body.mayJoin, false);
  assert.equal(info.res.body.access, 'admins');
  // leaving is always allowed
  const left = await call('/api/beta', { method: 'POST', body: { on: false }, user: player });
  assert.equal(left.res.status, 200);
});

test('POST /api/beta: no joining while the beta is off or inside the Discord Activity', async () => {
  await rejects(
    call('/api/beta', { method: 'POST', body: { on: true }, activity: true, headers: { 'x-discord-proxy-payload': 'x' } }),
    409,
    'beta_unavailable',
  );
  process.env.BETA_ENABLED = 'false';
  await rejects(call('/api/beta', { method: 'POST', body: { on: true } }), 409, 'beta_disabled');
  const info = await call('/api/beta', { headers: { host: 'beta.laughtime.lol', cookie: 'lt_beta=1' } });
  assert.equal(info.res.body.enabled, false);
  assert.equal(info.res.body.channel, 'stable');
  assert.equal(info.res.body.mayJoin, false);
  assert.deepEqual(info.res.body.features, []);
});

test('POST /api/beta is rate limited per address', async () => {
  const ip = '10.9.9.9';
  for (let i = 0; i < 20; i++) await call('/api/beta', { method: 'POST', body: { on: i % 2 === 0 }, ip });
  await rejects(call('/api/beta', { method: 'POST', body: { on: true }, ip }), 429, 'too_many_attempts');
  // other visitors are not affected
  const other = await call('/api/beta', { method: 'POST', body: { on: true } });
  assert.equal(other.res.status, 200);
});

test('GET /api/beta/status only exists where the feature is on', async () => {
  await rejects(call('/api/beta/status'), 404, 'not_found');
  const { res } = await call('/api/beta/status', { headers: { cookie: 'lt_beta=1' } });
  assert.equal(res.status, 200);
  for (const key of ['players', 'rooms', 'playing', 'queued', 'uptime']) assert.equal(typeof res.body[key], 'number');
  assert.ok(Array.isArray(res.body.sources));
  process.env.FEATURE_FLAGS = 'liveStatus=off';
  await rejects(call('/api/beta/status', { headers: { cookie: 'lt_beta=1' } }), 404, 'not_found');
  process.env.FEATURE_FLAGS = 'liveStatus=stable';
  assert.equal((await call('/api/beta/status')).res.status, 200);
});

test('GET /api/beta/live is for admins', async () => {
  await rejects(call('/api/beta/live'), 401, 'login_required');
  await rejects(call('/api/beta/live', { user: player }), 403, 'forbidden');
  const { res } = await call('/api/beta/live', { user: boss });
  assert.deepEqual(res.body, { enabled: true, access: 'open', stable: { rooms: 0, players: 0 }, beta: { rooms: 0, players: 0 } });
});

test('other paths are left to the rest of the API', async () => {
  assert.equal((await call('/api/betamax')).handled, false);
  assert.equal((await call('/api/beta', { method: 'DELETE' })).handled, false);
});

// --- Discord login hand-over -------------------------------------------------

const REDIRECT_URI = 'https://laughtime.lol/api/auth/discord/callback';
const identity = { discordId: '123', discordName: 'Tester', username: 'tester', linkUserId: null };

function handOver(state = 'state-abc') {
  const back = loginReturn(request({ headers: { host: 'beta.laughtime.lol' } }), REDIRECT_URI);
  const res = response();
  loginHandover(res, back, state, identity);
  const location = new URL(res.headers.Location);
  return { res, location, code: location.searchParams.get('code') };
}
const onBeta = () => request({ headers: { host: 'beta.laughtime.lol' } });

test('hand-over: the login returns to the beta host with a one-time code', () => {
  const { res, location, code } = handOver();
  assert.equal(res.status, 302);
  assert.equal(location.origin, 'https://beta.laughtime.lol');
  assert.equal(location.pathname, '/api/auth/handover');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.ok(code.length >= 40);
  assert.deepEqual(redeemLoginHandover(onBeta(), code, 'state-abc'), identity);
  // a code works once
  assert.equal(redeemLoginHandover(onBeta(), code, 'state-abc'), null);
});

test('hand-over: useless without the state cookie of the browser that started the login', () => {
  const first = handOver();
  assert.equal(redeemLoginHandover(onBeta(), first.code, undefined), null);
  // the failed attempt used the code up
  assert.equal(redeemLoginHandover(onBeta(), first.code, 'state-abc'), null);
  const second = handOver();
  assert.equal(redeemLoginHandover(onBeta(), second.code, 'state-xyz'), null);
  const third = handOver('');
  assert.equal(redeemLoginHandover(onBeta(), third.code, ''), null);
});

test('hand-over: only on the host the login was started on', () => {
  const { code } = handOver();
  assert.equal(redeemLoginHandover(request(), code, 'state-abc'), null);
  assert.equal(redeemLoginHandover(onBeta(), code, 'state-abc'), null);
});

test('hand-over: unknown and empty codes', () => {
  assert.equal(redeemLoginHandover(onBeta(), 'nope', 'state-abc'), null);
  assert.equal(redeemLoginHandover(onBeta(), '', 'state-abc'), null);
  assert.equal(redeemLoginHandover(onBeta(), null, 'state-abc'), null);
});

test('hand-over: codes expire after a minute', (t) => {
  const { code } = handOver();
  const later = Date.now() + 61_000;
  t.mock.method(Date, 'now', () => later);
  assert.equal(redeemLoginHandover(onBeta(), code, 'state-abc'), null);
});
