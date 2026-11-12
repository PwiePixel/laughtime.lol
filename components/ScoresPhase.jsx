'use client';

import VoteDist from './game/VoteDist';
import Avatar from './Avatar';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { MediaThumb } from './PackCard';
import { useApp } from './Providers';
import { useSecondsLeft } from './Timer';
import { ReportButton, reportInGame } from './ReportDialog';
import useReport from './useReport';

/** "continues in n s" - its own component so the result cards do not re-render with the clock */
function NextIn({ state, serverNow }) {
  const { t } = useApp();
  const secs = useSecondsLeft(state.deadline, serverNow);
  return (
    <span className="muted next-in" role="timer">
      {state.lastRound ? t('scores.finalIn', { s: secs }) : t('scores.nextRound', { n: state.round + 1, s: secs })}
    </span>
  );
}

export default function ScoresPhase({ game }) {
  const { t } = useApp();
  const { state, send, serverNow } = game;
  const [openReport, reportDialog] = useReport();
  const isHost = state.hostId === state.you;
  const results = state.results || [];
  const leftover = state.leftover || [];
  const board = [...state.players].filter((p) => p.connected || p.score > 0).sort((a, b) => b.score - a.score);
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  const nameOf = (pid) => byId[pid]?.name || t('common.unknownPlayer');
  // the winner is always uncovered after 3.5 s at the latest, however many memes there are
  const step = Math.min(0.45, 3 / Math.max(1, results.length));

  return (
    <div className="phase scores-phase">
      <div className="phase-head">
        <h1>{t('scores.title', { n: state.round })}</h1>
        <div className="next-info">
          <NextIn state={state} serverNow={serverNow} />
          {isHost && !state.isPublic && (
            <button type="button" className="btn btn-yellow" onClick={() => send({ t: 'skip' })}>
              {state.lastRound ? t('scores.toFinal') : t('scores.next')} <Icon name="arrow-right" />
            </button>
          )}
        </div>
      </div>

      <div className="scores-layout">
        <div className="results-col">
          {results.length > 0 && (
            <h2 className="reveal-title">
              <Icon name="sparkles" /> {t('scores.reveal')}
            </h2>
          )}
          {results.length === 0 && <p className="card lead">{t('scores.noMemes')}</p>}
          <div className="result-grid" tabIndex={results.length > 1 ? 0 : undefined}>
            {results.map((r, i) => {
              const p = byId[r.pid];
              const top = i === 0 && r.points > 0;
              return (
                <div
                  key={r.pid}
                  className={`card result-card ${top ? 'is-top' : ''}`}
                  style={{ '--reveal-delay': `${(0.35 + (results.length - 1 - i) * step).toFixed(2)}s`, '--i': i }}
                >
                  {top && (
                    <span className="ribbon">
                      <Icon name="trophy" size={22} />
                    </span>
                  )}
                  <MemeCanvas media={r.meme.media} captions={r.meme.captions} maxHeight="var(--result-h)" downloadable />
                  {r.meme.query && (
                    <span className="query-chip small-chip">
                      <Icon name="search" size={13} /> {r.meme.query}
                    </span>
                  )}
                  <div className="result-meta author-reveal">
                    <Avatar value={p?.avatar} icon={p ? undefined : 'ghost'} size={30} />
                    <span className="result-name">{p?.name || t('common.unknownPlayer')}</span>
                    <span className="result-points">+{r.points}</span>
                    {r.pid !== state.you && (
                      <ReportButton
                        label={t('report.thisMeme')}
                        onClick={() =>
                          openReport({ kind: 'meme', name: p?.name, avatar: p?.avatar }, (reason, comment) =>
                            reportInGame(game, { target: 'result', pid: r.pid, round: state.round, reason, comment }),
                          )
                        }
                      />
                    )}
                  </div>
                  {r.dist && <VoteDist dist={r.dist} compact />}
                  {r.from && r.from !== r.pid && (
                    <span className="result-from author-reveal">
                      <Icon name="image-up" size={14} /> <span className="result-from-name">{t('swap.pictureBy', { name: nameOf(r.from) })}</span>
                      {r.assist?.points > 0 && <span className="assist-chip">{t('swap.assist', { n: r.assist.points })}</span>}
                    </span>
                  )}
                  {r.galleryId && (
                    <a className="gallery-badge" href={`/m/${r.galleryId}`} target="_blank" rel="noopener">
                      <Icon name="images" size={14} /> {t('scores.savedToGallery')}
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {leftover.length > 0 && (
            <section className="leftover">
              <h2 className="leftover-title">
                <Icon name="package" size={18} /> {t('swap.leftover')}
              </h2>
              <ul className="leftover-list">
                {leftover.map((l, i) => (
                  <li key={`${l.pid}-${i}`}>
                    <MediaThumb media={l.media} />
                    <span>{nameOf(l.pid)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="card leaderboard">
          <h2>{t('scores.leaderboard')}</h2>
          <ol>
            {board.map((p, i) => (
              <li key={p.id} className={p.id === state.you ? 'is-me' : ''} style={{ '--i': i }}>
                <span className="rank">{i + 1}</span>
                <Avatar value={p.avatar} size={36} />
                <span className="lb-name">{p.name}</span>
                {p.streak >= 2 && (
                  <span className="lb-streak" title={t('scores.streak', { n: p.streak })}>
                    <Icon name="flame" size={15} strokeWidth={2.8} label={t('scores.streak', { n: p.streak })} />
                    {p.streak}
                  </span>
                )}
                {p.lastPoints > 0 && <span className="lb-delta">+{p.lastPoints}</span>}
                <span className="lb-score">
                  {p.score} <small>{t('common.pts')}</small>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {reportDialog}
    </div>
  );
}
