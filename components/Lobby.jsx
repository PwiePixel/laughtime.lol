'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GAME_MODES, SETTING_OPTIONS, gameAllowed, sanitizeName } from '@/lib/shared';
import { MASK, copyText } from '@/lib/streamer';
import { usePublicInfo } from '@/lib/usePublicInfo';
import ActionBar from './game/ActionBar';
import Avatar from './Avatar';
import { useActivity } from './ActivityContext';
import AvatarPicker from './AvatarPicker';
import Icon from './Icon';
import MatchStage from './MatchStage';
import PackPicker from './PackPicker';
import { ReportButton, reportInGame } from './ReportDialog';
import StreamerToggle from './StreamerToggle';
import useReport from './useReport';
import { useApp } from './Providers';
import { useCountdown } from './Timer';

function SettingRow({ label, name, value, options, format, disabled, onChange }) {
  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      <div className="chips" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === value}
            className={`chip ${o === value ? 'on' : ''}`}
            disabled={disabled}
            onClick={() => onChange(name, o)}
          >
            {format ? format(o) : o}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfileEditor({ onClose }) {
  const { t, profile, updateProfile } = useApp();
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const clean = sanitizeName(name);
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form
        className="card modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!clean) return;
          updateProfile({ name: clean, avatar });
          onClose();
        }}
      >
        <h2>{t('lobby.editProfile')}</h2>
        <label className="label" htmlFor="edit-name">
          {t('home.nameLabel')}
        </label>
        <input id="edit-name" className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        <span className="label">{t('home.avatarLabel')}</span>
        <AvatarPicker value={avatar} onChange={setAvatar} />
        <div className="row-end">
          <button type="button" className="btn btn-white" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-yellow" disabled={!clean}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

/** public (matchmaking) room: no host, starts by itself */
function PublicLobby({ game }) {
  const { t } = useApp();
  const { state, send, serverNow } = game;
  const left = useCountdown(state.deadline, serverNow);
  const connected = state.players.filter((p) => p.connected);
  const max = state.settings.maxPlayers;
  const starting = state.phase === 'starting';
  const secs = state.deadline ? Math.ceil(left / 1000) : 0;
  const counting = secs > 0 || starting;
  return (
    <div className="page matchmaking-page">
      <MatchStage
        title={starting ? t('lobby.starting') : counting ? t('match.found') : t('public.waiting')}
        game={state.settings.game}
        players={connected}
        slots={Math.min(max, Math.max(2, connected.length))}
        progress={counting ? 1 : connected.length / 2}
        countText={t('match.countMax', { n: connected.length, max })}
        startsIn={secs > 0 && !starting ? t('public.startsIn', { n: secs }) : null}
        note={connected.length < 2 ? t('public.needMore') : null}
        found={counting}
      >
        <div className="mm-actions">
          <Link href="/" className="btn btn-white" onClick={() => send({ t: 'leave' })}>
            <Icon name="door" /> {t('common.leave')}
          </Link>
        </div>
      </MatchStage>
    </div>
  );
}

/** Discord Activity: everybody in the call joins by starting LaughTime */
function DiscordInvite() {
  const { t } = useApp();
  const activity = useActivity();
  const [status, setStatus] = useState(''); // '' | 'sent' | 'failed'
  return (
    <section className="card invite invite-discord">
      <div className="invite-head">
        <h2>
          <Icon name="discord" size={24} /> {t('activity.inviteTitle')}
        </h2>
      </div>
      <p className="muted">{t('activity.inviteText')}</p>
      <div className="invite-actions">
        <button
          type="button"
          className="btn btn-discord"
          onClick={async () => {
            const ok = await activity.invite();
            setStatus(ok ? 'sent' : 'failed');
            setTimeout(() => setStatus(''), 4000);
          }}
        >
          <Icon name="user-plus" size={18} /> {t('activity.invite')}
        </button>
      </div>
      {status && (
        <p className={`small ${status === 'failed' ? 'form-error' : 'muted'}`} role="status">
          {t(status === 'failed' ? 'activity.inviteFailed' : 'activity.inviteOpened')}
        </p>
      )}
    </section>
  );
}

export default function Lobby({ game }) {
  if (game.state.isPublic) return <PublicLobby game={game} />;
  return <PrivateLobby game={game} />;
}

function PrivateLobby({ game }) {
  const { t, profile, streamerMode } = useApp();
  const activity = useActivity();
  const { state, send } = game;
  const info = usePublicInfo(0);
  const [copied, setCopied] = useState(''); // '' | 'link' | 'code'
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [openReport, reportDialog] = useReport();
  const [link, setLink] = useState('');
  const [canShare, setCanShare] = useState(false);
  const isHost = state.hostId === state.you;
  const connected = state.players.filter((p) => p.connected);
  const host = state.players.find((p) => p.id === state.hostId);
  const enough = connected.length >= state.minPlayers;
  const starting = state.phase === 'starting';
  // a tapped setting shows at once; the server state confirms (or corrects) it
  const [pending, setPending] = useState(null);
  const settingsKey = JSON.stringify(state.settings);
  useEffect(() => setPending(null), [settingsKey]);
  const settings = pending && isHost ? { ...state.settings, ...pending } : state.settings;
  const gameId = state.settings.game;
  const hunt = gameId === 'hunt';
  const pack = state.settings.pack;
  // GIF Hunt: 0 = the server default
  const searches = state.settings.searches || info.huntSearches;
  const locked = !isHost || starting;

  useEffect(() => {
    setLink(`${window.location.origin}/room/${state.code}`);
    setCanShare(typeof navigator.share === 'function' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
  }, [state.code]);

  const change = (name, value) => {
    if (!send({ t: 'settings', settings: { ...state.settings, [name]: value } })) return;
    // a new game mode brings its own defaults - wait for the server there
    if (name !== 'game') setPending((p) => ({ ...p, [name]: value }));
  };

  async function copy(what) {
    await copyText(what === 'code' ? state.code : link);
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? '' : c)), 1800);
  }

  const shownLink = streamerMode && link ? link.replace(/[A-Z0-9]{5}$/, MASK) : link;

  async function share() {
    try {
      await navigator.share({ title: 'laughtime.lol', text: `Room ${state.code}`, url: link });
    } catch {
      /* user cancelled */
    }
  }

  const secs = (n) => t('lobby.seconds', { n });

  return (
    <div className={`lobby ${isHost ? 'has-bar' : ''}`}>
      <div className="lobby-main">
      {activity ? (
        <DiscordInvite />
      ) : (
      <section className={`card invite ${streamerMode ? 'is-streaming' : ''}`}>
        <div className="invite-head">
          <h2>{t('lobby.inviteTitle')}</h2>
          <StreamerToggle />
        </div>
        <p className="muted">{streamerMode ? t('streamer.lobbyHint') : t('lobby.inviteText')}</p>
        <div className="room-code" aria-label={streamerMode ? t('streamer.hidden') : 'Room code'}>
          {(streamerMode ? MASK : state.code).split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
        <div className="invite-link">
          <input
            className="input"
            readOnly
            value={shownLink}
            onFocus={(e) => !streamerMode && e.target.select()}
            onCopy={(e) => {
              if (!streamerMode) return;
              e.preventDefault();
              copy('link');
            }}
            aria-label="Invite link"
          />
        </div>
        <div className="invite-actions">
          <button type="button" className="btn btn-cyan" onClick={() => copy('link')}>
            <Icon name={copied === 'link' ? 'check' : 'link'} size={18} /> {copied === 'link' ? t('lobby.copied') : t('lobby.copy')}
          </button>
          <button type="button" className="btn btn-yellow" onClick={() => copy('code')}>
            <Icon name={copied === 'code' ? 'check' : 'hash'} size={18} /> {copied === 'code' ? t('lobby.copied') : t('lobby.copyCode')}
          </button>
          {canShare && (
            <button type="button" className="btn btn-white" onClick={share}>
              <Icon name="share" size={18} /> {t('lobby.share')}
            </button>
          )}
        </div>
      </section>
      )}

      <section className="card settings">
        <h2>{t('lobby.settings')}</h2>
        {!isHost && <p className="muted">{t('lobby.onlyHost')}</p>}
        <div className="setting-row">
          <span className="setting-label">{t('lobby.game')}</span>
          <div className="game-switch" role="radiogroup" aria-label={t('lobby.game')}>
            {/* beta modes only in beta rooms; the game a room plays is always shown */}
            {GAME_MODES.filter((g) => g.id === state.settings.game || gameAllowed(g.id, { channel: state.channel })).map((g) => (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={state.settings.game === g.id}
                className={`game-switch-btn ${state.settings.game === g.id ? 'on' : ''}`}
                style={{ '--game': g.color }}
                disabled={locked}
                onClick={() => change('game', g.id)}
              >
                <span className="gs-icon">
                  <Icon name={g.icon} size={22} />
                </span>
                <span className="gs-text">
                  <strong>
                    {t(`games.${g.id}`)}
                    {g.beta && <span className="beta-chip">{t('games.beta')}</span>}
                  </strong>
                  <small>{t(`games.${g.id}.text`, { n: searches })}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
        {gameId === 'swap' && connected.length < 3 && (
          <p className="small mode-note">
            <Icon name="users" size={16} /> {t('lobby.swapPlayers')}
          </p>
        )}
        {gameId === 'same' && (
          <p className="small mode-note">
            <Icon name="copy" size={16} /> {t('lobby.sameHint')}
          </p>
        )}
        {gameId === 'hunt' || gameId === 'swap' ? (
          <p className="muted small pack-hint">
            <Icon name="package" size={16} /> {t(hunt ? 'lobby.pack.huntHint' : 'lobby.pack.swapHint')}
          </p>
        ) : (
          <div className="setting-row">
            <span className="setting-label">{t('lobby.pack')}</span>
            <div className="pack-current">
              <span className="pack-current-icon">
                <Icon name={pack ? 'package' : 'sparkles'} size={22} />
              </span>
              <span className="pack-current-text">
                <strong>{pack ? pack.name : t('lobby.pack.official')}</strong>
                <small>
                  {pack
                    ? `${t('lobby.pack.items', { n: pack.count })}${pack.owner ? ` · ${t('lobby.pack.by', { name: pack.owner })}` : ''}`
                    : t('lobby.pack.none')}
                </small>
              </span>
              {isHost && (
                <button type="button" className="btn btn-small btn-cyan" disabled={starting} onClick={() => setPicking(true)}>
                  {t('lobby.pack.choose')}
                </button>
              )}
            </div>
          </div>
        )}
        <SettingRow
          label={t('lobby.mode')}
          name="mode"
          value={settings.mode}
          options={SETTING_OPTIONS.mode}
          format={(o) => t(`lobby.mode.${o}`)}
          disabled={locked}
          onChange={change}
        />
        <SettingRow label={t('lobby.rounds')} name="rounds" value={settings.rounds} options={SETTING_OPTIONS.rounds} disabled={locked} onChange={change} />
        <SettingRow
          label={t('lobby.captionTime')}
          name="captionTime"
          value={settings.captionTime}
          options={SETTING_OPTIONS.captionTime}
          format={secs}
          disabled={locked}
          onChange={change}
        />
        <SettingRow
          label={t('lobby.voteTime')}
          name="voteTime"
          value={settings.voteTime}
          options={SETTING_OPTIONS.voteTime}
          format={secs}
          disabled={locked}
          onChange={change}
        />
        {hunt && (
          <SettingRow
            label={t('lobby.searches')}
            name="searches"
            value={settings.searches}
            options={SETTING_OPTIONS.searches}
            format={(o) => (o === 0 ? t('lobby.searches.auto', { n: info.huntSearches }) : o)}
            disabled={locked}
            onChange={change}
          />
        )}
        {gameId === 'swap' && (
          <SettingRow
            label={t('lobby.uploadTime')}
            name="uploadTime"
            value={settings.uploadTime}
            options={SETTING_OPTIONS.uploadTime}
            format={secs}
            disabled={locked}
            onChange={change}
          />
        )}
        {gameId === 'classic' && (
          <SettingRow
            label={t('lobby.rerolls')}
            name="rerolls"
            value={settings.rerolls}
            options={SETTING_OPTIONS.rerolls}
            disabled={locked}
            onChange={change}
          />
        )}
        <SettingRow
          label={t('lobby.maxPlayers')}
          name="maxPlayers"
          value={settings.maxPlayers}
          options={SETTING_OPTIONS.maxPlayers}
          disabled={locked}
          onChange={change}
        />
      </section>

      </div>
      <div className="lobby-side">
      <section className="card players">
        <h2>{t('lobby.players', { n: connected.length, max: state.settings.maxPlayers })}</h2>
        <ul className="player-list">
          {state.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'is-offline'}>
              <Avatar value={p.avatar} size={48} />
              <span className="player-name">
                {p.username ? (
                  <a href={`/u/${p.username}`} target="_blank" rel="noopener" className="player-link" title={`@${p.username}`}>
                    {p.name}
                  </a>
                ) : (
                  p.name
                )}
                {p.username && <Icon name="check-circle" size={15} className="verified" label={t('common.account')} />}
                {p.id === state.you && <em> ({t('common.you')})</em>}
              </span>
              {p.id === state.hostId && (
                <span className="badge">
                  <Icon name="crown" size={14} /> {t('common.host')}
                </span>
              )}
              {!p.connected && <span className="badge badge-muted">{t('common.offline')}</span>}
              {p.id === state.you && !profile?.account && (
                <button type="button" className="btn btn-small btn-white" onClick={() => setEditing(true)}>
                  <Icon name="pencil" size={16} />
                  <span className="sr-only">{t('lobby.editProfile')}</span>
                </button>
              )}
              {p.id !== state.you && (
                <ReportButton
                  label={t('report.player', { name: p.name })}
                  onClick={() =>
                    openReport({ kind: 'player', name: p.name, avatar: p.avatar }, (reason, comment) => reportInGame(game, { pid: p.id, reason, comment }))
                  }
                />
              )}
              {isHost && p.id !== state.you && (
                <button
                  type="button"
                  className="btn btn-small btn-white"
                  onClick={() => send({ t: 'kick', pid: p.id })}
                  title={t('common.kick')}
                >
                  <Icon name="x" size={16} />
                  <span className="sr-only">{t('common.kick')}</span>
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: Math.max(0, state.minPlayers - connected.length) }, (_, i) => (
            <li key={`empty-${i}`} className="is-empty">
              <span className="avatar avatar-empty" style={{ '--size': '48px' }}>
                ?
              </span>
              <span className="player-name muted">…</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="card start-bar">
        {isHost ? (
          <>
            <button type="button" className="btn btn-yellow btn-big desktop-action" disabled={!enough || starting} onClick={() => send({ t: 'start' })}>
              {starting ? (
                t('lobby.starting')
              ) : (
                <>
                  <Icon name="play" /> {t('lobby.start')}
                </>
              )}
            </button>
            {!enough && <p className="muted">{t('lobby.needPlayers', { n: state.minPlayers })}</p>}
          </>
        ) : (
          <p className="waiting">
            <span className="spinner small" aria-hidden="true" />
            {starting ? t('lobby.starting') : t('lobby.waitHost', { name: host?.name || '…' })}
          </p>
        )}
      </div>
      </div>
      {isHost && (
        <ActionBar info={t('lobby.playersShort', { n: connected.length })}>
          <button type="button" className="btn btn-yellow btn-block" disabled={!enough || starting} onClick={() => send({ t: 'start' })}>
            {starting ? (
              t('lobby.starting')
            ) : enough ? (
              <>
                <Icon name="play" size={18} /> {t('lobby.start')}
              </>
            ) : (
              t('lobby.needPlayers', { n: state.minPlayers })
            )}
          </button>
        </ActionBar>
      )}
      {editing && <ProfileEditor onClose={() => setEditing(false)} />}
      {reportDialog}
      {picking && <PackPicker current={pack} onPick={(id) => send({ t: 'pack', id })} onClose={() => setPicking(false)} />}
    </div>
  );
}
