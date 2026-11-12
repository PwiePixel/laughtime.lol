'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCachedFetch } from '@/lib/fetchCache';
import Avatar from './Avatar';
import Icon from './Icon';
import { MediaThumb } from './PackCard';
import { useApp } from './Providers';
import { playPack } from './StudioPage';

export default function PackPage({ id }) {
  const { t } = useApp();
  const router = useRouter();
  // undefined = loading, null = not found; a pack opened a moment ago is there at once
  const loaded = useCachedFetch(`/api/packs/${id}`, { ttl: 30_000 });
  const pack = loaded.data?.pack ?? (loaded.error ? null : undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (pack === undefined) {
    return (
      <div className="page-center">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }
  if (!pack) {
    return (
      <div className="page-narrow center">
        <div className="card">
          <div className="big-icon">
            <Icon name="search-x" size={48} />
          </div>
          <p className="lead">{t('studio.packNotFound')}</p>
          <Link href="/studio" className="btn btn-yellow">
            {t('studio.title')}
          </Link>
        </div>
      </div>
    );
  }

  async function play() {
    setBusy(true);
    setError('');
    try {
      await playPack(router, pack.id);
    } catch (err) {
      const key = `err.${err.message}`;
      setError(t(key) === key ? t('err.network') : t(key));
      setBusy(false);
    }
  }

  return (
    <div className="page pack-page">
      <section className="card pack-header">
        <MediaThumb media={pack.cover} className="pack-hero-cover" size={180} priority />
        <div className="pack-header-text">
          <span className="muted small with-icon left">
            <Icon name="package" size={16} /> {t('lobby.pack')}
            {!pack.public && (
              <>
                {' · '}
                <Icon name="lock" size={14} /> {t('studio.private')}
              </>
            )}
          </span>
          <h1>{pack.name}</h1>
          {pack.description && <p>{pack.description}</p>}
          <p className="pack-owner">
            <Avatar value={pack.owner?.avatar} size={28} />
            <Link href={`/u/${pack.owner?.username}`}>{pack.owner?.displayName}</Link>
            <span className="muted">
              · {t('lobby.pack.items', { n: pack.itemCount })}
              {pack.plays > 0 && ` · ${t('packs.plays', { n: pack.plays })}`}
            </span>
          </p>
          <div className="row-start">
            <button type="button" className="btn btn-yellow btn-big" disabled={!pack.playable || busy} onClick={play}>
              <Icon name="play" /> {t('studio.play')}
            </button>
            {pack.isMine && (
              <Link href={`/studio?pack=${pack.id}`} className="btn btn-white">
                <Icon name="wand" /> {t('studio.edit')}
              </Link>
            )}
          </div>
          {!pack.playable && <p className="pack-min-hint">{t('packs.tooSmall', { n: 4 })}</p>}
          {error && <p className="form-error">{error}</p>}
        </div>
      </section>
      <div className="media-grid big">
        {pack.items.map((m) => (
          <div key={m.id} className="media-tile">
            <MediaThumb media={m} size={220} />
            <span className="media-title" title={m.title}>
              {m.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
