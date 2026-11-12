'use client';

import { useEffect, useRef, useState } from 'react';
import { RATINGS } from '@/lib/shared';
import PhaseSub from './game/LastCall';
import VoteDist, { ProgressDots, useCountUp } from './game/VoteDist';
import Confetti from './Confetti';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { useApp } from './Providers';
import { FloatingReactions, ReactionBar } from './Reactions';
import Timer from './Timer';
import { reportInGame } from './ReportDialog';
import useReport from './useReport';

// how long the server shows a result before the next meme (for the timer bar only)
const REVEAL_MS = 3500;

function RevealCard({ vote }) {
  const { t } = useApp();
  const points = useCountUp(vote.points || 0);
  const avgIcon = RATINGS[Math.max(0, Math.round(vote.avg || 0) - 1)]?.icon;
  return (
    <div className={`reveal card ${vote.avg >= 4 ? 'is-hot' : ''}`}>
      {vote.avg >= 4 && <Confetti count={50} />}
      <div className="reveal-score">
        <div className="reveal-points" aria-hidden="true">
          {t('vote.points', { n: points })}
        </div>
        {vote.avg > 0 && (
          <div className="reveal-avg">
            {t('vote.avg', { n: vote.avg })} {avgIcon && <Icon name={avgIcon} size={18} />}
          </div>
        )}
      </div>
      {vote.dist && <VoteDist dist={vote.dist} />}
      <div className="reveal-mystery">
        <span className="mystery-avatar">
          <Icon name="help" size={22} strokeWidth={2.6} />
        </span>
        <span>{vote.isMine ? t('vote.mysteryYours') : t('vote.mystery')}</span>
      </div>
    </div>
  );
}

export default function VotePhase({ game }) {
  const { t } = useApp();
  const { state, send, serverNow, onReact } = game;
  const [openReport, reportDialog] = useReport();
  const v = state.vote;
  // the tapped rating shows at once; the server confirms with the next state
  const [local, setLocal] = useState({ index: -1, score: null });
  const live = useRef({});
  const reveal = v?.stage === 'reveal';
  const canVote = Boolean(v) && !reveal && !v.isMine;
  const myScore = v && local.index === v.index && local.score !== null ? local.score : v?.myScore ?? null;

  const vote = (score) => {
    if (!live.current.canVote) return;
    setLocal({ index: live.current.index, score });
    send({ t: 'vote', score });
  };
  live.current = { canVote, index: v?.index, vote };

  // keys 1-5 rate as well (not while typing or with a dialog open)
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-5]$/.test(e.key)) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.modal-backdrop')) return;
      live.current.vote(Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!v) return null;
  const hunt = state.settings.game === 'hunt';
  const last = v.index + 1 >= v.total;
  const votesText = t('vote.votes', { n: v.votes, total: v.voters });
  const counter = t('vote.counter', { n: v.index + 1, total: v.total });

  return (
    <div className={`phase vote-phase stage-${v.stage}`}>
      <div className="phase-head">
        <div>
          <h1>{t('vote.title')}</h1>
          <PhaseSub lastCall={state.lastCall && !reveal} done={v.isMine || myScore !== null}>
            {counter}
            {reveal ? ` · ${t(last ? 'vote.lastOne' : 'vote.next')}` : ''}
          </PhaseSub>
        </div>
        <Timer deadline={state.deadline} total={reveal ? REVEAL_MS : state.settings.voteTime * 1000} serverNow={serverNow} urgent={state.lastCall && !reveal} />
      </div>
      <p className="sr-only" aria-live="polite">
        {reveal ? `${t('vote.points', { n: v.points })}${v.avg > 0 ? `, ${t('vote.avg', { n: v.avg })}` : ''}` : counter}
      </p>

      <div className="vote-stage">
        <MemeCanvas
          key={`${v.index}-${v.meme.media.id}`}
          media={v.meme.media}
          captions={v.meme.captions}
          maxHeight="var(--stage-h)"
          className="pop-in"
          downloadable
        >
          <FloatingReactions onReact={onReact} />
          {v.sameAsPrev && (
            <span className="take-chip">
              <Icon name="copy" size={14} /> {t('swap.secondTake')}
            </span>
          )}
        </MemeCanvas>
        <div className="vote-meta">
          {/* GIF Hunt: the search term is part of the punchline - its place is kept free until the reveal */}
          {v.meme.query ? (
            <p className={`query-chip ${hunt ? 'stamp-in' : ''}`}>
              <Icon name="search" size={15} /> {t('vote.searchedFor', { q: v.meme.query })}
            </p>
          ) : (
            hunt && (
              <p className="query-chip is-secret" aria-hidden="true">
                <Icon name="search" size={15} /> ? ? ?
              </p>
            )
          )}
          {!v.isMine && (
            <button
              type="button"
              className="link-btn report-link"
              onClick={() => openReport({ kind: 'meme' }, (reason, comment) => reportInGame(game, { target: 'vote', reason, comment }))}
            >
              <Icon name="flag" size={14} /> {t('report.thisMeme')}
            </button>
          )}
        </div>
      </div>

      <div className="vote-dock">
        {reveal ? (
          <RevealCard key={v.index} vote={v} />
        ) : (
          <div className="vote-controls">
            {v.isMine ? (
              <p className="lead center-text with-icon vote-yours">
                <Icon name="eye" size={24} /> {t('vote.yours')}
              </p>
            ) : (
              <div className="rating-row" role="radiogroup" aria-label={t('vote.title')}>
                {RATINGS.map((r) => (
                  <button
                    key={r.score}
                    type="button"
                    role="radio"
                    aria-checked={myScore === r.score}
                    aria-keyshortcuts={String(r.score)}
                    className={`rating rating-${r.score} ${myScore === r.score ? 'on' : ''}`}
                    onClick={() => vote(r.score)}
                  >
                    <span className="rating-icon">
                      <Icon name={r.icon} size={34} strokeWidth={2.2} />
                    </span>
                    <span className="rating-label">{t(`vote.r${r.score}`)}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="vote-status">
              <ProgressDots done={v.votes} total={v.voters} label={votesText} />
              <span className="vote-status-text">
                {!v.isMine && myScore !== null ? (
                  <>
                    <Icon name="check" size={14} strokeWidth={3.2} /> {t('vote.thanks')}
                  </>
                ) : (
                  <span aria-hidden="true">{votesText}</span>
                )}
              </span>
              {!v.isMine && <span className="vote-keys">{t('vote.keys')}</span>}
            </p>
          </div>
        )}
        <ReactionBar send={send} />
      </div>
      {reportDialog}
    </div>
  );
}
