'use client';

import { useEffect, useRef, useState } from 'react';
import { CAPTION_COLORS, LIMITS, defaultCaptions, hasText, newCaption, nextCaptionY } from '@/lib/shared';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { useApp } from './Providers';
import Timer from './Timer';

/** GIF Hunt: search box (big when nothing was found yet, compact afterwards) */
function HuntSearch({ hunt, send, compact }) {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const left = hunt.searchesLeft;
  const busy = hunt.searching;
  const clean = q.trim();
  const submit = (e) => {
    e.preventDefault();
    if (clean.length < 2 || left <= 0 || busy) return;
    send({ t: 'search', q: clean });
  };
  return (
    <div className={`hunt-box ${compact ? 'is-compact' : 'card'}`}>
      {!compact && (
        <>
          <div className="hunt-badge" aria-hidden="true">
            <Icon name="search" size={42} strokeWidth={2.6} />
            <span>GIF</span>
          </div>
          <h2>{t('caption.huntTitle')}</h2>
          <p className="muted">{t('caption.huntSub', { n: hunt.max })}</p>
        </>
      )}
      {compact && hunt.query && (
        <p className="hunt-query">
          <span className="muted small">{t('caption.searchedFor')}</span> <strong>“{hunt.query}”</strong>
        </p>
      )}
      <div className="hunt-tries">
        {Array.from({ length: hunt.max }, (_, i) => (
          <span key={i} className={`try ${i < left ? 'on' : ''}`} aria-hidden="true">
            <Icon name="search" size={13} strokeWidth={3} />
          </span>
        ))}
        <span className="small">{left > 0 ? t('caption.searchesLeft', { n: left, max: hunt.max }) : t('caption.noSearchesLeft')}</span>
      </div>
      {left > 0 && (
        <form className="hunt-form" onSubmit={submit}>
          <input
            className="input"
            value={q}
            maxLength={40}
            placeholder={t('caption.searchPlaceholder')}
            aria-label={t('caption.search')}
            enterKeyHint="search"
            autoFocus={!compact}
            disabled={busy}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-cyan" type="submit" disabled={busy || clean.length < 2}>
            {busy ? <span className="spinner tiny" aria-hidden="true" /> : <Icon name="search" />}{' '}
            {compact ? t('caption.searchAgain') : t('caption.search')}
          </button>
        </form>
      )}
      {!compact && left > 0 && (
        <button type="button" className="btn btn-ghost btn-small hunt-surprise" disabled={busy} onClick={() => send({ t: 'search', random: true })}>
          <Icon name="dice" size={18} /> {t('caption.surprise')}
        </button>
      )}
      {busy && (
        <p className="hunt-busy" role="status">
          <span className="spinner small" aria-hidden="true" /> {t('caption.searching')}
        </p>
      )}
    </div>
  );
}

export default function CaptionPhase({ game }) {
  const { t } = useApp();
  const { state, send, serverNow } = game;
  const cap = state.caption || { spectator: true };
  const isHost = state.hostId === state.you && !state.isPublic;
  const [captions, setCaptions] = useState(() => (cap.captions?.length ? cap.captions : defaultCaptions()));
  const [selected, setSelected] = useState(0);
  const inputs = useRef([]);
  const draftTimer = useRef(null);
  const mediaKey = `${cap.media?.id}:${cap.draftVersion}`;

  // take over the server version after a re-roll / submit / reconnect,
  // but keep the jokes already typed when the template changes
  useEffect(() => {
    if (cap.spectator) return;
    setCaptions((local) => {
      if (hasText(cap.captions)) return cap.captions;
      if (hasText(local)) {
        send({ t: 'draft', captions: local });
        return local;
      }
      return defaultCaptions();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  useEffect(() => () => clearTimeout(draftTimer.current), []);

  // make sure the latest text reaches the server right before time runs out
  const latest = useRef(captions);
  latest.current = captions;
  useEffect(() => {
    if (cap.spectator || cap.submitted) return undefined;
    const ms = state.deadline - serverNow() - 1200;
    if (ms <= 0) return undefined;
    const id = setTimeout(() => send({ t: 'draft', captions: latest.current }), ms);
    return () => clearTimeout(id);
  }, [state.deadline, cap.spectator, cap.submitted, serverNow, send]);

  const playing = state.players.filter((p) => p.playing && p.connected);
  const done = playing.filter((p) => p.submitted).length;
  const total = state.settings.captionTime * 1000;

  if (cap.spectator) {
    return (
      <div className="phase caption-phase">
        <div className="phase-head">
          <h1>{t('caption.title')}</h1>
          <Timer deadline={state.deadline} total={total} serverNow={serverNow} />
        </div>
        <div className="card center">
          <div className="big-icon">
            <Icon name="popcorn" size={56} />
          </div>
          <p className="lead">{t('caption.spectator')}</p>
          <p className="muted">{t('caption.progress', { done, total: playing.length })}</p>
        </div>
      </div>
    );
  }

  function update(next) {
    setCaptions(next);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => send({ t: 'draft', captions: next }), 450);
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
    clearTimeout(draftTimer.current);
    send({ t: 'submit', captions });
  }

  const sel = captions[selected];
  const hunt = cap.hunt;
  const hasMedia = Boolean(cap.media);
  const canSubmit = hasText(captions) && hasMedia;

  return (
    <div className="phase caption-phase">
      <div className="phase-head">
        <div>
          <h1>{t('caption.title')}</h1>
          <p className="muted">{hunt ? t('caption.huntSub', { n: hunt.max }) : t('caption.sub')}</p>
        </div>
        <Timer deadline={state.deadline} total={total} serverNow={serverNow} />
      </div>

      <div className="editor">
        <div className="editor-stage">
          {hunt && !hasMedia ? (
            <HuntSearch hunt={hunt} send={send} />
          ) : (
          <MemeCanvas
            media={cap.media}
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
            maxHeight="min(62vh, 640px)"
            downloadable
          />
          )}
        </div>

        <div className="card editor-panel">
          {cap.submitted ? (
            <div className="submitted">
              <div className="big-icon is-green">
                <Icon name="check-circle" size={56} />
              </div>
              <p className="lead">{done === playing.length ? t('caption.allDone') : t('caption.submitted')}</p>
              <p className="muted">{t('caption.progress', { done, total: playing.length })}</p>
              {done < playing.length && (
                <button type="button" className="btn btn-white" onClick={() => send({ t: 'unsubmit' })}>
                  <Icon name="pencil" size={18} /> {t('caption.edit')}
                </button>
              )}
            </div>
          ) : (
            <>
              {hunt && hasMedia && <HuntSearch hunt={hunt} send={send} compact />}
              {cap.swapped && (
                <p className="swap-hint with-icon left">
                  <Icon name="swap" size={18} /> {t('swap.captionHint')}
                </p>
              )}
              {hunt && !hasMedia && (
                <p className="hunt-wait with-icon left">
                  <Icon name="search" size={18} /> {t('caption.waitForMedia')}
                </p>
              )}
              <div className="caption-inputs">
                {captions.map((c, i) => (
                  <div key={i} className={`caption-input ${selected === i ? 'on' : ''}`}>
                    <span className="caption-num">{i + 1}</span>
                    <textarea
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      className="input"
                      rows={2}
                      maxLength={LIMITS.captionText}
                      value={c.text}
                      placeholder={t('caption.placeholder', { n: i + 1 })}
                      onFocus={() => setSelected(i)}
                      onChange={(e) => patch(i, { text: e.target.value })}
                    />
                    {captions.length > 1 && (
                      <button
                        type="button"
                        className="caption-remove"
                        aria-label={t('caption.remove')}
                        title={t('caption.remove')}
                        onClick={() => remove(i)}
                      >
                        <Icon name="x" size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {sel && (
                <div className="caption-tools">
                  <label className="tool">
                    <span>{t('caption.size')}</span>
                    <input
                      type="range"
                      min={3}
                      max={18}
                      step={0.5}
                      value={sel.size}
                      onChange={(e) => patch(selected, { size: Number(e.target.value) })}
                    />
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

              <div className="editor-actions">
                <button type="button" className="btn btn-white" onClick={addText} disabled={captions.length >= LIMITS.captions}>
                  <Icon name="plus" /> {t('caption.add')}
                </button>
                {state.settings.game === 'classic' && (
                  <button
                    type="button"
                    className="btn btn-pink"
                    onClick={() => send({ t: 'reroll' })}
                    disabled={cap.rerollsLeft <= 0}
                  >
                    <Icon name="dice" /> {t('caption.reroll', { n: cap.rerollsLeft })}
                  </button>
                )}
              </div>
              <button type="button" className="btn btn-yellow btn-big btn-block" onClick={submit} disabled={!canSubmit}>
                {t('caption.submit')}
              </button>
              <p className="muted small center-text">{t('caption.progress', { done, total: playing.length })}</p>
            </>
          )}
          {isHost && (
            <button type="button" className="btn btn-ghost btn-small host-skip" onClick={() => send({ t: 'skip' })}>
              <Icon name="skip" size={16} /> {t('caption.endNow')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
