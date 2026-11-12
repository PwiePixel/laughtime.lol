import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

// settings of this test instance – set before the server modules read them
process.env.PUBLIC_URL = 'https://laughtime.lol';
process.env.TRUST_PROXY = 'true';
process.env.ADMIN_USERNAMES = 'boss';
process.env.DISCORD_CLIENT_ID = '424242';
process.env.DISCORD_CLIENT_SECRET = 'secret';
delete process.env.ACTIVITY_ENABLED;

const {
  CHANNEL_HEADER,
  GATE_HEADER,
  betaSettingsWarnings,
  isBetaHost,
  loginReturn,
  markBetaHost,
  ownHosts,
  requestBeta,
  requestChannel,
  requestFeatures,
  requestHasFeature,
  requestHostName,
  tagRequest,
} = await import('../server/channel.js');
const { checkOrigin } = await import('../server/http.js');

const request = (headers = {}) => ({ headers: { host: 'laughtime.lol', ...headers }, socket: {} });
const player = { id: 7, username: 'player', is_admin: 0 };
const boss = { id: 1, username: 'Boss', is_admin: 0 };

beforeEach(() => {
  for (const key of ['BETA_ENABLED', 'BETA_HOSTS', 'BETA_ACCESS', 'FEATURE_FLAGS', 'BETA_FEEDBACK_URL']) delete process.env[key];
});

test('main host is stable, beta host is beta', () => {
  assert.equal(requestChannel(request()), 'stable');
  assert.equal(requestChannel(request({ host: 'beta.laughtime.lol' })), 'beta');
  assert.equal(requestChannel(request({ host: 'Beta.LaughTime.lol:443' })), 'beta');
  assert.equal(isBetaHost(request({ host: 'beta.laughtime.lol' })), true);
  assert.equal(isBetaHost(request()), false);
});

test('forwarded host: believed behind the proxy, ignored without TRUST_PROXY', () => {
  const req = request({ 'x-forwarded-host': 'beta.laughtime.lol' });
  assert.equal(requestHostName(req, true), 'beta.laughtime.lol');
  assert.equal(requestHostName(req, false), 'laughtime.lol');
  assert.equal(requestChannel(req), 'beta'); // TRUST_PROXY=true in this test
});

test('the opt-in cookie switches the main host to beta', () => {
  assert.equal(requestChannel(request({ cookie: 'lt_lang=de; lt_beta=1' })), 'beta');
  assert.equal(requestChannel(request({ cookie: 'lt_beta=0' })), 'stable');
  assert.equal(requestChannel(request({ cookie: 'lt_beta=true' })), 'stable');
});

test('BETA_ENABLED=false: stable everywhere', () => {
  process.env.BETA_ENABLED = 'false';
  assert.equal(requestChannel(request({ host: 'beta.laughtime.lol', cookie: 'lt_beta=1' })), 'stable');
  assert.equal(requestBeta(request({ host: 'beta.laughtime.lol' })).gate, null);
});

test('BETA_HOSTS replaces the derived host', () => {
  process.env.BETA_HOSTS = 'next.laughtime.lol, preview.example.org';
  assert.equal(requestChannel(request({ host: 'next.laughtime.lol' })), 'beta');
  assert.equal(requestChannel(request({ host: 'preview.example.org' })), 'beta');
  assert.equal(requestChannel(request({ host: 'beta.laughtime.lol' })), 'stable');
});

test('BETA_ACCESS=accounts: guests stay on stable, players get the beta', () => {
  process.env.BETA_ACCESS = 'accounts';
  const optedIn = () => request({ cookie: 'lt_beta=1' });
  assert.equal(requestBeta(optedIn(), null).channel, 'stable');
  assert.equal(requestBeta(optedIn(), player).channel, 'beta');
  // a guest without a session cookie needs no database lookup
  assert.equal(requestChannel(optedIn()), 'stable');
  const onHost = () => request({ host: 'beta.laughtime.lol' });
  assert.equal(requestBeta(onHost(), null).gate, 'accounts');
  assert.equal(requestBeta(onHost(), player).gate, null);
  assert.equal(requestBeta(onHost(), player).channel, 'beta');
});

test('BETA_ACCESS=admins: only ADMIN_USERNAMES', () => {
  process.env.BETA_ACCESS = 'admins';
  const onHost = () => request({ host: 'beta.laughtime.lol' });
  assert.equal(requestBeta(onHost(), player).channel, 'stable');
  assert.equal(requestBeta(onHost(), player).gate, 'admins');
  assert.equal(requestBeta(onHost(), boss).channel, 'beta');
  assert.equal(requestBeta(onHost(), { ...player, is_admin: 1 }).channel, 'beta');
  assert.equal(requestBeta(request({ cookie: 'lt_beta=1' }), boss).channel, 'beta');
  assert.equal(requestBeta(request({ cookie: 'lt_beta=1' }), player).gate, null);
});

test('Discord Activity requests stay on stable and are never gated', () => {
  process.env.BETA_ACCESS = 'admins';
  const viaProxy = request({ host: 'beta.laughtime.lol', cookie: 'lt_beta=1', 'x-discord-proxy-payload': 'x' });
  assert.equal(requestBeta(viaProxy, boss).channel, 'stable');
  assert.equal(requestBeta(viaProxy, boss).gate, null);
  const fromFrame = request({ host: 'beta.laughtime.lol', origin: 'https://424242.discordsays.com' });
  assert.equal(requestBeta(fromFrame, boss).channel, 'stable');
});

test('features of a request follow its channel and FEATURE_FLAGS', () => {
  assert.equal(requestHasFeature(request(), 'liveStatus'), false);
  assert.equal(requestHasFeature(request({ cookie: 'lt_beta=1' }), 'liveStatus'), true);
  assert.ok(requestFeatures(request({ host: 'beta.laughtime.lol' })).includes('liveStatus'));
  process.env.FEATURE_FLAGS = 'liveStatus=stable';
  assert.equal(requestHasFeature(request(), 'liveStatus'), true);
  process.env.FEATURE_FLAGS = 'liveStatus=off';
  assert.equal(requestHasFeature(request({ host: 'beta.laughtime.lol' }), 'liveStatus'), false);
  process.env.FEATURE_FLAGS = 'liveStatus=nonsense';
  assert.equal(requestHasFeature(request({ host: 'beta.laughtime.lol' }), 'liveStatus'), true);
});

test('the layout gets the decision through headers a visitor cannot forge', () => {
  const forged = request({ [CHANNEL_HEADER]: 'beta', [GATE_HEADER]: 'admins' });
  tagRequest(forged);
  assert.equal(forged.headers[CHANNEL_HEADER], 'stable');
  assert.equal(GATE_HEADER in forged.headers, false);

  process.env.BETA_ACCESS = 'accounts';
  const gated = request({ host: 'beta.laughtime.lol' });
  tagRequest(gated);
  assert.equal(gated.headers[CHANNEL_HEADER], 'stable');
  assert.equal(gated.headers[GATE_HEADER], 'accounts');
});

test('beta hosts are marked noindex, the main host is not', () => {
  const headersOf = (req) => {
    const headers = {};
    markBetaHost(req, { setHeader: (k, v) => (headers[k] = v) });
    return headers;
  };
  assert.deepEqual(headersOf(request({ host: 'beta.laughtime.lol' })), { 'X-Robots-Tag': 'noindex' });
  assert.deepEqual(headersOf(request()), {});
  // the opt-in does not change what search engines see
  assert.deepEqual(headersOf(request({ cookie: 'lt_beta=1' })), {});
  // still not indexable while the beta is switched off
  process.env.BETA_ENABLED = 'false';
  assert.deepEqual(headersOf(request({ host: 'beta.laughtime.lol' })), { 'X-Robots-Tag': 'noindex' });
});

test('POST origin check works the same on both hosts', () => {
  const post = (origin, host) => () => checkOrigin(request({ origin, host }));
  assert.doesNotThrow(post('https://laughtime.lol', 'laughtime.lol'));
  assert.doesNotThrow(post('https://beta.laughtime.lol', 'beta.laughtime.lol'));
  assert.throws(post('https://beta.laughtime.lol', 'laughtime.lol'), /bad_origin/);
  assert.throws(post('https://laughtime.lol', 'beta.laughtime.lol'), /bad_origin/);
  assert.throws(post('https://evil.example', 'beta.laughtime.lol'), /bad_origin/);
});

test('Discord login: only our own hosts get the login handed back', () => {
  const redirectUri = 'https://laughtime.lol/api/auth/discord/callback';
  assert.deepEqual([...ownHosts()].sort(), ['beta.laughtime.lol', 'laughtime.lol']);
  // started on the host of the redirect URI: the normal flow
  assert.equal(loginReturn(request(), redirectUri), null);
  assert.deepEqual(loginReturn(request({ host: 'Beta.LaughTime.lol' }), redirectUri), {
    host: 'beta.laughtime.lol',
    origin: 'https://beta.laughtime.lol',
  });
  // foreign and look-alike hosts are never a redirect target
  assert.equal(loginReturn(request({ host: 'evil.example' }), redirectUri), null);
  assert.equal(loginReturn(request({ host: 'beta.laughtime.lol.evil.example' }), redirectUri), null);
  assert.equal(loginReturn(request({ host: 'laughtime.lol', 'x-forwarded-host': 'evil.example' }), redirectUri), null);
  assert.equal(loginReturn(request({ host: 'beta.laughtime.lol' }), 'not a url'), null);
  // scheme and port come from the redirect URI, never from the request
  assert.deepEqual(loginReturn(request({ host: 'beta.laughtime.lol:9999' }), 'http://laughtime.lol:3000/api/auth/discord/callback'), {
    host: 'beta.laughtime.lol',
    origin: 'http://beta.laughtime.lol:3000',
  });
  // redirect URI on the beta host: logins from the main host are handed back
  assert.deepEqual(loginReturn(request(), 'https://beta.laughtime.lol/api/auth/discord/callback'), {
    host: 'laughtime.lol',
    origin: 'https://laughtime.lol',
  });
});

test('start-up check names broken settings', () => {
  assert.deepEqual(betaSettingsWarnings({}), []);
  assert.deepEqual(betaSettingsWarnings({ BETA_ACCESS: 'admins', FEATURE_FLAGS: 'liveStatus=stable', BETA_FEEDBACK_URL: 'https://example.org' }), []);
  const warnings = betaSettingsWarnings({ BETA_ACCESS: 'friends', FEATURE_FLAGS: 'liveStatus=on,nope=off', BETA_FEEDBACK_URL: 'example.org' });
  assert.equal(warnings.length, 4);
  assert.match(warnings.join('\n'), /FEATURE_FLAGS.*unknown stage/);
  assert.match(warnings.join('\n'), /FEATURE_FLAGS.*unknown feature/);
  assert.match(warnings.join('\n'), /BETA_ACCESS "friends".*using "admins"/);
  assert.match(warnings.join('\n'), /BETA_FEEDBACK_URL/);
});
