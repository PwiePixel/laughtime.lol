'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PWA_DEBUG_KEY, SW_SCOPE, SW_URL, shouldRegisterWorker } from '@/lib/pwa';
import { isFramed } from './useInstall';

// a tab that stays open for hours (installed app) looks for a new version when it comes back
const UPDATE_CHECK_MS = 60 * 60 * 1000;
// "reload" was clicked but the new worker never took over: reload anyway after this time
const RELOAD_FALLBACK_MS = 4000;

/** ?pwa_debug=1 (or =0) switches the worker on for localhost and is remembered on this device */
function debugFlag() {
  try {
    const q = new URLSearchParams(window.location.search).get('pwa_debug');
    if (q === '1') localStorage.setItem(PWA_DEBUG_KEY, '1');
    if (q === '0') localStorage.removeItem(PWA_DEBUG_KEY);
    return localStorage.getItem(PWA_DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Registers public/sw.js (see shouldRegisterWorker for where) and reports when a
 * new version is waiting. Nothing reloads by itself: applyUpdate() activates the
 * waiting worker and reloads this tab once it has taken over.
 */
export function useServiceWorker() {
  const [waiting, setWaiting] = useState(null);
  const reloadWanted = useRef(false);
  const fallbackTimer = useRef(null);

  useEffect(() => {
    const allowed = shouldRegisterWorker({
      production: process.env.NODE_ENV === 'production',
      supported: 'serviceWorker' in navigator,
      secure: window.isSecureContext,
      hostname: window.location.hostname,
      search: window.location.search,
      framed: isFramed(),
      debug: debugFlag(),
    });
    if (!allowed) return undefined;

    let stopped = false;
    let registration = null;
    let lastCheck = Date.now();
    const watched = new Map();

    const watch = (worker) => {
      if (!worker || watched.has(worker)) return;
      const onState = () => {
        if (stopped) return;
        // "installed" while another worker controls the page = an update that waits
        // (the very first worker has no controller yet and simply becomes active)
        if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
        if (worker.state === 'activated' || worker.state === 'redundant') setWaiting((w) => (w === worker ? null : w));
      };
      watched.set(worker, onState);
      worker.addEventListener('statechange', onState);
      onState();
    };

    const onUpdateFound = () => watch(registration?.installing);

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, updateViaCache: 'none' });
        if (stopped) return;
        registration = reg;
        watch(reg.waiting);
        watch(reg.installing);
        reg.addEventListener('updatefound', onUpdateFound);
      } catch (err) {
        console.warn('[pwa] service worker not registered:', err?.message || err);
      }
    };

    const onControllerChange = () => {
      setWaiting(null);
      // only the tab where "reload" was clicked reloads – never a tab in the middle of a game
      if (!reloadWanted.current) return;
      reloadWanted.current = false;
      window.location.reload();
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || !registration) return;
      if (Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisibility);
    // not during the first paint: the worker can wait until the page has loaded
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      stopped = true;
      clearTimeout(fallbackTimer.current);
      window.removeEventListener('load', register);
      document.removeEventListener('visibilitychange', onVisibility);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      registration?.removeEventListener('updatefound', onUpdateFound);
      for (const [worker, onState] of watched) worker.removeEventListener('statechange', onState);
      watched.clear();
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    reloadWanted.current = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(() => {
      if (reloadWanted.current) window.location.reload();
    }, RELOAD_FALLBACK_MS);
  }, [waiting]);

  return { updateReady: Boolean(waiting), applyUpdate };
}
