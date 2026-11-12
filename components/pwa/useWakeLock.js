'use client';

import { useEffect } from 'react';

/**
 * Keeps the screen on while `active` is true (Screen Wake Lock API).
 * The browser drops the lock whenever the tab is hidden, so it is requested
 * again when the page becomes visible. Released on clean-up.
 */
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    let pending = false;
    let stopped = false;

    const acquire = async () => {
      if (stopped || lock || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (stopped) {
          sentinel.release().catch(() => {});
          return;
        }
        lock = sentinel;
        sentinel.addEventListener('release', () => {
          if (lock === sentinel) lock = null;
        });
      } catch {
        // battery saver or not allowed: the game works without it
      } finally {
        pending = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const held = lock;
      lock = null;
      held?.release().catch(() => {});
    };
  }, [active]);
}
