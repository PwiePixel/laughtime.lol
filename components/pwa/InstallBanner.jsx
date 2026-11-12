'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { useApp } from '@/components/Providers';
import { recordDismissal, recordView, shouldOfferInstall } from '@/lib/pwa';
import PwaIcon from './PwaIcon';
import { loadPwaState, savePwaState } from './useInstall';

// never on first paint: the banner slides in a moment after the page has settled
const SHOW_DELAY_MS = 2500;

/**
 * Small "install the app" offer at the bottom of the screen. It appears after a
 * few page views (or a played game), never during a game, and stays away for a
 * month once it was closed (see shouldOfferInstall in lib/pwa.js).
 */
export default function InstallBanner({ install, pathname }) {
  const { t } = useApp();
  // what this device remembers (null until it was read after hydration)
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // every opened page counts towards "has engaged a little"
  useEffect(() => {
    const next = recordView(loadPwaState(), pathname);
    savePwaState(next);
    setState(next);
  }, [pathname]);

  // installed (Android / desktop tell us): remember it
  useEffect(() => {
    if (!install.installed) return;
    const next = { ...loadPwaState(), installed: true };
    savePwaState(next);
    setState(next);
  }, [install.installed]);

  const eligible =
    install.ready && !install.installed && state !== null && shouldOfferInstall({ method: install.method, state, pathname });

  useEffect(() => {
    if (!eligible) {
      setOpen(false);
      return undefined;
    }
    const id = setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => clearTimeout(id);
  }, [eligible]);

  const dismiss = useCallback(() => {
    const next = recordDismissal(loadPwaState());
    savePwaState(next);
    setState(next);
    setOpen(false);
  }, []);

  const installNow = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await install.install();
      // "cancel" in the browser dialog counts like closing the banner
      if (outcome === 'dismissed') dismiss();
      else setOpen(false);
    } finally {
      setBusy(false);
    }
  }, [install, dismiss]);

  if (!open) return null;
  const ios = install.method === 'ios';
  return (
    <aside className="pwa-banner" aria-label={t('pwa.banner.title')}>
      <img className="pwa-banner-icon" src="/icons/icon-192.png" alt="" width="48" height="48" />
      <div className="pwa-banner-text">
        <strong>{t('pwa.banner.title')}</strong>
        {ios ? (
          <span>
            <PwaIcon name="ios-share" size={16} /> {t('pwa.banner.iosText')}
          </span>
        ) : (
          <span>{t('pwa.banner.text')}</span>
        )}
      </div>
      {ios ? (
        <Link href="/install" className="btn btn-small btn-yellow pwa-banner-action" onClick={() => setOpen(false)}>
          {t('pwa.banner.how')}
        </Link>
      ) : (
        <button type="button" className="btn btn-small btn-yellow pwa-banner-action" disabled={busy} onClick={installNow}>
          <Icon name="download" size={16} /> {t('pwa.banner.install')}
        </button>
      )}
      <button type="button" className="pwa-close" aria-label={t('pwa.banner.later')} title={t('pwa.banner.later')} onClick={dismiss}>
        <Icon name="x" size={18} />
      </button>
    </aside>
  );
}
