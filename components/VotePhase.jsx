'use client';

import { RATINGS } from '@/lib/shared';
import Confetti from './Confetti';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { useApp } from './Providers';
import { FloatingReactions, ReactionBar } from './Reactions';
import Timer from './Timer';
import { reportInGame } from './ReportDialog';
import useReport from './useReport';

export default function VotePhase({ game }) {
  const { t } = useApp();
  const { state, send, serverNow, onReact } = game;
  const [openReport, reportDialog] = useReport();
  const v = state.vote;
  if (!v) return null;
  const reveal = v.stage === 'reveal';
  const avgIcon = RATINGS[Math.max(0, Math.round(v.avg || 0) - 1)]?.icon;

  return (
    <div className="phase vote-phase">
      <div className="phase-head">
        <div>
          <h1>{t('vote.title')}</h1>
          <p className="muted">{t('vote.counter', { n: v.index + 1, total: v.total })}</p>
        </div>
        {!reveal && <Timer deadline={state.deadline} total={state.settings.voteTime * 1000} serverNow={serverNow} />}
      </div>

      <div className="vote-stage">
        <MemeCanvas
          key={`${v.index}-${v.meme.media.id}`}
          media={v.meme.media}
          captions={v.meme.captions}
          maxHeight="min(54vh, 580px)"
          className="pop-in"
          downloadable
        >
          <FloatingReactions onReact={onReact} />
        </MemeCanvas>
        {v.meme.query && (
          <p className="query-chip">
            <Icon name="search" size={15} /> {t('vote.searchedFor', { q: v.meme.query })}
          </p>
        )}

        {reveal && (
          <div className="reveal card pop-in">
            {v.avg >= 4 && <Confetti count={50} />}
            <div className="reveal-points">{t('vote.points', { n: v.points })}</div>
            {v.avg > 0 && (
              <div className="muted with-icon">
                {t('vote.avg', { n: v.avg })} {avgIcon && <Icon name={avgIcon} size={18} />}
              </div>
            )}
            <div className="reveal-mystery">
              <span className="mystery-avatar">
                <Icon name="help" size={26} strokeWidth={2.6} />
              </span>
              <span>{v.isMine ? t('vote.mysteryYours') : t('vote.mystery')}</span>
            </div>
          </div>
        )}
      </div>

      {!reveal && (
        <div className="vote-controls">
          {v.isMine ? (
            <p className="lead center-text with-icon">
              <Icon name="eye" size={24} /> {t('vote.yours')}
            </p>
          ) : (
            <>
              <div className="rating-row" role="radiogroup" aria-label={t('vote.title')}>
                {RATINGS.map((r) => (
                  <button
                    key={r.score}
                    type="button"
                    role="radio"
                    aria-checked={v.myScore === r.score}
                    className={`rating rating-${r.score} ${v.myScore === r.score ? 'on' : ''}`}
                    onClick={() => send({ t: 'vote', score: r.score })}
                  >
                    <span className="rating-icon">
                      <Icon name={r.icon} size={34} strokeWidth={2.2} />
                    </span>
                    <span className="rating-label">{t(`vote.r${r.score}`)}</span>
                  </button>
                ))}
              </div>
              {v.myScore && <p className="muted center-text small">{t('vote.thanks')}</p>}
            </>
          )}
          <p className="muted center-text small">{t('vote.votes', { n: v.votes, total: v.voters })}</p>
          {!v.isMine && (
            <p className="center-text">
              <button
                type="button"
                className="link-btn report-link"
                onClick={() => openReport({ kind: 'meme' }, (reason, comment) => reportInGame(game, { target: 'vote', reason, comment }))}
              >
                <Icon name="flag" size={14} /> {t('report.thisMeme')}
              </button>
            </p>
          )}
        </div>
      )}
      <ReactionBar send={send} />
      {reportDialog}
    </div>
  );
}
