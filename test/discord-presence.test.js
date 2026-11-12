import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRESENCE_MIN_GAP_MS, createPresenceThrottle, presenceKey } from '../lib/activityPresence.js';

/** a throttle with a clock the test moves by hand */
function setup({ minGapMs = 5000, send } = {}) {
  let time = 1_000_000;
  let timer = null;
  const sent = [];
  const throttle = createPresenceThrottle({
    send:
      send ||
      ((payload) => {
        sent.push(payload);
      }),
    minGapMs,
    now: () => time,
    setTimer: (fn, ms) => {
      timer = { fn, at: time + ms };
      return timer;
    },
    clearTimer: (handle) => {
      if (timer === handle) timer = null;
    },
  });
  /** moves the clock and runs the timer when it is due */
  const advance = (ms) => {
    time += ms;
    if (timer && timer.at <= time) {
      const due = timer;
      timer = null;
      due.fn();
    }
  };
  return { throttle, sent, advance, hasTimer: () => Boolean(timer) };
}

const presence = (details, players = 1) => ({ type: 0, details, state: 'Classic', party: { id: 'i-1', size: [players, 8] } });

test('presence: the default gap keeps us under Discord\'s limit', () => {
  // five updates per twenty seconds are allowed
  assert.ok(PRESENCE_MIN_GAP_MS >= 4000);
});

test('presence: the key ignores the order of the fields', () => {
  assert.equal(presenceKey({ a: 1, b: [1, { d: 2, c: 3 }], e: undefined }), presenceKey({ b: [1, { c: 3, d: 2 }], a: 1 }));
  assert.notEqual(presenceKey({ size: [1, 8] }), presenceKey({ size: [8, 1] }));
  assert.equal(presenceKey(undefined), 'null');
});

test('presence: the first update goes out at once', () => {
  const { throttle, sent, hasTimer } = setup();
  assert.equal(throttle.update(presence('In the lobby')), 'sent');
  assert.deepEqual(sent, [presence('In the lobby')]);
  assert.equal(hasTimer(), false);
});

test('presence: an identical payload is never sent twice', () => {
  const { throttle, sent, advance } = setup();
  throttle.update(presence('In the lobby'));
  assert.equal(throttle.update(presence('In the lobby')), 'dropped');
  advance(60_000);
  // same content, new object, different key order
  assert.equal(throttle.update({ party: { id: 'i-1', size: [1, 8] }, state: 'Classic', details: 'In the lobby', type: 0 }), 'dropped');
  assert.equal(sent.length, 1);
  assert.equal(throttle.stats.dropped, 2);
});

test('presence: a burst is coalesced and the latest state is flushed', () => {
  const { throttle, sent, advance, hasTimer } = setup();
  throttle.update(presence('In the lobby', 1));
  advance(100);
  assert.equal(throttle.update(presence('In the lobby', 2)), 'queued');
  advance(100);
  assert.equal(throttle.update(presence('In the lobby', 3)), 'queued');
  advance(100);
  assert.equal(throttle.update(presence('Round 1 of 5', 3)), 'queued');
  assert.equal(sent.length, 1, 'nothing more inside the gap');
  assert.equal(throttle.isWaiting(), true);
  advance(4000);
  assert.equal(sent.length, 1, '4.3 s: still waiting');
  advance(800);
  assert.deepEqual(sent, [presence('In the lobby', 1), presence('Round 1 of 5', 3)]);
  assert.equal(hasTimer(), false);
  assert.equal(throttle.isWaiting(), false);
  assert.equal(throttle.stats.coalesced, 2);
});

test('presence: never more than one update per gap, whatever happens', () => {
  const { throttle, sent, advance } = setup({ minGapMs: 5000 });
  const times = [];
  let clock = 0;
  for (let i = 0; i < 600; i++) {
    const before = sent.length;
    throttle.update(presence(`Round ${i}`, (i % 7) + 1));
    advance(100);
    clock += 100;
    if (sent.length > before) times.push(clock);
  }
  // 60 seconds of changes every 100 ms
  assert.ok(sent.length <= 13, `sent ${sent.length} updates`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 5000 - 100, `gap ${times[i] - times[i - 1]} ms`);
});

test('presence: going back to the shown state while waiting sends nothing', () => {
  const { throttle, sent, advance } = setup();
  throttle.update(presence('In the lobby', 2));
  advance(1000);
  throttle.update(presence('In the lobby', 3));
  advance(1000);
  throttle.update(presence('In the lobby', 2));
  advance(5000);
  assert.equal(sent.length, 1);
  assert.equal(throttle.stats.dropped, 1);
});

test('presence: after the gap the next change goes out at once again', () => {
  const { throttle, sent, advance } = setup();
  throttle.update(presence('In the lobby'));
  advance(5000);
  assert.equal(throttle.update(presence('Round 1 of 5')), 'sent');
  assert.equal(sent.length, 2);
});

test('presence: a failed delivery may be repeated with the next update', async () => {
  let fail = true;
  const delivered = [];
  const { throttle, advance } = setup({
    send: (payload) => {
      if (fail) return Promise.reject(new Error('rate limited'));
      delivered.push(payload);
      return Promise.resolve();
    },
  });
  assert.equal(throttle.update(presence('In the lobby')), 'sent');
  await new Promise((r) => setImmediate(r));
  fail = false;
  advance(5000);
  assert.equal(throttle.update(presence('In the lobby')), 'sent', 'the same state is tried again');
  assert.equal(delivered.length, 1);
});

test('presence: a send() that throws does not break the throttle', async () => {
  let calls = 0;
  const { throttle, advance } = setup({
    send: () => {
      calls += 1;
      throw new Error('boom');
    },
  });
  assert.equal(throttle.update(presence('a')), 'sent');
  await new Promise((r) => setImmediate(r));
  advance(5000);
  assert.equal(throttle.update(presence('b')), 'sent');
  assert.equal(calls, 2);
});

test('presence: stop() drops the waiting update', () => {
  const { throttle, sent, advance, hasTimer } = setup();
  throttle.update(presence('In the lobby', 1));
  throttle.update(presence('In the lobby', 2));
  throttle.stop();
  assert.equal(hasTimer(), false);
  advance(10_000);
  assert.equal(sent.length, 1);
  assert.equal(throttle.update(presence('Round 1 of 5')), 'dropped');
});
