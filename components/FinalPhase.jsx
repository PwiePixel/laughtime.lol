'use client';

import Link from 'next/link';
import { useCountdown } from './Timer';
import { ReportButton, reportInGame } from './ReportDialog';
import useReport from './useReport';
import Avatar from './Avatar';
import Confetti from './Confetti';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { useApp } from './Providers';

export default function FinalPhase({ game }) {
  const { t, account } = useApp();
  const { state, send, serverNow } = game;
  const isHost = state.hostId === state.you;
  const left = useCountdown(state.deadline, serverNow);
  const [openReport, reportDialog] = useReport();
  const ranking = [...state.players].filter((p) => p.connected || p.score > 0).sort((a, b) => b.score - a.score);
  const top = ranking.slice(0, 3);
  const tie = ranking.length > 1 && ranking[0].score === ranking[1].score;
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  const podiumOrder = [top[1], top[0], top[2]];

  return (
    <div className="phase final-phase">
      <Confetti count={80} />
      <div className="final-head">
        <h1>{t('final.title')}</h1>
        <p className="winner-line">{tie ? t('final.tie') : t('final.winner', { name: ranking[0]?.name || '?' })}</p>
      </div>

      <div className="podium">
        {podiumOrder.map((p, i) =>
          p ? (
            <div key={p.id} className={`podium-spot place-${[2, 1, 3][i]}`}>
              <Avatar value={p.avatar} size={[64, 88, 56][i]} />
              <strong className="podium-name">{p.name}</strong>
              <span className="podium-score">
                {p.score} {t('common.pts')}
              </span>
              <div className="podium-block">{[2, 1, 3][i]}</div>
            </div>
          ) : (
            <div key={`empty-${i}`} className="podium-spot is-empty" />
          ),
        )}
      </div>

      {ranking.length > 3 && (
        <ol className="card rest-list" start={4}>
          {ranking.slice(3).map((p) => (
            <li key={p.id}>
              <Avatar value={p.avatar} size={28} /> <span className="lb-name">{p.name}</span>
              <span className="lb-score">
                {p.score} {t('common.pts')}
              </span>
            </li>
          ))}
        </ol>
      )}

      {!account && (
        <p className="center-text final-cta">
          <Icon name="medal" size={18} /> {t('final.accountHint')}{' '}
          <a href="/login?mode=register" target="_blank" rel="noopener">
            {t('auth.register')}
          </a>
        </p>
      )}

      <div className="final-actions">
        {state.isPublic ? (
          <>
            {state.deadline > 0 && (
              <p className="next-game">
                <span className="spinner small" aria-hidden="true" /> {t('public.nextGame', { n: Math.ceil(left / 1000) })}
              </p>
            )}
            <Link
              href={`/play?game=${state.settings.game}`}
              className="btn btn-yellow btn-big"
              onClick={() => send({ t: 'leave' })}
            >
              <Icon name="shuffle" /> {t('public.newMatch')}
            </Link>
          </>
        ) : isHost ? (
          <button type="button" className="btn btn-yellow btn-big" onClick={() => send({ t: 'again' })}>
            <Icon name="repeat" /> {t('final.again')}
          </button>
        ) : (
          <p className="muted">{t('final.waitHost')}</p>
        )}
        {!state.activity && (
          <Link href="/" className="btn btn-white" onClick={() => send({ t: 'leave' })}>
            {t('common.leave')}
          </Link>
        )}
      </div>

      {state.final?.best?.length > 0 && (
        <section>
          <h2 className="section-title">{t('final.best')}</h2>
          <div className="result-grid">
            {state.final.best.map((b) => {
              const p = byId[b.pid];
              return (
                <div key={`${b.round}-${b.pid}`} className="card result-card">
                  <MemeCanvas media={b.meme.media} captions={b.meme.captions} maxHeight="260px" downloadable />
                  {b.meme.query && (
                    <span className="query-chip small-chip">
                      <Icon name="search" size={13} /> {b.meme.query}
                    </span>
                  )}
                  <div className="result-meta">
                    <Avatar value={p?.avatar} icon={p ? undefined : 'ghost'} size={30} />
                    <span className="result-name has-sub">
                      <span className="result-name-text">{p?.name || t('common.unknownPlayer')}</span>
                      <small className="muted">{t('final.round', { n: b.round })}</small>
                    </span>
                    <span className="result-points">{b.points}</span>
                    {b.pid !== state.you && (
                      <ReportButton
                        label={t('report.thisMeme')}
                        onClick={() =>
                          openReport({ kind: 'meme', name: p?.name, avatar: p?.avatar }, (reason, comment) =>
                            reportInGame(game, { target: 'result', pid: b.pid, round: b.round, reason, comment }),
                          )
                        }
                      />
                    )}
                  </div>
                  {b.from && b.from !== b.pid && (
                    <span className="result-from">
                      <Icon name="image-up" size={14} /> {t('swap.pictureBy', { name: byId[b.from]?.name || t('common.unknownPlayer') })}
                    </span>
                  )}
                  {b.galleryId && (
                    <a className="gallery-badge" href={`/m/${b.galleryId}`} target="_blank" rel="noopener">
                      <Icon name="images" size={14} /> {t('scores.savedToGallery')}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {reportDialog}
    </div>
  );
}
