import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LAYOUT,
  MAX_AUTO_RETRIES,
  ORIENTATION_LOCK,
  SCOPES,
  authorizeCode,
  backoffDelay,
  canSetPresence,
  codedError,
  createCancel,
  errorCode,
  isOutsideError,
  isPhoneSized,
  isTransient,
  normalizeParticipants,
  retryLockMs,
  sleep,
  tryCommand,
  trySubscribe,
  withRetries,
  withTimeout,
} from '../lib/activitySdk.js';
import { isTextField, isTinyFrame } from '../lib/activityViewport.js';

// The helpers of the activity client that need no browser.

test('sdk constants match the installed Embedded App SDK', async () => {
  const { Common } = await import('@discord/embedded-app-sdk');
  assert.equal(LAYOUT.FOCUSED, Common.LayoutModeTypeObject.FOCUSED);
  assert.equal(LAYOUT.PIP, Common.LayoutModeTypeObject.PIP);
  assert.equal(LAYOUT.GRID, Common.LayoutModeTypeObject.GRID);
  assert.equal(ORIENTATION_LOCK.UNLOCKED, Common.OrientationLockStateTypeObject.UNLOCKED);
  assert.equal(ORIENTATION_LOCK.PORTRAIT, Common.OrientationLockStateTypeObject.PORTRAIT);
  assert.equal(ORIENTATION_LOCK.LANDSCAPE, Common.OrientationLockStateTypeObject.LANDSCAPE);
});

test('scopes: only the ones that need no approval by Discord', () => {
  assert.deepEqual(SCOPES, ['identify', 'rpc.activities.write']);
  assert.equal(canSetPresence('identify rpc.activities.write'), true);
  assert.equal(canSetPresence('rpc.activities.write,identify'), true);
  assert.equal(canSetPresence('identify'), false);
  assert.equal(canSetPresence('identify rpc.activities.write.more'), false);
  assert.equal(canSetPresence(''), false);
  assert.equal(canSetPresence(undefined), false);
});

test('timeout: rejects with the given code, passes results and errors through', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 15, 'discord_timeout'), (err) => err.code === 'discord_timeout');
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
  assert.equal(await withTimeout(7, 50), 7);
  await assert.rejects(withTimeout(Promise.reject(codedError('boom', 500)), 50), (err) => err.code === 'boom' && err.status === 500);
});

test('errors: which ones are worth another automatic attempt', () => {
  for (const code of ['network', 'timeout', 'discord_timeout', 'discord_unavailable', 'server_error', 'server_full']) assert.equal(isTransient(codedError(code)), true, code);
  for (const code of ['discord_denied', 'banned', 'activity_disabled', 'too_many_attempts', 'bad_request', 'not_in_activity', 'login_required']) {
    assert.equal(isTransient(codedError(code)), false, code);
  }
  // our server could not reach Discord (502) – a refused login (401) stays refused
  assert.equal(isTransient(codedError('discord_failed', 502)), true);
  assert.equal(isTransient(codedError('discord_failed', 401)), false);
  // errors of the Discord client carry numbers, not our codes
  assert.equal(errorCode({ code: 5000, message: 'OAuth2 Error' }), 'generic');
  assert.equal(errorCode(new Error('x')), 'generic');
  assert.equal(errorCode(null), 'generic');
  assert.equal(errorCode(codedError('banned', 403)), 'banned');
});

test('errors: the SDK refusing to start means "not inside Discord"', () => {
  assert.equal(isOutsideError(new Error('frame_id query param is not defined')), true);
  assert.equal(isOutsideError(new Error('platform query param is not defined')), true);
  assert.equal(isOutsideError(new Error('Invalid query param "platform" of "tv"')), true);
  assert.equal(isOutsideError(codedError('network')), false);
  assert.equal(isOutsideError({ message: 'frame_id' }), false);
});

test('back-off: grows, is capped and has some jitter', () => {
  assert.equal(backoffDelay(0, () => 0), 1000);
  assert.equal(backoffDelay(1, () => 0), 2000);
  assert.equal(backoffDelay(2, () => 0), 4000);
  assert.equal(backoffDelay(9, () => 0), 8000);
  assert.ok(backoffDelay(0, () => 0.999) < 1400);
  assert.equal(retryLockMs('too_many_attempts'), 15_000);
  assert.equal(retryLockMs('discord_denied'), 0);
  assert.equal(retryLockMs('network'), 2000);
});

test('retries: repeats transient failures, tells the caller, then gives up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const seen = [];
  let calls = 0;
  const job = withRetries(
    async () => {
      calls += 1;
      throw codedError('network');
    },
    { onRetry: (info) => seen.push(info) },
  );
  const failed = assert.rejects(job, (err) => err.code === 'network');
  for (let i = 0; i < MAX_AUTO_RETRIES; i++) {
    await flush();
    t.mock.timers.tick(10_000);
  }
  await failed;
  assert.equal(calls, MAX_AUTO_RETRIES + 1);
  assert.deepEqual(seen.map((s) => [s.attempt, s.retries, s.code]), [[1, 3, 'network'], [2, 3, 'network'], [3, 3, 'network']]);
});

test('retries: success after a failure, and no retry for a final error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const job = withRetries(async () => {
    calls += 1;
    if (calls === 1) throw codedError('timeout');
    return 'room';
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  t.mock.timers.tick(5000);
  assert.equal(await job, 'room');
  assert.equal(calls, 2);

  let denied = 0;
  await assert.rejects(
    withRetries(async () => {
      denied += 1;
      throw codedError('discord_denied', 401);
    }),
    (err) => err.code === 'discord_denied',
  );
  assert.equal(denied, 1);

  // a step can widen the rule (the room step repeats "not in the activity yet")
  let soon = 0;
  const widened = withRetries(
    async () => {
      soon += 1;
      if (soon === 1) throw codedError('not_in_activity', 403);
      return 'ok';
    },
    { retryable: (err) => err.code === 'not_in_activity' },
  );
  for (let i = 0; i < 5; i++) await Promise.resolve();
  t.mock.timers.tick(5000);
  assert.equal(await widened, 'ok');
});

test('retries: cancelling ends the pause at once', async () => {
  const cancel = createCancel();
  let calls = 0;
  const job = withRetries(
    async () => {
      calls += 1;
      throw codedError('network');
    },
    { cancel },
  );
  const failed = assert.rejects(job, (err) => err.code === 'cancelled');
  await new Promise((r) => setImmediate(r));
  cancel.cancel();
  await failed;
  assert.equal(calls, 1);
  await assert.rejects(sleep(10, cancel), (err) => err.code === 'cancelled');
  await assert.rejects(withRetries(async () => 'never', { cancel }), (err) => err.code === 'cancelled');
});

test('optional commands: missing, failing and silent clients never throw', async () => {
  const sdk = {
    commands: {
      ok: async (args) => ({ echo: args }),
      refused: async () => {
        // the Discord client answers with a plain object
        throw { code: 4002, message: 'Invalid command' }; // eslint-disable-line no-throw-literal
      },
      silent: () => new Promise(() => {}),
      throws: () => {
        throw new Error('bad input');
      },
    },
  };
  assert.deepEqual(await tryCommand(sdk, 'ok', { a: 1 }), { ok: true, data: { echo: { a: 1 } } });
  assert.deepEqual(await tryCommand(sdk, 'refused'), { ok: false, code: 4002 });
  assert.deepEqual(await tryCommand(sdk, 'silent', undefined, 15), { ok: false, code: 'timeout' });
  assert.deepEqual(await tryCommand(sdk, 'throws'), { ok: false, code: 'failed' });
  assert.deepEqual(await tryCommand(sdk, 'unknownCommand'), { ok: false, code: 'missing' });
  assert.deepEqual(await tryCommand(null, 'ok'), { ok: false, code: 'missing' });
});

test('events: a failed subscription gives a harmless unsubscribe', async () => {
  const calls = [];
  const sdk = {
    subscribe: async (event) => {
      calls.push(['sub', event]);
      if (event === 'UNKNOWN') throw { code: 4004 }; // eslint-disable-line no-throw-literal
    },
    unsubscribe: async (event) => calls.push(['unsub', event]),
  };
  const off = await trySubscribe(sdk, 'ACTIVITY_LAYOUT_MODE_UPDATE', () => {});
  off();
  await new Promise((r) => setImmediate(r));
  const noop = await trySubscribe(sdk, 'UNKNOWN', () => {});
  noop();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [['sub', 'ACTIVITY_LAYOUT_MODE_UPDATE'], ['unsub', 'ACTIVITY_LAYOUT_MODE_UPDATE'], ['sub', 'UNKNOWN']]);
});

test('login code: silent first, falls back to the name only, reports a closed dialog', async () => {
  const asked = [];
  const sdkWith = (answer) => ({
    commands: {
      authorize: async (args) => {
        asked.push(args);
        return answer(args);
      },
    },
  });
  assert.equal(await authorizeCode(sdkWith(() => ({ code: 'abc' })), '123'), 'abc');
  assert.deepEqual(asked[0], { client_id: '123', response_type: 'code', state: '', prompt: 'none', scope: ['identify', 'rpc.activities.write'] });

  asked.length = 0;
  const fallback = sdkWith((args) => {
    if (args.scope.includes('rpc.activities.write')) throw { code: 4006, message: 'scope' }; // eslint-disable-line no-throw-literal
    return { code: 'basic' };
  });
  assert.equal(await authorizeCode(fallback, '123'), 'basic');
  assert.deepEqual(asked.map((a) => a.scope), [['identify', 'rpc.activities.write'], ['identify']]);

  asked.length = 0;
  const closed = sdkWith(() => {
    throw { code: 5000, message: 'OAuth2 Error' }; // eslint-disable-line no-throw-literal
  });
  await assert.rejects(authorizeCode(closed, '123'), (err) => err.code === 'discord_denied');
  assert.equal(asked.length, 1, 'a closed dialog is not opened a second time');

  await assert.rejects(authorizeCode(sdkWith(() => ({})), '123'), (err) => err.code === 'discord_denied');
});

test('participants: only what is shown, no bots, no duplicates, safe avatar addresses', () => {
  const list = normalizeParticipants([
    { id: '100000000000000001', username: 'anna', global_name: 'Anna', nickname: 'Anna Banana', avatar: 'a_1234abcd5678', bot: false },
    { id: '100000000000000002', username: 'ben', global_name: null, avatar: null, bot: false },
    { id: '100000000000000002', username: 'ben-again', bot: false },
    { id: '100000000000000003', username: 'robot', bot: true },
    { id: 'not-an-id', username: 'x' },
    { id: '100000000000000004', username: 'eve', avatar: '../../evil?x=1', bot: false },
    null,
  ]);
  assert.deepEqual(list, [
    { id: '100000000000000001', name: 'Anna Banana', avatar: 'https://cdn.discordapp.com/avatars/100000000000000001/a_1234abcd5678.png?size=64' },
    { id: '100000000000000002', name: 'ben', avatar: null },
    { id: '100000000000000004', name: 'eve', avatar: null },
  ]);
  assert.deepEqual(normalizeParticipants(undefined), []);
  assert.deepEqual(normalizeParticipants('nope'), []);
  assert.equal(normalizeParticipants(Array.from({ length: 80 }, (_, i) => ({ id: String(100000000000000100n + BigInt(i)), username: `u${i}` }))).length, 50);
});

test('device: phones are told apart from tablets by the short side', () => {
  assert.equal(isPhoneSized({ width: 390, height: 844 }), true);
  assert.equal(isPhoneSized({ width: 844, height: 390 }), true);
  assert.equal(isPhoneSized({ width: 820, height: 1180 }), false);
  assert.equal(isPhoneSized({ width: 1920, height: 1080 }), false);
  assert.equal(isPhoneSized(null), false);
  assert.equal(isPhoneSized({}), false);
});

test('frame: a tile is too small to play in', () => {
  assert.equal(isTinyFrame(320, 180), true);
  assert.equal(isTinyFrame(240, 400), true);
  assert.equal(isTinyFrame(390, 844), false);
  assert.equal(isTinyFrame(844, 390), false);
  assert.equal(isTinyFrame(1440, 900), false);
});

test('keyboard: which elements open the on-screen keyboard', () => {
  const el = (tagName, type, extra = {}) => ({ tagName, getAttribute: () => type ?? null, ...extra });
  assert.equal(isTextField(el('TEXTAREA')), true);
  assert.equal(isTextField(el('INPUT', 'text')), true);
  assert.equal(isTextField(el('INPUT', null)), true);
  assert.equal(isTextField(el('INPUT', 'SEARCH')), true);
  assert.equal(isTextField(el('INPUT', 'range')), false);
  assert.equal(isTextField(el('INPUT', 'checkbox')), false);
  assert.equal(isTextField(el('INPUT', 'text', { disabled: true })), false);
  assert.equal(isTextField(el('TEXTAREA', null, { readOnly: true })), false);
  assert.equal(isTextField(el('DIV', null, { isContentEditable: true })), true);
  assert.equal(isTextField(el('BUTTON')), false);
  assert.equal(isTextField(null), false);
});
