'use client';

import Avatar from './Avatar';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { useApp } from './Providers';
import { useCountdown } from './Timer';
import { ReportButton, reportInGame } from './ReportDialog';
import useReport from './useReport';

export default function ScoresPhase({ game }) {
  const { t } = useApp();
  const { state, send, serverNow } = game;
  const [openReport, reportDialog] = useReport();
  const left = useCountdown(state.deadline, serverNow);
  const isHost = state.hostId === state.you;
  const results = state.results || [];
  const board = [...state.players].filter((p) => p.connected || p.score > 0).sort((a, b) => b.score - a.score);
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));

  return (
    <div className="phase scores-phase">
      <div className="phase-head">
        <h1>{t('scores.title', { n: state.round })}</h1>
        <div className="next-info">
          <span className="muted">{t('scores.nextIn', { n: Math.ceil(left / 1000) })}</span>
          {isHost && !state.isPublic && (
            <button type="button" className="btn btn-yellow" onClick={() => send({ t: 'skip' })}>
              {state.lastRound ? t('scores.toFinal') : t('scores.next')} <Icon name="arrow-right" />
            </button>
          )}
        </div>
      </div>

      <div className="scores-layout">
        <div className="result-grid">
          {results.length > 0 && (
            <h2 className="reveal-title">
              <Icon name="sparkles" /> {t('scores.reveal')}
            </h2>
          )}
          {results.length === 0 && <p className="card lead">{t('scores.noMemes')}</p>}
          {results.map((r, i) => {
            const p = byId[r.pid];
            return (
              <div
                key={r.pid}
                className={`card result-card ${i === 0 && r.points > 0 ? 'is-top' : ''}`}
                style={{ '--reveal-delay': `${0.35 + (results.length - 1 - i) * 0.45}s` }}
              >
                {i === 0 && r.points > 0 && (
                  <span className="ribbon">
                    <Icon name="trophy" size={22} />
                  </span>
                )}
                <MemeCanvas media={r.meme.media} captions={r.meme.captions} maxHeight="240px" downloadable />
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
                {r.from && r.from !== r.pid && (
                  <span className="result-from author-reveal">
                    <Icon name="image-up" size={14} /> {t('swap.pictureBy', { name: byId[r.from]?.name || t('common.unknownPlayer') })}
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

        <div className="card leaderboard">
          <h2>{t('scores.leaderboard')}</h2>
          <ol>
            {board.map((p, i) => (
              <li key={p.id} className={p.id === state.you ? 'is-me' : ''}>
                <span className="rank">{i + 1}</span>
                <Avatar value={p.avatar} size={36} />
                <span className="lb-name">{p.name}</span>
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
