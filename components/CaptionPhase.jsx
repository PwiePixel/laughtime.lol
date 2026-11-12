'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTION_COLORS, LIMITS, defaultCaptions, hasText, newCaption, nextCaptionY } from '@/lib/shared';
import ActionBar from './game/ActionBar';
import HandTray from './game/HandTray';
import PhaseSub from './game/LastCall';
import { ProgressDots } from './game/VoteDist';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { useApp } from './Providers';
import { FloatingReactions, ReactionBar } from './Reactions';
import Timer from './Timer';

// drafts: sent after a pause in typing, at the latest every few seconds while typing goes on
const DRAFT_IDLE_MS = 700;
const DRAFT_MAX_MS = 3000;
const SEARCH_ERRORS = new Set(['search_empty', 'search_short', 'search_blocked', 'search_limit', 'no_searches_left', 'no_lucky_left', 'search_first']);

/**
 * Keeps the server copy of the captions up to date without a message per keystroke.
 * `flush()` sends right away (before a pick, search, re-roll or the deadline).
 */
function useDraftSync(captions, serverCaptions, send) {
  const latest = useRef(captions);
  latest.current = captions;
  const sent = useRef(JSON.stringify(serverCaptions || null));
  const sentText = useRef(hasText(serverCaptions));
  const timer = useRef(null);
  const dirtySince = useRef(0);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    dirtySince.current = 0;
    const json = JSON.stringify(latest.current);
    if (json === sent.current) return;
    // empty boxes are no news as long as the server has no text either
    if (!hasText(latest.current) && !sentText.current) return;
    if (send({ t: 'draft', captions: latest.current })) {
      sent.current = json;
      sentText.current = hasText(latest.current);
    }
  }, [send]);

  const queue = useCallback(() => {
    const t = Date.now();
    if (!dirtySince.current) dirtySince.current = t;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, Math.max(0, Math.min(DRAFT_IDLE_MS, dirtySince.current + DRAFT_MAX_MS - t)));
  }, [flush]);

  /** the server changed its copy (new picture, re-roll): compare against that from now on */
  const rebase = useCallback((server) => {
    sent.current = JSON.stringify(server || null);
    sentText.current = hasText(server);
  }, []);

  /** a submit carries the captions itself */
  const markSent = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    dirtySince.current = 0;
    sent.current = JSON.stringify(latest.current);
    sentText.current = hasText(latest.current);
  }, []);

  // nothing typed may get lost when the tab goes to the background
  useEffect(() => {
    const hidden = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
      clearTimeout(timer.current);
    };
  }, [flush]);

  return { flush, queue, rebase, markSent };
}

function SearchForm({ compact, left, busy, autoFocus, onSearch }) {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const clean = q.trim();
  return (
    <form
      className={`hunt-form ${compact ? 'is-compact' : ''}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length < 2 || busy) return;
        onSearch(clean);
        if (compact) setQ('');
      }}
    >
      <input
        className="input"
        value={q}
        maxLength={40}
        placeholder={compact ? t('hunt.searchMore', { n: left }) : t('caption.searchPlaceholder')}
        aria-label={compact ? t('hunt.searchMore', { n: left }) : t('caption.search')}
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
      />
      <button className="btn btn-cyan" type="submit" disabled={busy || clean.length < 2} aria-label={compact ? t('caption.search') : undefined}>
        {busy ? <span className="spinner tiny" aria-hidden="true" /> : <Icon name="search" />}
        {!compact && <span>{t('caption.search')}</span>}
      </button>
    </form>
  );
}

function Tries({ hunt }) {
  const { t } = useApp();
  const left = hunt.searchesLeft;
  return (
    <div className="hunt-tries">
      {Array.from({ length: hunt.max }, (_, i) => (
        <span key={i} className={`try ${i < left ? 'on' : ''}`} aria-hidden="true">
          <Icon name="search" size={13} strokeWidth={3} />
        </span>
      ))}
      <span className="small">{left > 0 ? t('caption.searchesLeft', { n: left, max: hunt.max }) : t('caption.noSearchesLeft')}</span>
    </div>
  );
}

function Skeletons() {
  const { t } = useApp();
  return (
    <div className="hand-skeleton" role="status">
      <span className="sr-only">{t('caption.searching')}</span>
      {[0, 1, 2, 3].map((i) => (
        <i key={i} style={{ '--i': i }} />
      ))}
    </div>
  );
}

/** GIF Hunt before the first find: the search card */
function HuntStart({ hunt, busy, empty, onSearch, onLucky }) {
  const { t } = useApp();
  const canSearch = hunt.searchesLeft > 0;
  return (
    <div className="hunt-box card hunt-start">
      <div className="hunt-badge" aria-hidden="true">
        <Icon name="search" size={42} strokeWidth={2.6} />
        <span>GIF</span>
      </div>
      <h2>{t('caption.huntTitle')}</h2>
      <p className="muted hunt-intro">{t('caption.huntSub', { n: hunt.max })}</p>
      {canSearch && <SearchForm left={hunt.searchesLeft} busy={busy} autoFocus onSearch={onSearch} />}
      {canSearch && hunt.ideas?.length > 0 && (
        <div className="idea-row">
          <span className="idea-label">{t('hunt.ideas')}</span>
          {hunt.ideas.map((idea) => (
            <button key={idea} type="button" className="chip idea-chip" disabled={busy} onClick={() => onSearch(idea)}>
              {idea}
            </button>
          ))}
        </div>
      )}
      {busy ? (
        <Skeletons />
      ) : (
        hunt.luckyLeft > 0 && (
          <button type="button" className="btn btn-pink btn-small hunt-lucky" onClick={onLucky}>
            <Icon name="dice" size={18} /> {t('hunt.lucky')}
          </button>
        )
      )}
      {empty && !busy && (
        <p className="hunt-empty" role="status">
          <Icon name="search-x" size={18} /> {t('caption.noResults', { q: empty })}
        </p>
      )}
      <Tries hunt={hunt} />
    </div>
  );
}

/** everybody who cannot write this round: late joiners and spectators */
function Watching({ game, done, total }) {
  const { t } = useApp();
  const { state, send, serverNow, onReact } = game;
  return (
    <div className="phase caption-phase is-watching">
      <div className="phase-head">
        <div>
          <h1>{t('caption.title')}</h1>
          <PhaseSub lastCall={state.lastCall} done>
            {t('caption.watching')}
          </PhaseSub>
        </div>
        <Timer deadline={state.deadline} total={state.settings.captionTime * 1000} serverNow={serverNow} urgent={state.lastCall} />
      </div>
      <div className="card center watch-card">
        <FloatingReactions onReact={onReact} />
        <div className="big-icon">
          <Icon name="popcorn" size={56} />
        </div>
        <p className="lead">{t('caption.spectator')}</p>
        <p className="wait-progress">
          <ProgressDots done={done} total={total} label={t('caption.progress', { done, total })} />
          <span aria-hidden="true">{t('caption.progress', { done, total })}</span>
        </p>
        <p className="small wait-hint">{t('caption.waitReact')}</p>
        <ReactionBar send={send} />
      </div>
    </div>
  );
}

export default function CaptionPhase({ game }) {
  const { state } = game;
  const playing = state.players.filter((p) => p.playing && p.connected);
  const done = playing.filter((p) => p.submitted).length;
  if (!state.caption || state.caption.spectator) return <Watching game={game} done={done} total={playing.length} />;
  return <Editor game={game} done={done} total={playing.length} />;
}

function Editor({ game, done, total }) {
  const { t } = useApp();
  const { state, status, send, serverNow, onReact, onError } = game;
  const cap = state.caption;
  const gameId = state.settings.game;
  const isHost = state.hostId === state.you && !state.isPublic;
  const hunt = cap.hunt;
  const hand = cap.hand || [];
  const [captions, setCaptions] = useState(() => (cap.captions?.length ? cap.captions : defaultCaptions()));
  const [selected, setSelected] = useState(0);
  const [more, setMore] = useState(false);
  // optimistic feedback: the tapped tile, the running search, a submit on its way
  const [pending, setPending] = useState(null);
  const [searching, setSearching] = useState(false);
  const [empty, setEmpty] = useState(null);
  const [sending, setSending] = useState(false);
  const lastQuery = useRef('');
  const inputs = useRef([]);
  const draft = useDraftSync(captions, cap.captions, send);
  const mediaKey = `${cap.media?.id}:${cap.draftVersion}`;

  // The picture changed (pick, search, re-roll, shared picture replaced): the jokes
  // already typed stay; the server copy is brought in line if it lost them.
  const firstKey = useRef(mediaKey);
  useEffect(() => {
    if (firstKey.current === mediaKey) return;
    firstKey.current = mediaKey;
    draft.rebase(cap.captions);
    draft.queue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  // the server answered: optimistic marks are no longer needed
  useEffect(() => {
    setPending(null);
    setSearching(false);
  }, [cap.pickedId, cap.handKey, cap.media?.id]);
  useEffect(() => {
    if (hunt?.searching) setSearching(false); // the server shows the running search itself
  }, [hunt?.searching]);
  useEffect(() => setSending(false), [cap.submitted]);

  useEffect(
    () =>
      onError((code) => {
        setSending(false);
        if (code === 'item_expired') setPending(null);
        if (SEARCH_ERRORS.has(code)) {
          setSearching(false);
          setEmpty(code === 'search_empty' ? lastQuery.current : null);
        }
      }),
    [onError],
  );

  // after a reconnect the server may have missed the last words
  useEffect(() => {
    if (status === 'open' && !cap.submitted) draft.queue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // make sure the latest text reaches the server right before time runs out
  useEffect(() => {
    if (cap.submitted) return undefined;
    const ms = state.deadline - serverNow() - 1200;
    if (ms <= 0) return undefined;
    const id = setTimeout(draft.flush, ms);
    return () => clearTimeout(id);
  }, [state.deadline, cap.submitted, serverNow, draft.flush]);

  function update(next) {
    setCaptions(next);
    draft.queue();
  }

  const patch = (i, p) => update(captions.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
  const move = (i, x, y) => patch(i, { x, y });

  function addText() {
    if (captions.length >= LIMITS.captions) return;
    const next = [...captions, newCaption(nextCaptionY(captions.length))];
    update(next);
    setSelected(next.length - 1);
    setTimeout(() => inputs.current[next.length - 1]?.focus(), 30);
  }

  function remove(i) {
    const next = captions.filter((_, idx) => idx !== i);
    update(next.length ? next : defaultCaptions());
    setSelected(next.length ? Math.max(0, i - 1) : 0);
  }

  function submit() {
    if (!send({ t: 'submit', captions })) return;
    draft.markSent();
    setSending(true);
    setTimeout(() => setSending(false), 4000);
  }

  function pick(id) {
    if (cap.submitted || id === (pending || cap.pickedId)) return;
    draft.flush();
    if (!send({ t: 'pick', id })) return;
    setPending(id);
    setTimeout(() => setPending((p) => (p === id ? null : p)), 4000);
  }

  function startSearch(msg, q) {
    if (searching || hunt?.searching) return;
    draft.flush();
    if (!send(msg)) return;
    lastQuery.current = q;
    setEmpty(null);
    setSearching(true);
    setTimeout(() => setSearching(false), 9000);
  }
  const search = (q) => startSearch({ t: 'search', q }, q);
  const lucky = () => startSearch({ t: 'search', random: true }, '');

  function reroll() {
    draft.flush();
    send({ t: 'reroll' });
  }

  const busy = searching || Boolean(hunt?.searching);
  const pickedId = pending || cap.pickedId;
  // show the tapped tile at once; the server confirms a moment later
  const media = (pending && hand.find((tile) => tile.id === pending)?.media) || cap.media;
  const hasMedia = Boolean(media);
  const sel = captions[selected];
  const texted = hasText(captions);
  const canSubmit = texted && hasMedia;
  const allDone = done === total;
  const duo = gameId === 'swap' && hand.length > 1;
  const twoPlayers = state.players.filter((p) => p.connected).length <= 2;
  const progressText = t('caption.progress', { done, total });
  const sub = hunt ? t('caption.huntSub', { n: hunt.max }) : t('caption.sub');

  return (
    <div className={`phase caption-phase has-bar game-${gameId} ${cap.submitted ? 'is-submitted' : ''}`}>
      <div className="phase-head">
        <div>
          <h1>{t('caption.title')}</h1>
          <PhaseSub lastCall={state.lastCall} done={cap.submitted}>
            {sub}
          </PhaseSub>
        </div>
        <Timer deadline={state.deadline} total={state.settings.captionTime * 1000} serverNow={serverNow} urgent={state.lastCall} />
      </div>

      <div className="editor">
        <div className="editor-stage">
          {hunt && !hasMedia ? (
            <HuntStart hunt={hunt} busy={busy} empty={empty} onSearch={search} onLucky={lucky} />
          ) : (
            <>
              <MemeCanvas
                media={media}
                captions={captions}
                editable={!cap.submitted}
                selected={cap.submitted ? -1 : selected}
                onSelect={(i) => {
                  setSelected(i);
                  if (i >= 0) inputs.current[i]?.focus({ preventScroll: true });
                }}
                onMove={move}
                onFail={() =>
                  send({
                    t: 'broken',
                    id: cap.media?.id,
                    noVideo: !document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'),
                  })
                }
                placeholder={(i) => t('caption.placeholder', { n: i + 1 })}
                maxHeight="var(--stage-h)"
                downloadable
              >
                {cap.submitted && <FloatingReactions onReact={onReact} />}
              </MemeCanvas>
              {cap.shared && (
                <p className="stage-chip same-chip">
                  <Icon name="copy" size={15} /> {t('same.hint')}
                </p>
              )}
            </>
          )}
        </div>

        <div className="card editor-panel">
          {cap.submitted ? (
            <div className="submitted">
              <div className="big-icon is-green pop-in">
                <Icon name="check-circle" size={56} />
              </div>
              <p className="lead" role="status">
                {allDone ? t('caption.allDone') : t('caption.submitted')}
              </p>
              <p className="wait-progress">
                <ProgressDots done={done} total={total} label={progressText} />
                <span aria-hidden="true">{progressText}</span>
              </p>
              {!allDone && (
                <button type="button" className="btn btn-white desktop-action" onClick={() => send({ t: 'unsubmit' })}>
                  <Icon name="pencil" size={18} /> {t('caption.edit')}
                </button>
              )}
              <p className="small wait-hint">{t('caption.waitReact')}</p>
              <ReactionBar send={send} />
            </div>
          ) : (
            <>
              {hunt && hasMedia && (
                <div className="hunt-more">
                  <HandTray hand={hand} pickedId={pickedId} onPick={pick} title={t('hunt.trayTitle')} />
                  {busy && <Skeletons />}
                  {empty && !busy && (
                    <p className="hunt-empty" role="status">
                      <Icon name="search-x" size={18} /> {t('caption.noResults', { q: empty })}
                    </p>
                  )}
                  {hunt.searchesLeft > 0 || hunt.luckyLeft > 0 ? (
                    <div className="hunt-again">
                      {hunt.searchesLeft > 0 && <SearchForm compact left={hunt.searchesLeft} busy={busy} onSearch={search} />}
                      {hunt.luckyLeft > 0 && (
                        <button type="button" className="btn btn-pink btn-small hunt-lucky" disabled={busy} onClick={lucky} title={t('hunt.lucky')}>
                          <Icon name="dice" size={18} /> <span>{t('hunt.lucky')}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="hunt-out small">
                      <Icon name="search" size={15} /> {t('caption.noSearchesLeft')}
                    </p>
                  )}
                </div>
              )}
              {hunt && !hasMedia && (
                <p className="hunt-wait with-icon left">
                  <Icon name="search" size={18} /> {t('caption.waitForMedia')}
                </p>
              )}
              {duo && <HandTray variant="duo" hand={hand} pickedId={pickedId} onPick={pick} title={t('swap.pickOne')} />}
              {!duo && cap.swapped && (
                <p className="swap-hint with-icon left">
                  <Icon name="swap" size={18} /> {t(twoPlayers ? 'swap.fromOther' : 'swap.captionHint')}
                </p>
              )}

              <div className="caption-inputs">
                {captions.map((c, i) => (
                  <div key={i} className={`caption-input ${selected === i ? 'on' : ''}`}>
                    <span className="caption-num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <textarea
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      className="input"
                      rows={2}
                      maxLength={LIMITS.captionText}
                      value={c.text}
                      placeholder={t('caption.placeholder', { n: i + 1 })}
                      aria-label={t('caption.textN', { n: i + 1 })}
                      enterKeyHint="done"
                      onFocus={() => setSelected(i)}
                      onChange={(e) => patch(i, { text: e.target.value })}
                    />
                    {captions.length > 1 && (
                      <button type="button" className="caption-remove" aria-label={t('caption.remove')} title={t('caption.remove')} onClick={() => remove(i)}>
                        <Icon name="x" size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button type="button" className="link-btn more-toggle" aria-expanded={more} onClick={() => setMore((m) => !m)}>
                <Icon name="settings" size={15} /> {t('caption.more')} <Icon name="chevron-down" size={15} className={more ? 'is-flipped' : ''} />
              </button>
              <div className={`caption-extra ${more ? 'is-open' : ''}`}>
                {sel && (
                  <div className="caption-tools">
                    <label className="tool">
                      <span>{t('caption.size')}</span>
                      <input type="range" min={3} max={18} step={0.5} value={sel.size} onChange={(e) => patch(selected, { size: Number(e.target.value) })} />
                    </label>
                    <div className="tool">
                      <span>{t('caption.color')}</span>
                      <div className="color-row">
                        {CAPTION_COLORS.map((col) => (
                          <button
                            key={col}
                            type="button"
                            className={`swatch small ${sel.color === col ? 'on' : ''}`}
                            style={{ background: col }}
                            aria-label={col}
                            aria-pressed={sel.color === col}
                            onClick={() => patch(selected, { color: col })}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="tool-row">
                      <button
                        type="button"
                        className={`btn btn-small ${sel.upper ? 'btn-cyan' : 'btn-white'}`}
                        aria-pressed={sel.upper}
                        onClick={() => patch(selected, { upper: !sel.upper })}
                      >
                        {t('caption.caps')}
                      </button>
                      {captions.length > 1 && (
                        <button type="button" className="btn btn-small btn-white" onClick={() => remove(selected)}>
                          <Icon name="trash" size={16} /> {t('caption.remove')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="editor-actions">
                <button type="button" className="btn btn-white" onClick={addText} disabled={captions.length >= LIMITS.captions}>
                  <Icon name="plus" /> {t('caption.add')}
                </button>
                {gameId === 'classic' && (
                  <button type="button" className="btn btn-pink" onClick={reroll} disabled={cap.rerollsLeft <= 0}>
                    <Icon name="dice" /> {t('caption.reroll', { n: cap.rerollsLeft })}
                  </button>
                )}
              </div>

              <button type="button" className="btn btn-yellow btn-big btn-block desktop-action" onClick={submit} disabled={!canSubmit || sending}>
                {sending ? <span className="spinner tiny" aria-hidden="true" /> : null} {t('caption.submit')}
              </button>
              <p className="muted small center-text desktop-action">{progressText}</p>
            </>
          )}
          {isHost && (
            <button type="button" className="btn btn-ghost btn-small host-skip" onClick={() => send({ t: 'skip' })}>
              <Icon name="skip" size={16} /> {t('caption.endNow')}
            </button>
          )}
        </div>
      </div>

      <ActionBar timer={<Timer deadline={state.deadline} serverNow={serverNow} compact urgent={state.lastCall} />} info={`${done}/${total}`}>
        {cap.submitted ? (
          <button type="button" className="btn btn-white btn-block" disabled={allDone} onClick={() => send({ t: 'unsubmit' })}>
            <Icon name={allDone ? 'check' : 'pencil'} size={18} /> {allDone ? t('caption.allDone') : t('caption.edit')}
          </button>
        ) : (
          <button type="button" className="btn btn-yellow btn-block" onClick={submit} disabled={!canSubmit || sending}>
            {sending ? <span className="spinner tiny" aria-hidden="true" /> : null}
            {canSubmit ? t('caption.submit') : t(hasMedia ? 'caption.textFirst' : 'caption.pickFirst')}
          </button>
        )}
      </ActionBar>
    </div>
  );
}
