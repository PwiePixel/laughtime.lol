'use client';

import { useEffect, useState } from 'react';
import Icon from '../Icon';
import { useApp } from '../Providers';

/** seconds until the phase ends on the server's clock (null without a deadline) */
function useCountdown(deadline, offset) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    if (!deadline) {
      setLeft(null);
      return undefined;
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline, offset]);
  return left;
}

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Picture-in-picture: Discord shows the activity as a small tile while the
 * player looks at something else. A squeezed game is unreadable there, so the
 * tile only says what is going on – phase, time left, and when it is the
 * player's turn.
 *   info   { phase, round, rounds, deadline, offset, players, needsYou } or null
 *   status 'boot' | 'error' | 'room'
 */
export default function ActivityPip({ info, status = 'room', people = 0 }) {
  const { t } = useApp();
  const left = useCountdown(status === 'room' ? info?.deadline : 0, info?.offset || 0);
  const phase = info?.phase;
  const inRound = phase && phase !== 'lobby' && phase !== 'final';
  const title = status === 'error' ? t('activity.pip.error') : status !== 'room' || !phase ? t('activity.pip.loading') : t(`activity.pip.${phase}`);
  const players = info?.players || people;
  const turn = status === 'room' && Boolean(info?.needsYou);
  const urgent = left !== null && left <= 10 && turn;

  return (
    <div className={`activity-pip ${turn ? 'is-turn' : ''} ${urgent ? 'is-urgent' : ''}`} role="status" aria-live="polite">
      <img src="/logo-mark.svg" alt="" width="62" height="30" className="activity-pip-logo" />
      <div className="activity-pip-body">
        {inRound && status === 'room' && <span className="activity-pip-round">{t('activity.pip.round', { n: info.round, total: info.rounds })}</span>}
        <strong className="activity-pip-phase">{title}</strong>
        {left !== null && (phase === 'upload' || phase === 'caption' || phase === 'vote' || phase === 'starting') && (
          <span className="activity-pip-timer" aria-label={t('activity.pip.timer', { n: left })}>
            <Icon name="clock" size={18} /> {clock(left)}
          </span>
        )}
      </div>
      <div className="activity-pip-foot">
        {players > 0 && (
          <span className="activity-pip-players">
            <Icon name="users" size={14} /> {players}
          </span>
        )}
        <span className="activity-pip-cta">{turn ? t('activity.pip.turn') : t('activity.pip.open')}</span>
      </div>
    </div>
  );
}
