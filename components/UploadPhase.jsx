'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadFile } from '@/lib/upload';
import { usePublicInfo } from '@/lib/usePublicInfo';
import ActionBar from './game/ActionBar';
import PhaseSub from './game/LastCall';
import { ProgressDots } from './game/VoteDist';
import Dropzone from './Dropzone';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { MediaThumb } from './PackCard';
import { useApp } from './Providers';
import { FloatingReactions, ReactionBar } from './Reactions';
import Timer from './Timer';

// the server ignores a second search within 700 ms
const SEARCH_GAP_MS = 800;

function errText(t, code, vars) {
  const key = `err.${code}`;
  return t(key, vars) === key ? t('err.network') : t(key, vars);
}

/** search tab: term, idea chips, result grid. Results live in the parent so a tab switch keeps them. */
function SearchPick({ up, search, onSearch, onPick, picking, autoFocus }) {
  const { t } = useApp();
  const [q, setQ] = useState(search.q || '');
  const clean = q.trim();
  const left = up.searchesLeft ?? 0;
  const { busy, results } = search;
  const go = (term) => {
    if (busy || left <= 0 || term.length < 2) return;
    setQ(term);
    onSearch(term);
  };
  return (
    <div className="swap-search">
      {left > 0 ? (
        <form
          className="hunt-form"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go(clean);
          }}
        >
          <input
            className="input"
            value={q}
            maxLength={40}
            autoFocus={autoFocus}
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="off"
            placeholder={t('caption.searchPlaceholder')}
            aria-label={t('caption.search')}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-cyan" type="submit" disabled={busy || clean.length < 2}>
            {busy ? <span className="spinner tiny" aria-hidden="true" /> : <Icon name="search" />} <span>{t('caption.search')}</span>
          </button>
        </form>
      ) : (
        <p className="hunt-out small">
          <Icon name="search" size={15} /> {t('swap.noSearchesLeft')}
        </p>
      )}
      <div className="idea-row">
        {left > 0 && up.ideas?.length > 0 && (
          <>
            <span className="idea-label">{t('hunt.ideas')}</span>
            {up.ideas.map((idea) => (
              <button key={idea} type="button" className="chip idea-chip" disabled={busy} onClick={() => go(idea)}>
                {idea}
              </button>
            ))}
          </>
        )}
        {left > 0 && <span className="idea-left small">{t('swap.searchesLeft', { n: left })}</span>}
      </div>
      {busy && (
        <div className="media-grid swap-results is-loading" role="status">
          <span className="sr-only">{t('caption.searching')}</span>
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} className="tile-skeleton" style={{ '--i': i }} />
          ))}
        </div>
      )}
      {!busy && results && !results.length && (
        <p className="hunt-empty" role="status">
          <Icon name="search-x" size={18} /> {t('studio.noResults')}
        </p>
      )}
      {!busy && results?.length > 0 && (
        <>
          <p className="muted small swap-pick-hint">{t('swap.pickHint')}</p>
          <div className="media-grid swap-results">
            {results.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`media-tile pick-tile ${picking === m.id ? 'is-picking' : ''}`}
                disabled={Boolean(picking)}
                onClick={() => onPick(m.id)}
                title={m.title}
              >
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
  const { state, send, serverNow, onMessage, onError, onReact } = game;
  const info = usePublicInfo(0);
  const up = state.upload || {};
  const mine = up.mine;
  const isHost = state.hostId === state.you && !state.isPublic;
  const [tab, setTab] = useState('upload');
  const [choosing, setChoosing] = useState(false); // tabs reopened although a picture is already in
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState({ q: '', busy: false, results: null });
  const [picking, setPicking] = useState(null); // tile id or 'random' on its way to the server
  const [howOpen, setHowOpen] = useState(false);
  const lastSearch = useRef(0);
  const viaKeys = useRef(false); // tab chosen with the arrow keys: the focus stays on the tabs
  const twoPlayers = state.players.filter((p) => p.connected).length <= 2;
  const done = up.done || 0;
  const total = up.total || 0;

  useEffect(
    () =>
      onMessage((m) => {
        if (m.t === 'swap_results') setSearch({ q: m.q, busy: false, results: m.items });
      }),
    [onMessage],
  );
  useEffect(
    () =>
      onError(() => {
        setSearch((s) => ({ ...s, busy: false }));
        setPicking(null);
      }),
    [onError],
  );

  // a new picture arrived: show it
  useEffect(() => {
    setChoosing(false);
    setPicking(null);
  }, [mine?.media?.id]);
  useEffect(() => {
    if (up.endingSoon) setChoosing(false);
  }, [up.endingSoon]);

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

  function runSearch(q) {
    const now = Date.now();
    if (now - lastSearch.current < SEARCH_GAP_MS) return;
    if (!send({ t: 'swap_search', q })) return;
    lastSearch.current = now;
    setSearch((s) => ({ ...s, q, busy: true }));
    setTimeout(() => setSearch((s) => (s.q === q ? { ...s, busy: false } : s)), 9000);
  }

  function pickTile(id) {
    if (!send({ t: 'swap_pick', id })) return;
    setPicking(id);
    setTimeout(() => setPicking((p) => (p === id ? null : p)), 4000);
  }

  function surprise() {
    if (picking || up.endingSoon) return;
    if (!send({ t: 'swap_random' })) return;
    setPicking('random');
    setTimeout(() => setPicking((p) => (p === 'random' ? null : p)), 4000);
  }

  const showChosen = mine && !choosing;
  const progressText = t('caption.progress', { done, total });
  const tabs = [
    { id: 'upload', icon: 'upload', label: t('swap.tabUpload') },
    { id: 'search', icon: 'search', label: t('swap.tabSearch') },
    { id: 'random', icon: 'dice', label: t('swap.tabRandom') },
  ];

  return (
    <div className={`phase upload-phase has-bar ${up.endingSoon ? 'is-ending' : ''}`}>
      <div className="phase-head">
        <div>
          <h1>{t('swap.title')}</h1>
          <PhaseSub lastCall={state.lastCall} done={Boolean(mine)} short={t('swap.subShort')}>
            {t('swap.sub')}
          </PhaseSub>
        </div>
        <Timer deadline={state.deadline} total={state.settings.uploadTime * 1000} serverNow={serverNow} urgent={state.lastCall} />
      </div>

      <div className="swap-layout">
        <section className="card swap-main">
          {showChosen ? (
            <div className="swap-chosen">
              <MemeCanvas media={mine.media} captions={[]} maxHeight="var(--stage-h)" className="pop-in">
                <FloatingReactions onReact={onReact} />
              </MemeCanvas>
              <p className="lead with-icon" role="status">
                <Icon name="check-circle" size={24} /> {mine.uploaded ? t('swap.uploaded') : t('swap.chosen')}
              </p>
              <p className={`assist-line ${mine.source === 'random' ? 'is-off' : ''}`}>
                <Icon name={mine.source === 'random' ? 'dice' : 'image-up'} size={16} /> {t(mine.source === 'random' ? 'swap.assistOff' : 'swap.assistOn')}
              </p>
              <p className="muted small">{t(twoPlayers ? 'swap.chosenHint2' : 'swap.chosenHint')}</p>
              {up.endingSoon ? (
                <p className="swap-ending" role="status">
                  <span className="spinner small" aria-hidden="true" /> {t('swap.allDone')}
                </p>
              ) : (
                <>
                  <button type="button" className="btn btn-white desktop-action" onClick={() => setChoosing(true)}>
                    <Icon name="repeat" size={18} /> {t('swap.change')}
                  </button>
                  <p className="small wait-hint">{t('swap.waiting')}</p>
                  <ReactionBar send={send} />
                </>
              )}
            </div>
          ) : (
            <>
              {mine && (
                <div className="swap-keep">
                  <MediaThumb media={mine.media} />
                  <button type="button" className="btn btn-white btn-small" onClick={() => setChoosing(false)}>
                    <Icon name="check" size={16} /> {t('swap.keep')}
                  </button>
                </div>
              )}
              <div
                className="tabs swap-tabs"
                role="tablist"
                onKeyDown={(e) => {
                  // arrow keys move between the tabs
                  const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!dir) return;
                  const next = tabs[(tabs.findIndex((x) => x.id === tab) + dir + tabs.length) % tabs.length];
                  viaKeys.current = true;
                  setTab(next.id);
                  document.getElementById(`swap-tab-${next.id}`)?.focus();
                }}
              >
                {tabs.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="tab"
                    id={`swap-tab-${x.id}`}
                    aria-selected={tab === x.id}
                    aria-controls="swap-panel"
                    tabIndex={tab === x.id ? 0 : -1}
                    className={tab === x.id ? 'on' : ''}
                    onClick={() => {
                      viaKeys.current = false;
                      setTab(x.id);
                    }}
                  >
                    <Icon name={x.icon} size={18} /> <span>{x.label}</span>
                  </button>
                ))}
              </div>
              <div id="swap-panel" role="tabpanel" aria-labelledby={`swap-tab-${tab}`} className="swap-panel">
                {tab === 'upload' && <Dropzone onFile={onFile} progress={progress} maxMb={info.uploadMaxMb} />}
                {tab === 'search' && <SearchPick up={up} search={search} onSearch={runSearch} onPick={pickTile} picking={picking} autoFocus={!viaKeys.current} />}
                {tab === 'random' && (
                  <div className="swap-surprise">
                    <span className="big-icon is-pink" aria-hidden="true">
                      <Icon name="dice" size={48} />
                    </span>
                    <p>{t('swap.randomText')}</p>
                    <p className="assist-line is-off">
                      <Icon name="dice" size={16} /> {t('swap.assistOff')}
                    </p>
                    <button type="button" className="btn btn-pink swap-random" disabled={Boolean(picking)} onClick={surprise}>
                      {picking === 'random' ? <span className="spinner tiny" aria-hidden="true" /> : <Icon name="dice" />} {t('swap.random')}
                    </button>
                  </div>
                )}
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </section>

        <aside className={`card swap-side ${howOpen ? 'is-open' : ''}`}>
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
          <p className="swap-progress">
            {up.endingSoon ? <span className="spinner small" aria-hidden="true" /> : <ProgressDots done={done} total={total} label={progressText} />}
            <span aria-hidden={!up.endingSoon}>{up.endingSoon ? t('swap.allDone') : progressText}</span>
          </p>
          <button type="button" className="link-btn how-toggle" aria-expanded={howOpen} onClick={() => setHowOpen((o) => !o)}>
            <Icon name="help" size={16} /> {t('swap.howShow')} <Icon name="chevron-down" size={15} className={howOpen ? 'is-flipped' : ''} />
          </button>
          <div className="swap-how-wrap">
            <h2>{t('swap.howTitle')}</h2>
            <ol className="swap-how">
              <li>{t('swap.how1')}</li>
              <li>{t('swap.how2')}</li>
              <li>{t('swap.how3')}</li>
            </ol>
          </div>
          {isHost && !up.endingSoon && (
            <button type="button" className="btn btn-ghost btn-small host-skip" onClick={() => send({ t: 'skip' })}>
              <Icon name="skip" size={16} /> {t('swap.endNow')}
            </button>
          )}
          <p className="small muted swap-legal">
            <Icon name="shield" size={16} /> {t('swap.legal')}
          </p>
        </aside>
      </div>

      <ActionBar timer={<Timer deadline={state.deadline} serverNow={serverNow} compact urgent={state.lastCall} />} info={`${done}/${total}`}>
        {up.endingSoon ? (
          <button type="button" className="btn btn-white btn-block" disabled>
            <span className="spinner tiny" aria-hidden="true" /> {t('caption.allDone')}
          </button>
        ) : showChosen ? (
          <button type="button" className="btn btn-white btn-block" onClick={() => setChoosing(true)}>
            <Icon name="repeat" size={18} /> {t('swap.change')}
          </button>
        ) : mine ? (
          <button type="button" className="btn btn-white btn-block" onClick={() => setChoosing(false)}>
            <Icon name="check" size={18} /> {t('swap.keep')}
          </button>
        ) : (
          <button type="button" className="btn btn-pink btn-block" disabled={Boolean(picking)} onClick={surprise}>
            {picking === 'random' ? <span className="spinner tiny" aria-hidden="true" /> : <Icon name="dice" size={18} />} {t('swap.random')}
          </button>
        )}
      </ActionBar>
    </div>
  );
}
