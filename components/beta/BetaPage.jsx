'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Icon from '../Icon';
import { useApp } from '../Providers';
import LiveStatus from './LiveStatus';

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'laughtime.lol';
  }
};

// "liveStatus" -> "Live status" (shown while a feature has no title yet)
const humanize = (key) => {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The /beta page: what the beta is, which version this browser shows and the switch between them. */
export default function BetaPage() {
  const { t, channel, account, hasFeature } = useApp();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accountId = account?.id ?? null;

  // translated text, or the fallback when the key has no text (yet)
  const text = useCallback(
    (key, fallback = '') => {
      const value = t(key);
      return value === key || value.includes('{') ? fallback : value;
    },
    [t],
  );

  useEffect(() => {
    let alive = true;
    api('/api/beta')
      .then((data) => alive && setInfo(data))
      .catch(() => alive && setInfo((prev) => prev || { failed: true }));
    return () => {
      alive = false;
    };
    // who may join depends on the login
  }, [accountId]);

  const switchTo = async (on) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/beta', { method: 'POST', body: { on } });
      // the channel is decided on the server and rendered into every page: load it fresh
      window.location.reload();
    } catch (err) {
      const key = `beta.err.${err.code}`;
      setError(t(key) === key ? t('beta.err.generic') : t(key));
      setBusy(false);
    }
  };

  const loaded = Boolean(info && !info.failed);
  const inBeta = channel === 'beta';
  const mainHost = hostOf(info?.mainUrl);
  const items = loaded
    ? [
        ...info.modes.map((m) => ({
          key: `mode:${m.id}`,
          kind: 'mode',
          icon: m.icon,
          color: m.color,
          title: text(`games.${m.id}`, humanize(m.id)),
          body: text(`games.${m.id}.text`),
          enabled: m.enabled,
        })),
        ...info.features.map((f) => ({
          key: f.key,
          kind: 'feature',
          icon: 'sparkles',
          color: 'var(--cyan)',
          title: text(`beta.feature.${f.key}.title`, humanize(f.key)),
          body: text(`beta.feature.${f.key}.text`, t('beta.feature.fallback')),
          enabled: f.enabled,
        })),
      ]
    : [];

  let action = null;
  if (!loaded) {
    action = info?.failed ? (
      <p className="form-error" role="alert">
        {t('beta.err.generic')}
      </p>
    ) : (
      <div className="spinner small" role="status" aria-label={t('common.loading')} />
    );
  } else if (!info.enabled) {
    action = (
      <div className="beta-note">
        <strong>{t('beta.disabled.title')}</strong>
        <span>{t('beta.disabled.text')}</span>
      </div>
    );
  } else if (inBeta && info.onBetaHost) {
    action = (
      <>
        <p className="beta-note">{t('beta.hostNote', { host: mainHost })}</p>
        <a href={info.mainUrl} className="btn btn-white btn-block">
          <Icon name="external" size={18} /> {t('beta.openMain', { host: mainHost })}
        </a>
      </>
    );
  } else if (inBeta) {
    action = (
      <button type="button" className="btn btn-white btn-big btn-block" onClick={() => switchTo(false)} disabled={busy}>
        <Icon name="arrow-left" size={20} /> {busy ? t('beta.switching') : t('beta.leave')}
      </button>
    );
  } else if (info.mayJoin) {
    action = (
      <button type="button" className="btn btn-yellow btn-big btn-block" onClick={() => switchTo(true)} disabled={busy}>
        <Icon name="rocket" size={20} /> {busy ? t('beta.switching') : t('beta.join')}
      </button>
    );
  } else {
    action = (
      <>
        <p className="beta-note">{t(info.access === 'accounts' ? 'beta.access.accounts' : 'beta.access.admins')}</p>
        {!account && (
          <Link href="/login?next=%2Fbeta" className={`btn btn-block ${info.access === 'accounts' ? 'btn-yellow' : 'btn-white'}`}>
            <Icon name="log-in" size={18} /> {t(info.access === 'accounts' ? 'beta.access.login' : 'beta.gate.teamLogin')}
          </Link>
        )}
      </>
    );
  }

  return (
    <div className="beta-page">
      <header className="beta-hero">
        <span className="beta-kicker">
          <Icon name="sparkles" size={16} /> {t('beta.kicker')}
        </span>
        <h1>{t('beta.title')}</h1>
        <p className="beta-intro">{t('beta.intro')}</p>
      </header>

      <div className="beta-grid">
        <section className={`card beta-switch ${inBeta ? 'is-beta' : ''}`} aria-labelledby="beta-channel-title">
          <h2 id="beta-channel-title">{t('beta.channel.title')}</h2>
          <div className="beta-channels" role="img" aria-label={`${t('beta.channel.title')}: ${t(`beta.channel.${inBeta ? 'beta' : 'stable'}`)}`}>
            <span className={inBeta ? '' : 'on'}>
              <Icon name="shield" size={18} /> {t('beta.channel.stable')}
            </span>
            <span className={inBeta ? 'on' : ''}>
              <Icon name="rocket" size={18} /> {t('beta.channel.beta')}
            </span>
          </div>
          <p className="beta-channel-text">{t(inBeta ? 'beta.channel.betaText' : 'beta.channel.stableText')}</p>
          <div className="beta-action">{action}</div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {loaded && info.enabled && !info.onBetaHost && (inBeta || info.mayJoin) && <p className="muted small beta-hint">{t('beta.joinHint')}</p>}
        </section>

        <section className="card beta-list" aria-labelledby="beta-features-title">
          <h2 id="beta-features-title">{t('beta.features.title')}</h2>
          {!loaded && !info?.failed && <div className="spinner small" aria-hidden="true" />}
          {loaded && items.length === 0 && <p className="muted">{t(info.enabled ? 'beta.features.empty' : 'beta.disabled.text')}</p>}
          {items.length > 0 && (
            <ul>
              {items.map((item) => (
                <li key={item.key}>
                  <span className="beta-item-icon" style={{ background: item.color }} aria-hidden="true">
                    <Icon name={item.icon} size={22} />
                  </span>
                  <div className="beta-item-text">
                    <strong>{item.title}</strong>
                    <span className="badge badge-muted">{t(`beta.features.kind.${item.kind}`)}</span>
                    {item.body && <p>{item.body}</p>}
                  </div>
                  <span className={`beta-item-state ${item.enabled ? 'on' : ''}`}>
                    <Icon name={item.enabled ? 'check' : 'lock'} size={14} /> {t(item.enabled ? 'beta.features.on' : 'beta.features.off')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {hasFeature('liveStatus') && <LiveStatus />}

      <div className="beta-grid beta-more">
        <section className="beta-panel" aria-labelledby="beta-know-title">
          <h2 id="beta-know-title">{t('beta.know.title')}</h2>
          <ul className="beta-know">
            {['account', 'change', 'back'].map((k) => (
              <li key={k}>
                <Icon name="check-circle" size={18} /> <span>{t(`beta.know.${k}`)}</span>
              </li>
            ))}
          </ul>
          {loaded && <p className="beta-release">{t('beta.release', { release: info.release, version: info.version })}</p>}
        </section>
        {loaded && info.feedbackUrl && (
          <section className="beta-panel beta-feedback" aria-labelledby="beta-feedback-title">
            <h2 id="beta-feedback-title">{t('beta.feedback.title')}</h2>
            <p>{t('beta.feedback.text')}</p>
            <a href={info.feedbackUrl} className="btn btn-cyan" target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={18} /> {t('beta.feedback.link')}
            </a>
          </section>
        )}
      </div>
    </div>
  );
}
