'use client';

import { MASK } from '@/lib/streamer';
import Avatar from './Avatar';
import Icon from './Icon';
import { useApp } from './Providers';
import { reportInGame } from './ReportDialog';
import StreamerToggle from './StreamerToggle';
import useReport from './useReport';

export default function PlayerStrip({ state, game }) {
  const { t, streamerMode } = useApp();
  const [openReport, reportDialog] = useReport();
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  return (
    <div className="player-strip">
      <div className="strip-meta">
        {state.activity ? (
          <span className="room-code-small discord-chip">
            <Icon name="discord" size={14} /> Discord
          </span>
        ) : (
          <span className="room-code-small">
            #{streamerMode ? MASK : state.code} <StreamerToggle compact />
          </span>
        )}
        {state.isPublic && (
          <span className="public-chip">
            <Icon name="globe" size={13} /> {t('public.badge')}
          </span>
        )}
        {state.settings.game === 'hunt' && (
          <span className="public-chip hunt-chip">
            <Icon name="search" size={13} /> {t('games.hunt')}
          </span>
        )}
        {state.round > 0 && <span>{t('common.round', { n: state.round, total: state.settings.rounds })}</span>}
      </div>
      <ul className="strip-list">
        {sorted.map((p) => {
          const done = state.phase === 'caption' ? p.submitted : state.phase === 'vote' ? p.voted : false;
          return (
            <li
              key={p.id}
              className={`${p.connected ? '' : 'is-offline'} ${p.id === state.you ? 'is-me' : 'can-report'}`}
              title={p.id === state.you ? undefined : t('report.clickToReport')}
              onClick={
                p.id === state.you || !game
                  ? undefined
                  : () => openReport({ kind: 'player', name: p.name, avatar: p.avatar }, (reason, comment) => reportInGame(game, { pid: p.id, reason, comment }))
              }
            >
              <span className="strip-avatar">
                <Avatar value={p.avatar} size={34} />
                {done && (
                  <span className="check">
                    <Icon name="check" size={11} strokeWidth={3.5} label="done" />
                  </span>
                )}
              </span>
              <span className="strip-name">{p.name}</span>
              <span className="strip-score">{p.score}</span>
            </li>
          );
        })}
      </ul>
      {reportDialog}
    </div>
  );
}
