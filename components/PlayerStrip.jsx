'use client';

import { GAME_MODES } from '@/lib/shared';
import { MASK } from '@/lib/streamer';
import Avatar from './Avatar';
import Icon from './Icon';
import { useApp } from './Providers';
import { reportInGame } from './ReportDialog';
import StreamerToggle from './StreamerToggle';
import useReport from './useReport';

/** what a player is doing right now (bring / caption phases only - votes stay count-only) */
function StepBadge({ player, phase }) {
  const { t } = useApp();
  if (player.away) {
    return (
      <span className="check is-away">
        <Icon name="moon" size={11} strokeWidth={3} label={t('pace.away')} />
      </span>
    );
  }
  if (phase !== 'caption' && phase !== 'upload') return null;
  if (player.step === 'done') {
    return (
      <span className="check">
        <Icon name="check" size={11} strokeWidth={3.5} label={t('caption.allDone')} />
      </span>
    );
  }
  if (player.step === 'search') {
    return (
      <span className="check is-search">
        <Icon name="search" size={10} strokeWidth={3.5} label={t('caption.searching')} />
      </span>
    );
  }
  return null;
}

export default function PlayerStrip({ state, game }) {
  const { t, streamerMode } = useApp();
  const [openReport, reportDialog] = useReport();
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const mode = GAME_MODES.find((g) => g.id === state.settings.game);
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
        {mode && mode.id !== 'classic' && (
          <span className="public-chip hunt-chip" style={{ '--game': mode.color }}>
            <Icon name={mode.icon} size={13} /> {t(`games.${mode.id}`)}
          </span>
        )}
        {state.round > 0 && <span>{t('common.round', { n: state.round, total: state.settings.rounds })}</span>}
      </div>
      <ul className="strip-list">
        {sorted.map((p) => {
          const me = p.id === state.you;
          const canReport = !me && Boolean(game);
          const Tag = canReport ? 'button' : 'span';
          return (
            <li key={p.id} className={`${p.connected ? '' : 'is-offline'} ${p.away ? 'is-away' : ''} ${me ? 'is-me' : 'can-report'}`}>
              <Tag
                className="strip-player"
                type={canReport ? 'button' : undefined}
                title={p.away ? t('pace.away') : canReport ? t('report.clickToReport') : undefined}
                onClick={
                  canReport
                    ? () => openReport({ kind: 'player', name: p.name, avatar: p.avatar }, (reason, comment) => reportInGame(game, { pid: p.id, reason, comment }))
                    : undefined
                }
              >
                <span className="strip-avatar">
                  <Avatar value={p.avatar} size={34} />
                  <StepBadge player={p} phase={state.phase} />
                </span>
                <span className="strip-name">{p.name}</span>
                <span className="strip-score">{p.score}</span>
                {p.streak >= 2 && (
                  <span className="strip-streak" title={t('scores.streak', { n: p.streak })}>
                    <Icon name="flame" size={13} strokeWidth={2.8} />
                    {p.streak}
                  </span>
                )}
              </Tag>
            </li>
          );
        })}
      </ul>
      {reportDialog}
    </div>
  );
}
