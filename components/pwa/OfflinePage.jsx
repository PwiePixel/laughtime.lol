'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/Providers';
import { retryTarget } from '@/lib/pwa';
import PwaIcon from './PwaIcon';

// The service worker shows this page in place of the one that could not be loaded.
// Remember that address before the app router gets a chance to touch the URL.
const WANTED = typeof window !== 'undefined' ? window.location.href : '';

const CHECK_TIMEOUT_MS = 6000;
// quiet re-checks while the page stays open: 5s, 10s, 20s, then every 30s
const AUTO_RETRY_MS = [5000, 10000, 20000, 30000];

/** a tiny uncached request tells whether the server can be reached again */
async function serverReachable() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch('/api/status', { cache: 'no-store', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default function OfflinePage() {
  const { t } = useApp();
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const retry = useCallback(async ({ silent = false } = {}) => {
    if (busy.current) return;
    busy.current = true;
    if (!silent) {
      setChecking(true);
      setFailed(false);
    }
    const ok = await serverReachable();
    if (ok) {
      // back to the page the visitor wanted (the start page when /offline was opened directly)
      window.location.replace(retryTarget(WANTED, window.location.origin));
      return;
    }
    busy.current = false;
    if (!silent) {
      setChecking(false);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // opened on purpose (address bar): just show the page
    const fallback = !/^\/offline(\/|$)/.test(window.location.pathname);
    let timer = null;
    let attempt = 0;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await retry({ silent: true });
        attempt += 1;
        schedule();
      }, AUTO_RETRY_MS[Math.min(attempt, AUTO_RETRY_MS.length - 1)]);
    };
    const onOnline = () => retry({ silent: true });
    window.addEventListener('online', onOnline);
    if (fallback) schedule();
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [retry]);

  return (
    <div className="page-narrow center offline-page">
      <div className="card">
        <div className="big-icon offline-icon">
          <PwaIcon name="wifi-off" size={56} />
        </div>
        <h1>{t('pwa.offline.title')}</h1>
        <p>{t('pwa.offline.text')}</p>
        <button type="button" className="btn btn-yellow btn-big" disabled={checking} onClick={() => retry()}>
          <PwaIcon name="refresh" className={checking ? 'offline-spin' : ''} />
          {checking ? t('pwa.offline.checking') : t('pwa.offline.retry')}
        </button>
        <div className="offline-status" role="status">
          {failed && <p className="form-error">{t('pwa.offline.still')}</p>}
        </div>
      </div>
    </div>
  );
}
