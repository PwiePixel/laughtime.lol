'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { PWA_STATE_KEY, detectPlatform, installMethod, isEmbedded, parsePwaState } from '@/lib/pwa';
import { getServerSnapshot, getSnapshot, promptInstall, subscribe } from './installStore';

const STANDALONE_QUERY = '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)';

/** true when the page runs as an installed app (own window, no browser bars) */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  // navigator.standalone: iOS home screen apps
  return window.navigator.standalone === true || Boolean(window.matchMedia?.(STANDALONE_QUERY).matches);
}

/** true inside an iframe (the Discord Activity) */
export function isFramed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function loadPwaState() {
  try {
    return parsePwaState(localStorage.getItem(PWA_STATE_KEY));
  } catch {
    return parsePwaState(null);
  }
}

export function savePwaState(state) {
  try {
    localStorage.setItem(PWA_STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked – the banner may show again, nothing else happens */
  }
}

/**
 * What the browser offers for installing LaughTime.
 *   ready      false until the browser was looked at (after hydration)
 *   method     'prompt' | 'ios' | 'manual' | 'none' (see installMethod in lib/pwa.js)
 *   install()  opens the browser dialog (only for 'prompt')
 */
export function useInstall() {
  const store = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [env, setEnv] = useState(null);

  useEffect(() => {
    const read = () =>
      setEnv({
        standalone: isStandalone(),
        embedded: isEmbedded({ hostname: window.location.hostname, search: window.location.search, framed: isFramed() }),
        platform: detectPlatform({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints,
        }),
      });
    read();
    // installing from the browser tab switches the display mode of this very page
    const mq = window.matchMedia?.(STANDALONE_QUERY);
    mq?.addEventListener?.('change', read);
    return () => mq?.removeEventListener?.('change', read);
  }, []);

  return useMemo(() => {
    const ready = env !== null;
    const standalone = Boolean(env?.standalone);
    const embedded = env ? env.embedded : true;
    const method = ready && !embedded ? installMethod({ platform: env.platform, hasPrompt: Boolean(store.prompt), standalone }) : 'none';
    return {
      ready,
      standalone,
      embedded,
      platform: env?.platform || null,
      method,
      installed: store.installed,
      install: promptInstall,
    };
  }, [env, store]);
}
