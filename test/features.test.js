import assert from 'node:assert/strict';
import { test } from 'node:test';
import { betaEnabledFromEnv, betaHostsFromEnv, featureEnabled, resolveChannel } from '../lib/features.js';

test('beta hosts default to beta.<public host>', () => {
  assert.deepEqual(betaHostsFromEnv({ PUBLIC_URL: 'https://laughtime.lol' }), ['beta.laughtime.lol']);
  assert.deepEqual(betaHostsFromEnv({ PUBLIC_URL: 'https://www.example.org' }), ['beta.example.org']);
  assert.deepEqual(betaHostsFromEnv({ BETA_HOSTS: 'next.example.org, Beta.Example.org' }), ['next.example.org', 'beta.example.org']);
});

test('channel comes from the host or the opt-in', () => {
  const betaHosts = ['beta.laughtime.lol'];
  assert.equal(resolveChannel({ host: 'laughtime.lol', betaHosts }), 'stable');
  assert.equal(resolveChannel({ host: 'beta.laughtime.lol:443', betaHosts }), 'beta');
  assert.equal(resolveChannel({ host: 'laughtime.lol', optedIn: true, betaHosts }), 'beta');
  assert.equal(resolveChannel({ host: 'beta.laughtime.lol', optedIn: true, betaHosts, enabled: false }), 'stable');
});

test('the beta can be switched off', () => {
  assert.equal(betaEnabledFromEnv({}), true);
  assert.equal(betaEnabledFromEnv({ BETA_ENABLED: 'false' }), false);
});

test('unknown features are off', () => {
  assert.equal(featureEnabled('does-not-exist', 'beta'), false);
});
