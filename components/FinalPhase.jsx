'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ActionBar from './game/ActionBar';
import AwardCard from './game/AwardCard';
import { useSecondsLeft } from './Timer';
import { ReportButton, reportInGame } from './ReportDialog';
import useReport from './useReport';
import Avatar from './Avatar';
import Confetti from './Confetti';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { useApp } from './Providers';

// reconnects and late arrivals get the finished picture instead of a replay
const REPLAY_WINDOW_MS = 8000;
// the winner steps up last (podium: third, second, first)
const WINNER_AT_MS = 1500;

function NextGame({ state, serverNow, head = false }) {
  const { t } = useApp();
  const secs = useSecondsLeft(state.deadline, serverNow);
  return (
    <p className={`next-game ${head ? 'next-game-head' : ''}`} role="timer">
      <span className="spinner small" aria-hidden="true" /> {t('public.nextGame', { n: secs })}
    </p>
  );
}

export default function FinalPhase({ game }) {
  const { t, account } = useApp();
  const { state, send, serverNow } = game;
  const isHost = state.hostId === state.you;
  const [openReport, reportDialog] = useReport();
  const final = state.final || {};
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  const [settled] = useState(() => !final.at || serverNow() - final.at > REPLAY_WINDOW_MS);
  const [party, setParty] = useState(settled);
  useEffect(() => {
    if (settled) return undefined;
    const id = setTimeout(() => setParty(true), WINNER_AT_MS);
    return () => clearTimeout(id);
  }, [settled]);

  // the server ranks (score, in the paced modes then round wins and best meme)
  const ranking =
    final.ranking ||
    [...state.players]
      .filter((p) => p.connected || p.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ pid: p.id, rank: i + 1, score: p.score }));
  const rows = ranking.map((r) => ({ ...r, player: byId[r.pid] }));
  const nameOf = (row) => row?.player?.name || t('common.unknownPlayer');
  const top = rows.slice(0, 3);
  const podiumOrder = [top[1], top[0], top[2]];
  const tie = final.ranking ? final.tie : rows.length > 1 && rows[0].score === rows[1].score;
  const winnerLine = tie
    ? t('final.tie')
    : final.decidedBy
      ? t(`final.winsBy.${final.decidedBy}`, { name: nameOf(rows[0]) })
      : t('final.winner', { name: rows[0] ? nameOf(rows[0]) : '?' });
  const awards = final.awards || [];

  const primary = state.isPublic ? (
    <Link href={`/play?game=${state.settings.game}`} className="btn btn-yellow btn-big" onClick={() => send({ t: 'leave' })}>
      <Icon name="shuffle" /> {t('public.newMatch')}
    </Link>
  ) : isHost ? (
    <button type="button" className="btn btn-yellow btn-big" onClick={() => send({ t: 'again' })}>
      <Icon name="repeat" /> {t('final.again')}
    </button>
  ) : null;

  return (
    <div className={`phase final-phase ${settled ? 'is-settled' : ''} ${primary ? 'has-bar' : ''}`}>
      {party && !settled && <Confetti count={80} />}
      <div className="final-head">
        <h1>{t('final.title')}</h1>
        <p className="winner-line" role="status">
          {winnerLine}
        </p>
        {/* phones: the note further down sits behind the bar, so public rooms say it up here */}
        {state.isPublic && state.deadline > 0 && <NextGame state={state} serverNow={serverNow} head />}
      </div>

      <div className="podium">
        {podiumOrder.map((row, i) =>
          row ? (
            <div key={row.pid} className={`podium-spot place-${[2, 1, 3][i]}`}>
              <span className="podium-avatar">
                <Avatar value={row.player?.avatar} icon={row.player ? undefined : 'ghost'} size={[64, 88, 56][i]} />
                {i === 1 && !tie && (
                  <span className="podium-crown" aria-hidden="true">
                    <Icon name="crown" size={30} strokeWidth={2.4} />
                  </span>
                )}
              </span>
              <strong className="podium-name">{nameOf(row)}</strong>
              <span className="podium-score">
                {row.score} {t('common.pts')}
              </span>
              <div className="podium-block">{[2, 1, 3][i]}</div>
            </div>
          ) : (
            <div key={`empty-${i}`} className="podium-spot is-empty" />
          ),
        )}
      </div>

      {rows.length > 3 && (
        <ol className="card rest-list">
          {rows.slice(3).map((row) => (
            <li key={row.pid}>
              <span className="rank" aria-label={t('final.rank', { n: row.rank })}>
                {row.rank}
              </span>
              <Avatar value={row.player?.avatar} icon={row.player ? undefined : 'ghost'} size={28} /> <span className="lb-name">{nameOf(row)}</span>
              <span className="lb-score">
                {row.score} {t('common.pts')}
              </span>
            </li>
          ))}
        </ol>
      )}

      {awards.length > 0 && (
        <section className="awards" aria-labelledby="awards-title">
          <h2 id="awards-title" className="section-title awards-title">
            <Icon name="medal" /> {t('final.awards')}
          </h2>
          <ul className="award-row">
            {awards.map((a, i) => (
              <AwardCard key={a.id} award={a} player={byId[a.pid]} index={i} />
            ))}
          </ul>
        </section>
      )}

      <div className="final-rest">
        {!account && (
          <p className="center-text final-cta">
            <Icon name="medal" size={18} /> {t('final.accountHint')}{' '}
            <a href="/login?mode=register" target="_blank" rel="noopener">
              {t('auth.register')}
            </a>
          </p>
        )}

        <div className="final-actions">
          {state.isPublic && state.deadline > 0 && <NextGame state={state} serverNow={serverNow} />}
          {primary ? <span className="desktop-action">{primary}</span> : <p className="muted">{t('final.waitHost')}</p>}
          {!state.activity && (
            <Link href="/" className="btn btn-white" onClick={() => send({ t: 'leave' })}>
              {t('common.leave')}
            </Link>
          )}
        </div>

        {final.best?.length > 0 && (
          <section>
            <h2 className="section-title">{t('final.best')}</h2>
            <div className="result-grid">
              {final.best.map((b) => {
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
      </div>

      {primary && <ActionBar>{primary}</ActionBar>}
      {reportDialog}
    </div>
  );
}
