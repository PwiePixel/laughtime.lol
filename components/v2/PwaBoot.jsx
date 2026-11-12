'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import { useApp } from '@/components/Providers';
import InstallBanner from '@/components/pwa/InstallBanner';
import PwaIcon from '@/components/pwa/PwaIcon';
import { useInstall } from '@/components/pwa/useInstall';
import { useServiceWorker } from '@/components/pwa/useServiceWorker';
import { useWakeLock } from '@/components/pwa/useWakeLock';
import { isGameRoute } from '@/lib/pwa';

const OFFLINE_TOAST_MS = 6000;
const ONLINE_TOAST_MS = 3000;
const INSTALLED_TOAST_MS = 6000;

/**
 * Everything that makes the website feel like an app (rendered once in the layout):
 * registers the service worker, offers "install app", announces updates and
 * connection changes and keeps the screen awake during a game.
 * Inside the Discord Activity none of this runs.
 */
export default function PwaBoot() {
  const pathname = usePathname() || '/';
  const { t, lang, activityMode } = useApp();
  const install = useInstall();
  const { updateReady, applyUpdate } = useServiceWorker();
  const inGame = isGameRoute(pathname);
  // install.embedded stays true until the browser was looked at
  const embedded = install.embedded || activityMode;

  useWakeLock(inGame && !embedded);

  // lets app/pwa.css switch off pull-to-refresh while a game is on screen
  useEffect(() => {
    document.documentElement.toggleAttribute('data-pwa-game', inGame);
    return () => document.documentElement.removeAttribute('data-pwa-game');
  }, [inGame]);

  // offline / back online
  const [net, setNet] = useState(null);
  useEffect(() => {
    let timer = null;
    const show = (kind, ms) => {
      clearTimeout(timer);
      setNet(kind);
      timer = setTimeout(() => setNet(null), ms);
    };
    const onOffline = () => show('offline', OFFLINE_TOAST_MS);
    const onOnline = () => show('online', ONLINE_TOAST_MS);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // "installed" confirmation (fires on Android and desktop)
  const [installedToast, setInstalledToast] = useState(false);
  useEffect(() => {
    if (!install.installed) return undefined;
    setInstalledToast(true);
    const id = setTimeout(() => setInstalledToast(false), INSTALLED_TOAST_MS);
    return () => clearTimeout(id);
  }, [install.installed]);

  // the offline page is stored in one language: store it again after a switch
  const firstLang = useRef(true);
  useEffect(() => {
    if (firstLang.current) {
      firstLang.current = false;
      return;
    }
    navigator.serviceWorker?.controller?.postMessage({ type: 'REFRESH_OFFLINE' });
  }, [lang]);

  // home screen shortcut "private game": jump to its button on the start page
  useEffect(() => {
    if (window.location.pathname !== '/' || new URLSearchParams(window.location.search).get('shortcut') !== 'private') return undefined;
    const id = setTimeout(() => {
      const tile = document.querySelector('.tile-private');
      tile?.scrollIntoView({ block: 'center' });
      tile?.focus({ preventScroll: true });
    }, 600);
    return () => clearTimeout(id);
  }, []);

  // an update never interrupts a game: the toast waits until the round is over
  const [updateLater, setUpdateLater] = useState(false);
  const showUpdate = updateReady && !updateLater && !inGame;

  if (embedded) return null;
  return (
    <div className="pwa-stack">
      {net === 'offline' && (
        <div className="pwa-toast pwa-toast-offline" role="status">
          <PwaIcon name="wifi-off" size={18} /> {t('pwa.net.offline')}
        </div>
      )}
      {net === 'online' && (
        <div className="pwa-toast pwa-toast-online" role="status">
          <Icon name="check-circle" size={18} /> {t('pwa.net.online')}
        </div>
      )}
      {installedToast && (
        <div className="pwa-toast pwa-toast-online" role="status">
          <Icon name="party" size={18} /> {t('pwa.installed')}
        </div>
      )}
      {showUpdate && (
        <div className="pwa-toast pwa-toast-update" role="status">
          <Icon name="sparkles" size={18} />
          <span>{t('pwa.update.text')}</span>
          <button type="button" className="btn btn-small btn-white" onClick={applyUpdate}>
            <PwaIcon name="refresh" size={16} /> {t('pwa.update.reload')}
          </button>
          <button type="button" className="pwa-close" aria-label={t('pwa.update.later')} title={t('pwa.update.later')} onClick={() => setUpdateLater(true)}>
            <Icon name="x" size={18} />
          </button>
        </div>
      )}
      <InstallBanner install={install} pathname={pathname} />
    </div>
  );
}
