import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { debounce, throttle } from '../lib/timing.js';

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

test('debounce runs once after the burst, with the last arguments', () => {
  const calls = [];
  const d = debounce((v) => calls.push(v), 300);
  d('a');
  mock.timers.tick(200);
  d('ab');
  mock.timers.tick(200);
  d('abc');
  assert.deepEqual(calls, []);
  assert.equal(d.pending(), true);
  mock.timers.tick(299);
  assert.deepEqual(calls, []);
  mock.timers.tick(1);
  assert.deepEqual(calls, ['abc']);
  assert.equal(d.pending(), false);
});

test('debounce with leading runs the first call at once and the last one at the end', () => {
  const calls = [];
  const d = debounce((v) => calls.push(v), 100, { leading: true });
  d(1);
  assert.deepEqual(calls, [1]);
  d(2);
  d(3);
  mock.timers.tick(100);
  assert.deepEqual(calls, [1, 3]);
  // a single call is not repeated when its window closes
  d(4);
  mock.timers.tick(100);
  assert.deepEqual(calls, [1, 3, 4]);
});

test('debounce can be cancelled and flushed', () => {
  const calls = [];
  const d = debounce((v) => calls.push(v), 100);
  d('x');
  d.cancel();
  mock.timers.tick(500);
  assert.deepEqual(calls, []);
  d('y');
  d.flush();
  assert.deepEqual(calls, ['y']);
  mock.timers.tick(500);
  assert.deepEqual(calls, ['y']);
});

test('throttle runs at once, then at most once per window, and keeps the last call', () => {
  const calls = [];
  const th = throttle((v) => calls.push(v), 100);
  th(1);
  th(2);
  th(3);
  assert.deepEqual(calls, [1]);
  mock.timers.tick(100);
  assert.deepEqual(calls, [1, 3]);
  // the trailing call opened a new window
  th(4);
  assert.deepEqual(calls, [1, 3]);
  mock.timers.tick(100);
  assert.deepEqual(calls, [1, 3, 4]);
  mock.timers.tick(100);
  th(5);
  assert.deepEqual(calls, [1, 3, 4, 5]);
});

test('throttle without trailing drops the calls in between', () => {
  const calls = [];
  const th = throttle((v) => calls.push(v), 100, { trailing: false });
  th(1);
  th(2);
  mock.timers.tick(100);
  assert.deepEqual(calls, [1]);
  th(3);
  assert.deepEqual(calls, [1, 3]);
});

test('throttle can be cancelled and flushed', () => {
  const calls = [];
  const th = throttle((v) => calls.push(v), 100);
  th(1);
  th(2);
  th.flush();
  assert.deepEqual(calls, [1, 2]);
  th(3);
  th(4);
  th.cancel();
  mock.timers.tick(500);
  assert.deepEqual(calls, [1, 2, 3]);
});

test('debounce and throttle keep "this"', () => {
  const seen = [];
  const obj = {
    name: 'me',
    d: debounce(function () {
      seen.push(this.name);
    }, 10),
    t: throttle(function () {
      seen.push(this.name);
    }, 10),
  };
  obj.d();
  obj.t();
  mock.timers.tick(10);
  assert.deepEqual(seen, ['me', 'me']);
});
