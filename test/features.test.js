import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FEATURES,
  betaAccessFromEnv,
  betaEnabledFromEnv,
  betaFeatures,
  betaHostsFromEnv,
  enabledFeatures,
  featureEnabled,
  featureStage,
  feedbackUrlFromEnv,
  hostName,
  mayJoinBeta,
  parseFeatureFlags,
  requestHost,
  resolveBeta,
  resolveChannel,
} from '../lib/features.js';

test('beta hosts default to beta.<public host>', () => {
  assert.deepEqual(betaHostsFromEnv({ PUBLIC_URL: 'https://laughtime.lol' }), ['beta.laughtime.lol']);
  assert.deepEqual(betaHostsFromEnv({ PUBLIC_URL: 'https://www.example.org' }), ['beta.example.org']);
  assert.deepEqual(betaHostsFromEnv({ BETA_HOSTS: 'next.example.org, Beta.Example.org' }), ['next.example.org', 'beta.example.org']);
});

test('beta hosts are forgiving about how they are written', () => {
  assert.deepEqual(betaHostsFromEnv({ BETA_HOSTS: 'https://Beta.Example.org/, beta.example.org:443 ,, next.example.org.' }), [
    'beta.example.org',
    'next.example.org',
  ]);
  assert.deepEqual(betaHostsFromEnv({}), ['beta.laughtime.lol']);
  assert.deepEqual(betaHostsFromEnv({ PUBLIC_URL: 'not a url' }), []);
  assert.deepEqual(betaHostsFromEnv({ PUBLIC_URL: 'http://localhost:3000' }), ['beta.localhost']);
});

test('channel comes from the host or the opt-in', () => {
  const betaHosts = ['beta.laughtime.lol'];
  assert.equal(resolveChannel({ host: 'laughtime.lol', betaHosts }), 'stable');
  assert.equal(resolveChannel({ host: 'beta.laughtime.lol:443', betaHosts }), 'beta');
  assert.equal(resolveChannel({ host: 'laughtime.lol', optedIn: true, betaHosts }), 'beta');
  assert.equal(resolveChannel({ host: 'beta.laughtime.lol', optedIn: true, betaHosts, enabled: false }), 'stable');
});

test('host names ignore case, ports, lists and the trailing dot', () => {
  assert.equal(hostName('Beta.LaughTime.lol:8443'), 'beta.laughtime.lol');
  assert.equal(hostName('beta.laughtime.lol.'), 'beta.laughtime.lol');
  assert.equal(hostName(' beta.laughtime.lol , proxy.internal'), 'beta.laughtime.lol');
  assert.equal(hostName('[::1]:3000'), '[::1]');
  assert.equal(hostName(undefined), '');
  const betaHosts = ['beta.laughtime.lol'];
  assert.equal(resolveChannel({ host: 'BETA.LAUGHTIME.LOL:443', betaHosts }), 'beta');
  // look-alikes are not the beta host
  assert.equal(resolveChannel({ host: 'beta.laughtime.lol.evil.example', betaHosts }), 'stable');
  assert.equal(resolveChannel({ host: 'xbeta.laughtime.lol', betaHosts }), 'stable');
  assert.equal(resolveChannel({ host: '', betaHosts: [''] }), 'stable');
});

test('a forwarded host only counts behind a trusted proxy', () => {
  const headers = { host: 'laughtime.lol', forwardedHost: 'beta.laughtime.lol' };
  assert.equal(requestHost({ ...headers, trustProxy: true }), 'beta.laughtime.lol');
  assert.equal(requestHost({ ...headers, trustProxy: false }), 'laughtime.lol');
  assert.equal(requestHost({ host: 'Beta.LaughTime.lol:443', trustProxy: true }), 'beta.laughtime.lol');
  assert.equal(requestHost(), '');
});

test('the beta can be switched off', () => {
  assert.equal(betaEnabledFromEnv({}), true);
  assert.equal(betaEnabledFromEnv({ BETA_ENABLED: 'false' }), false);
  assert.equal(betaEnabledFromEnv({ BETA_ENABLED: ' OFF ' }), false);
  assert.equal(betaEnabledFromEnv({ BETA_ENABLED: 'true' }), true);
});

test('BETA_ACCESS: open by default, closed when it cannot be understood', () => {
  assert.equal(betaAccessFromEnv({}), 'open');
  assert.equal(betaAccessFromEnv({ BETA_ACCESS: '' }), 'open');
  assert.equal(betaAccessFromEnv({ BETA_ACCESS: 'Accounts' }), 'accounts');
  assert.equal(betaAccessFromEnv({ BETA_ACCESS: 'account' }), 'accounts');
  assert.equal(betaAccessFromEnv({ BETA_ACCESS: 'admins' }), 'admins');
  assert.equal(betaAccessFromEnv({ BETA_ACCESS: 'everybody' }), 'admins');
});

test('access rules', () => {
  assert.equal(mayJoinBeta('open'), true);
  assert.equal(mayJoinBeta('accounts'), false);
  assert.equal(mayJoinBeta('accounts', { loggedIn: true }), true);
  assert.equal(mayJoinBeta('admins', { loggedIn: true }), false);
  assert.equal(mayJoinBeta('admins', { loggedIn: true, admin: true }), true);
  assert.equal(mayJoinBeta('something else', { loggedIn: true }), false);
});

test('restricted beta: the opt-in only counts with access', () => {
  const base = { host: 'laughtime.lol', betaHosts: ['beta.laughtime.lol'], optedIn: true };
  assert.equal(resolveBeta({ ...base, access: 'accounts' }).channel, 'stable');
  assert.equal(resolveBeta({ ...base, access: 'accounts', loggedIn: true }).channel, 'beta');
  assert.equal(resolveBeta({ ...base, access: 'admins', loggedIn: true }).channel, 'stable');
  assert.equal(resolveBeta({ ...base, access: 'admins', loggedIn: true, admin: true }).channel, 'beta');
  // never a gate on the main host – the visitor simply stays on stable
  assert.equal(resolveBeta({ ...base, access: 'admins' }).gate, null);
});

test('restricted beta host: visitors without access get the gate, not the beta', () => {
  const base = { host: 'beta.laughtime.lol', betaHosts: ['beta.laughtime.lol'] };
  assert.deepEqual(resolveBeta({ ...base, access: 'accounts' }), {
    channel: 'stable',
    onBetaHost: true,
    optedIn: false,
    allowed: false,
    gate: 'accounts',
  });
  assert.equal(resolveBeta({ ...base, access: 'accounts', loggedIn: true }).gate, null);
  assert.equal(resolveBeta({ ...base, access: 'accounts', loggedIn: true }).channel, 'beta');
  assert.equal(resolveBeta({ ...base, access: 'admins', loggedIn: true }).gate, 'admins');
  assert.equal(resolveBeta({ ...base, access: 'admins', admin: true }).channel, 'beta');
  assert.equal(resolveBeta({ ...base, access: 'open' }).gate, null);
  // switched off: the beta host shows the stable page, without a gate
  assert.deepEqual(resolveBeta({ ...base, access: 'admins', enabled: false }), {
    channel: 'stable',
    onBetaHost: true,
    optedIn: false,
    allowed: false,
    gate: null,
  });
});

test('the Discord Activity always stays on stable', () => {
  const state = resolveBeta({ host: 'beta.laughtime.lol', betaHosts: ['beta.laughtime.lol'], optedIn: true, access: 'admins', activity: true });
  assert.equal(state.channel, 'stable');
  assert.equal(state.gate, null);
});

test('unknown features are off', () => {
  assert.equal(featureEnabled('does-not-exist', 'beta'), false);
  assert.equal(featureStage('does-not-exist'), 'off');
  // nothing inherited from Object.prototype counts as a feature
  assert.equal(featureEnabled('constructor', 'beta'), false);
  assert.equal(featureEnabled('toString', 'beta', { toString: 'stable' }), false);
});

test('a beta feature is on in the beta channel only', () => {
  assert.equal(FEATURES.liveStatus.stage, 'beta');
  assert.equal(featureEnabled('liveStatus', 'stable', {}), false);
  assert.equal(featureEnabled('liveStatus', 'beta', {}), true);
  assert.equal(featureEnabled('liveStatus', 'nonsense', {}), false);
  assert.ok(enabledFeatures('beta', {}).includes('liveStatus'));
  assert.ok(!enabledFeatures('stable', {}).includes('liveStatus'));
  assert.ok(betaFeatures({}).includes('liveStatus'));
});

test('FEATURE_FLAGS promotes or switches off a feature', () => {
  assert.equal(featureEnabled('liveStatus', 'stable', { liveStatus: 'stable' }), true);
  assert.equal(featureEnabled('liveStatus', 'beta', { liveStatus: 'off' }), false);
  assert.ok(!betaFeatures({ liveStatus: 'stable' }).includes('liveStatus'));
  assert.ok(enabledFeatures('stable', { liveStatus: 'stable' }).includes('liveStatus'));
  // an override nobody understands switches the feature off, never on
  assert.equal(featureStage('liveStatus', { liveStatus: 'everywhere' }), 'off');
});

test('FEATURE_FLAGS parser', () => {
  const known = ['foo', 'barBaz', 'qux'];
  assert.deepEqual(parseFeatureFlags('foo=stable,barBaz=off', known), { overrides: { foo: 'stable', barBaz: 'off' }, errors: [] });
  assert.deepEqual(parseFeatureFlags('  FOO = Stable ; barbaz=BETA\nqux=off, ', known).overrides, { foo: 'stable', barBaz: 'beta', qux: 'off' });
  assert.deepEqual(parseFeatureFlags('', known), { overrides: {}, errors: [] });
  assert.deepEqual(parseFeatureFlags(undefined, known), { overrides: {}, errors: [] });
  // the last entry wins
  assert.deepEqual(parseFeatureFlags('foo=off,foo=stable', known).overrides, { foo: 'stable' });
});

test('FEATURE_FLAGS parser reports what it skipped', () => {
  const known = ['foo'];
  const { overrides, errors } = parseFeatureFlags('foo=on, nope=stable, foo, =stable, foo=stable', known);
  assert.deepEqual(overrides, { foo: 'stable' });
  assert.equal(errors.length, 4);
  assert.match(errors[0], /unknown stage/);
  assert.match(errors[1], /unknown feature/);
  assert.match(errors[2], /key=stage/);
  assert.match(errors[3], /key=stage/);
  // prototype names are not features
  assert.deepEqual(parseFeatureFlags('__proto__=stable,constructor=stable', known).overrides, {});
});

test('feedback link: web and mail addresses only', () => {
  assert.equal(feedbackUrlFromEnv({}), '');
  assert.equal(feedbackUrlFromEnv({ BETA_FEEDBACK_URL: ' https://discord.gg/example ' }), 'https://discord.gg/example');
  assert.equal(feedbackUrlFromEnv({ BETA_FEEDBACK_URL: 'mailto:beta@example.org' }), 'mailto:beta@example.org');
  assert.equal(feedbackUrlFromEnv({ BETA_FEEDBACK_URL: 'javascript:alert(1)' }), '');
  assert.equal(feedbackUrlFromEnv({ BETA_FEEDBACK_URL: 'discord.gg/example' }), '');
});
