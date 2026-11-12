'use client';

import { useCallback, useEffect, useState } from 'react';
import { uploadFile } from '@/lib/upload';
import { usePublicInfo } from '@/lib/usePublicInfo';
import Dropzone from './Dropzone';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { MediaThumb } from './PackCard';
import { useApp } from './Providers';
import Timer from './Timer';

function errText(t, code, vars) {
  const key = `err.${code}`;
  return t(key, vars) === key ? t('err.network') : t(key, vars);
}

function SearchPick({ send, onMessage }) {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      onMessage((m) => {
        if (m.t === 'swap_results') {
          setResults(m.items);
          setBusy(false);
        }
      }),
    [onMessage],
  );

  const clean = q.trim();
  return (
    <div className="swap-search">
      <form
        className="hunt-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean.length < 2) return;
          setBusy(true);
          send({ t: 'swap_search', q: clean });
          setTimeout(() => setBusy(false), 8000);
        }}
      >
        <input
          className="input"
          value={q}
          maxLength={40}
          autoFocus
          enterKeyHint="search"
          placeholder={t('caption.searchPlaceholder')}
          aria-label={t('caption.search')}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn btn-cyan" type="submit" disabled={busy || clean.length < 2}>
          {busy ? <span className="spinner tiny" aria-hidden="true" /> : <Icon name="search" />} {t('caption.search')}
        </button>
      </form>
      {results && !results.length && <p className="muted center-text">{t('studio.noResults')}</p>}
      {results?.length > 0 && (
        <>
          <p className="muted small">{t('swap.pickHint')}</p>
          <div className="media-grid swap-results">
            {results.map((m) => (
              <button key={m.id} type="button" className="media-tile pick-tile" onClick={() => send({ t: 'swap_pick', id: m.id })} title={m.title}>
                <MediaThumb media={m} />
                <span className="media-title">{m.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function UploadPhase({ game }) {
  const { t, profile } = useApp();
  const { state, send, serverNow, onMessage } = game;
  const info = usePublicInfo(0);
  const up = state.upload || {};
  const mine = up.mine;
  const isHost = state.hostId === state.you;
  const [tab, setTab] = useState('upload');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  const onFile = useCallback(
    async (file) => {
      setError('');
      if (file.size > info.uploadMaxMb * 1048576) {
        setError(errText(t, 'file_too_large', { n: info.uploadMaxMb }));
        return;
      }
      setProgress(0);
      try {
        await uploadFile(`/api/rooms/${state.code}/upload`, file, { 'X-Player': profile.pid, 'X-Secret': profile.secret }, setProgress);
      } catch (err) {
        setError(errText(t, err.code, { n: info.uploadMaxMb }));
      } finally {
        setProgress(null);
      }
    },
    [info.uploadMaxMb, profile?.pid, profile?.secret, state.code, t],
  );

  return (
    <div className="phase upload-phase">
      <div className="phase-head">
        <div>
          <h1>{t('swap.title')}</h1>
          <p className="muted">{t('swap.sub')}</p>
        </div>
        <Timer deadline={state.deadline} total={state.settings.uploadTime * 1000} serverNow={serverNow} />
      </div>

      <div className="swap-layout">
        <section className="card swap-main">
          {mine ? (
            <div className="swap-chosen pop-in">
              <MemeCanvas media={mine.media} captions={[]} maxHeight="min(46vh, 420px)" />
              <p className="lead with-icon">
                <Icon name="check-circle" size={24} /> {mine.uploaded ? t('swap.uploaded') : t('swap.chosen')}
              </p>
              <p className="muted">{t('swap.chosenHint')}</p>
              {!up.endingSoon && (
                <button type="button" className="btn btn-white" onClick={() => send({ t: 'swap_clear' })}>
                  <Icon name="repeat" size={18} /> {t('swap.change')}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="tabs swap-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === 'upload'} className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>
                  <Icon name="upload" size={18} /> {t('swap.tabUpload')}
                </button>
                <button type="button" role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
                  <Icon name="search" size={18} /> {t('swap.tabSearch')}
                </button>
              </div>
              {tab === 'upload' ? (
                <Dropzone onFile={onFile} progress={progress} maxMb={info.uploadMaxMb} />
              ) : (
                <SearchPick send={send} onMessage={onMessage} />
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="divider">
                <span>{t('common.or')}</span>
              </div>
              <button type="button" className="btn btn-pink swap-random" onClick={() => send({ t: 'swap_random' })}>
                <Icon name="dice" /> {t('swap.random')}
              </button>
            </>
          )}
        </section>

        <aside className="card swap-side">
          <div className="swap-illu" aria-hidden="true">
            <span className="si-card c1">
              <Icon name="image" size={26} />
            </span>
            <span className="si-arrow">
              <Icon name="swap" size={26} />
            </span>
            <span className="si-card c2">
              <Icon name="pencil" size={24} />
            </span>
          </div>
          <h2>{t('swap.howTitle')}</h2>
          <ol className="swap-how">
            <li>{t('swap.how1')}</li>
            <li>{t('swap.how2')}</li>
            <li>{t('swap.how3')}</li>
          </ol>
          <p className="swap-progress">
            {up.endingSoon ? <span className="spinner small" aria-hidden="true" /> : <Icon name="users" size={18} />}{' '}
            {up.endingSoon ? t('swap.allDone') : t('caption.progress', { done: up.done || 0, total: up.total || 0 })}
          </p>
          {isHost && (
            <button type="button" className="btn btn-ghost btn-small host-skip" onClick={() => send({ t: 'skip' })}>
              <Icon name="skip" size={16} /> {t('swap.endNow')}
            </button>
          )}
          <p className="small muted swap-legal">
            <Icon name="shield" size={16} /> {t('swap.legal')}
          </p>
        </aside>
      </div>
    </div>
  );
}
