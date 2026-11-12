// Rich Presence throttle for the Discord Activity (plain ESM, no browser APIs,
// so it can be tested with node).
//
// Discord limits SET_ACTIVITY (about five updates in twenty seconds) and a game
// changes its state in bursts (phase + player count + round at once). So:
//   - an update that equals the last one sent is dropped,
//   - the first update goes out at once, later ones wait until `minGapMs` passed,
//   - while waiting only the newest state is kept and sent when the gap is over.

export const PRESENCE_MIN_GAP_MS = 5000;

/** JSON with sorted keys: the same content always gives the same text */
export function presenceKey(value) {
  if (Array.isArray(value)) return `[${value.map(presenceKey).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${presenceKey(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 *   send(payload)   delivers one update (may return a promise)
 *   minGapMs        minimum time between two deliveries
 *   now / setTimer / clearTimer   replaceable clock (tests)
 */
export function createPresenceThrottle({
  send,
  minGapMs = PRESENCE_MIN_GAP_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let lastKey = null; // what Discord shows right now
  let lastAt = -Infinity;
  let pending = null; // { key, payload } waiting for the gap to pass
  let timer = null;
  let stopped = false;
  const stats = { sent: 0, dropped: 0, coalesced: 0 };

  function deliver({ key, payload }) {
    lastKey = key;
    lastAt = now();
    stats.sent += 1;
    let result;
    try {
      result = send(payload);
    } catch {
      result = Promise.reject();
    }
    // not delivered: forget it, so the same state may be sent with the next update
    Promise.resolve(result).catch(() => {
      if (lastKey === key) lastKey = null;
    });
  }

  function fire() {
    timer = null;
    const next = pending;
    pending = null;
    if (!next || stopped) return;
    // the state went back to what is already shown while we waited
    if (next.key === lastKey) {
      stats.dropped += 1;
      return;
    }
    deliver(next);
  }

  return {
    stats,
    /** Reports the current state; returns 'sent', 'queued' or 'dropped'. */
    update(payload) {
      if (stopped) return 'dropped';
      const key = presenceKey(payload);
      if (timer) {
        // an update is already waiting: it will carry the newest state
        if (pending) stats.coalesced += 1;
        pending = { key, payload };
        return 'queued';
      }
      if (key === lastKey) {
        stats.dropped += 1;
        return 'dropped';
      }
      const wait = lastAt + minGapMs - now();
      if (wait <= 0) {
        deliver({ key, payload });
        return 'sent';
      }
      pending = { key, payload };
      timer = setTimer(fire, wait);
      return 'queued';
    },
    /** true while an update waits for its turn */
    isWaiting: () => Boolean(timer),
    /** Stops everything (the activity is closing). */
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
      pending = null;
    },
  };
}
