// Debounce / throttle helpers and the matching React hooks.
// The plain functions have no browser dependency, so they also run in tests.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Collects a burst of calls into one.
 *   leading   run the first call of a burst right away
 *   trailing  run the last call once the burst has been quiet for `wait` ms
 * The returned function has cancel(), flush() and pending().
 */
export function debounce(fn, wait = 200, { leading = false, trailing = true } = {}) {
  let timer = null;
  let lastArgs = null;
  let lastThis = null;

  const invoke = () => {
    const args = lastArgs;
    const self = lastThis;
    lastArgs = null;
    lastThis = null;
    return fn.apply(self, args);
  };

  const onQuiet = () => {
    timer = null;
    if (trailing && lastArgs) invoke();
  };

  function debounced(...args) {
    const startOfBurst = timer === null;
    lastArgs = args;
    lastThis = this;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(onQuiet, wait);
    // a leading call must not run again when the burst ends
    if (leading && startOfBurst) invoke();
  }

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
    lastThis = null;
  };
  debounced.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    onQuiet();
  };
  debounced.pending = () => timer !== null;
  return debounced;
}

/**
 * Runs at most once per `wait` ms. With `trailing` the last call of a burst is
 * never lost: it runs when the window closes.
 */
export function throttle(fn, wait = 100, { leading = true, trailing = true } = {}) {
  let timer = null;
  let lastArgs = null;
  let lastThis = null;

  const invoke = () => {
    const args = lastArgs;
    const self = lastThis;
    lastArgs = null;
    lastThis = null;
    return fn.apply(self, args);
  };

  const onWindowEnd = () => {
    timer = null;
    if (trailing && lastArgs) {
      invoke();
      // the trailing call opens the next window
      timer = setTimeout(onWindowEnd, wait);
    }
  };

  function throttled(...args) {
    lastArgs = args;
    lastThis = this;
    if (timer !== null) return;
    if (leading) invoke();
    timer = setTimeout(onWindowEnd, wait);
  }

  throttled.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
    lastThis = null;
  };
  throttled.flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (lastArgs) invoke();
  };
  throttled.pending = () => timer !== null;
  return throttled;
}

/**
 * The value, but only after it stopped changing for `wait` ms (search-as-you-type).
 * wait <= 0 passes the value straight through; `leading` lets the first change
 * of a burst through at once (filters that are usually clicked only once).
 */
export function useDebouncedValue(value, wait = 250, { leading = false } = {}) {
  const [settled, setSettled] = useState(value);
  const debouncer = useRef(null);
  // what was handed to which debouncer last
  const seen = useRef({ value, via: null });

  useEffect(() => {
    if (wait <= 0) return undefined;
    const d = debounce(setSettled, wait, { leading });
    debouncer.current = d;
    return () => {
      d.cancel();
      debouncer.current = null;
    };
  }, [wait, leading]);

  useEffect(() => {
    if (wait <= 0) {
      seen.current = { value, via: null };
      setSettled(value);
      return;
    }
    const d = debouncer.current;
    const prev = seen.current;
    seen.current = { value, via: d };
    // only real changes start a burst (not the first render); a new debouncer
    // (changed wait) gets the value again, its predecessor may have dropped it
    if (Object.is(prev.value, value) && (prev.via === d || prev.via === null)) return;
    d?.(value);
  }, [value, wait, leading]);

  return wait <= 0 ? value : settled;
}

function useLatest(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

function useLimited(make, fn, wait, leading, trailing) {
  const latest = useLatest(fn);
  const limited = useRef(null);
  useEffect(() => {
    const l = make((...args) => latest.current(...args), wait, { leading, trailing });
    limited.current = l;
    return () => {
      l.cancel();
      limited.current = null;
    };
  }, [make, latest, wait, leading, trailing]);
  return useCallback((...args) => limited.current?.(...args), []);
}

/** Stable debounced version of a callback; always calls the latest `fn`, cancelled on unmount. */
export function useDebouncedCallback(fn, wait = 250, { leading = false, trailing = true } = {}) {
  return useLimited(debounce, fn, wait, leading, trailing);
}

/** Stable throttled version of a callback; always calls the latest `fn`, cancelled on unmount. */
export function useThrottledCallback(fn, wait = 100, { leading = true, trailing = true } = {}) {
  return useLimited(throttle, fn, wait, leading, trailing);
}
