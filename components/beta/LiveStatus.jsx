'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Icon from '../Icon';
import { useApp } from '../Providers';

const REFRESH_MS = 20_000;
const SOURCE_NAMES = { imgflip: 'Imgflip', giphy: 'GIPHY', klipy: 'KLIPY', reddit: 'Reddit' };

/**
 * Beta feature "liveStatus": players, rooms and media sources, refreshed while
 * the tab is visible. Rendered by the beta page when the feature is on.
 */
export default function LiveStatus() {
  const { t, lang } = useApp();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer = null;
    const load = () =>
      api('/api/beta/status')
        .then((d) => {
          if (!alive) return;
          setData(d);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true));
    const start = () => {
      if (timer) return;
      load();
      timer = setInterval(load, REFRESH_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    // no polling in a background tab
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const nf = new Intl.NumberFormat(lang);
  const tiles = [
    { key: 'players', icon: 'users' },
    { key: 'rooms', icon: 'door' },
    { key: 'playing', icon: 'gamepad' },
    { key: 'queued', icon: 'radar' },
  ];

  return (
    <section className="beta-status" aria-labelledby="beta-status-title">
      <div className="beta-status-head">
        <h2 id="beta-status-title">{t('beta.status.title')}</h2>
        {data && !failed && (
          <span className="beta-live">
            <span className="beta-live-dot" aria-hidden="true" /> {t('beta.status.live')}
          </span>
        )}
      </div>
      {failed && !data && (
        <p className="beta-status-error" role="status">
          {t('beta.status.error')}
        </p>
      )}
      {!data && !failed && <div className="spinner small on-dark" role="status" aria-label={t('common.loading')} />}
      {data && (
        <>
          <dl className="beta-status-tiles">
            {tiles.map((tile) => (
              <div key={tile.key}>
                <dt>
                  <Icon name={tile.icon} size={16} /> {t(`beta.status.${tile.key}`)}
                </dt>
                <dd>{nf.format(data[tile.key] ?? 0)}</dd>
              </div>
            ))}
          </dl>
          {data.sources?.length > 0 && (
            <div className="beta-sources">
              <h3>{t('beta.status.sources')}</h3>
              <ul>
                {data.sources.map((s) => (
                  <li key={s.name} className={`is-${s.status}`} title={t('beta.status.items', { n: nf.format(s.items) })}>
                    <span className="beta-source-dot" aria-hidden="true" />
                    <strong>{SOURCE_NAMES[s.name] || s.name}</strong>
                    <span>{t(`beta.status.source.${s.status}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
