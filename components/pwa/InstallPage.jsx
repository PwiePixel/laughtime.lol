'use client';

import Link from 'next/link';
import { useState } from 'react';
import Icon from '@/components/Icon';
import { useApp } from '@/components/Providers';
import PwaIcon from './PwaIcon';
import { useInstall } from './useInstall';

// how to install per platform; `icon` shows the button the step talks about
const GUIDES = {
  android: { icon: 'phone', steps: [null, 'menu', 'add-home', null] },
  ios: { icon: 'phone', steps: [null, 'ios-share', 'add-home', null] },
  desktop: { icon: 'monitor', steps: [null, 'monitor-install', null] },
};

const ORDER = {
  android: ['android', 'ios', 'desktop'],
  ios: ['ios', 'android', 'desktop'],
  desktop: ['desktop', 'android', 'ios'],
};

const FEATURES = [
  { key: 'full', icon: <PwaIcon name="phone" className="feat-icon" /> },
  { key: 'fast', icon: <Icon name="zap" className="feat-icon" /> },
  { key: 'awake', icon: <Icon name="eye" className="feat-icon" /> },
  { key: 'free', icon: <Icon name="heart" className="feat-icon" /> },
];

/** "Get the app": install button where the browser offers one, instructions for everyone else. */
export default function InstallPage() {
  const { t } = useApp();
  const install = useInstall();
  const [busy, setBusy] = useState(false);
  const os = install.platform?.os || null;

  async function installNow() {
    setBusy(true);
    try {
      await install.install();
    } finally {
      setBusy(false);
    }
  }

  let status = null;
  if (install.standalone) status = { tone: 'ok', text: t('pwa.install.standalone') };
  else if (install.installed) status = { tone: 'ok', text: t('pwa.install.done') };
  else if (install.platform?.inApp) status = { tone: 'warn', text: t('pwa.install.inApp') };

  return (
    <div className="install-page">
      <section className="card install-hero">
        <img className="install-app-icon" src="/icons/icon-192.png" alt="" width="96" height="96" />
        <div className="install-hero-text">
          <h1>{t('pwa.install.title')}</h1>
          <p className="lead">{t('pwa.install.lead')}</p>
          <ul className="install-feats">
            {FEATURES.map((f) => (
              <li key={f.key}>
                {f.icon} {t(`pwa.install.feat.${f.key}`)}
              </li>
            ))}
          </ul>
          {/* the same box for every state, so nothing jumps once the browser was looked at */}
          <div className="install-action" aria-live="polite">
            {status && (
              <p className={`install-status install-status-${status.tone}`}>
                <Icon name={status.tone === 'ok' ? 'check-circle' : 'alert'} /> {status.text}
              </p>
            )}
            {!status && install.method === 'prompt' && (
              <>
                <button type="button" className="btn btn-yellow btn-big" disabled={busy} onClick={installNow}>
                  <Icon name="download" /> {t('pwa.install.now')}
                </button>
                <span className="muted small">{t('pwa.install.nowHint')}</span>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="install-grid">
        {(ORDER[os] || ORDER.android).map((id) => {
          const guide = GUIDES[id];
          const mine = os === id;
          return (
            <section key={id} className={`card install-card ${mine ? 'is-mine' : ''}`} aria-labelledby={`install-${id}`}>
              {mine && <span className="pill install-pill">{t('pwa.install.yourDevice')}</span>}
              <h2 id={`install-${id}`} className="with-icon left">
                <PwaIcon name={guide.icon} size={24} /> {t(`pwa.install.${id}.title`)}
              </h2>
              <p className="muted small">{t(`pwa.install.${id}.sub`)}</p>
              <ol className="install-steps">
                {guide.steps.map((icon, i) => (
                  <li key={i}>
                    <span>{t(`pwa.install.${id}.${i + 1}`)}</span>
                    {icon && (
                      <span className="install-key" aria-hidden="true">
                        <PwaIcon name={icon} size={18} />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>

      <p className="muted small center-text install-note">{t('pwa.install.note')}</p>
      <p className="center-text">
        <Link href="/" className="btn btn-white">
          <Icon name="play" size={18} /> {t('pwa.install.play')}
        </Link>
      </p>
    </div>
  );
}
