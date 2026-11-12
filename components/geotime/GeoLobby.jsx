'use client';

/**
 * Lobby von GeoTime – Aufbau und Klassen sind 1:1 die von LaughTimes privatem
 * Raum (.lobby, .card.invite, .room-code, .card.settings, .game-switch,
 * .card.players, .card.start-bar). Nur der Inhalt gehört GeoTime.
 *
 * Mit dabei:
 *   • Code und Einladungslink zum Kopieren
 *   • Streamer-Modus: Code und Link werden verdeckt, Kopieren geht weiter
 *   • Einstellungen (Spielart, Teamgröße, Runden) – nur der Host
 *   • Spielerliste mit Bildchen und Host-Abzeichen
 */
import { useEffect, useState } from 'react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { MASK, copyText } from '@/lib/streamer';
import { useGeo } from './GeoProviders';

const STREAMER_KEY = 'geotime-streamer';

/** Spielarten wie auf der Startseite */
const MODES = [
  { id: 'classic', icon: 'target', color: 'var(--yellow)' },
  { id: 'bingo', icon: 'layers', color: 'var(--pink)' },
  { id: 'hunt', icon: 'radar', color: 'var(--green)' },
  { id: 'deathmatch', icon: 'swords', color: 'var(--orange)' },
  { id: 'star', icon: 'star', color: '#b18cff' },
];

const ROUND_OPTIONS = [3, 5, 8];

export default function GeoLobby({ room, you, isHost, onStart, onLeave, onSettings, onTeam }) {
  const { t } = useGeo();
  const [copied, setCopied] = useState(''); // '' | 'link' | 'code'
  const [link, setLink] = useState('');
  const [streamer, setStreamer] = useState(false);

  useEffect(() => {
    if (room?.code) setLink(`${window.location.origin}/play?code=${room.code}`);
    try {
      setStreamer(localStorage.getItem(STREAMER_KEY) === '1');
    } catch {
      /* privates Fenster */
    }
  }, [room?.code]);

  const toggleStreamer = () => {
    setStreamer((on) => {
      const next = !on;
      try {
        localStorage.setItem(STREAMER_KEY, next ? '1' : '0');
      } catch {
        /* egal */
      }
      return next;
    });
  };

  const copy = async (what) => {
    await copyText(what === 'code' ? room.code : link);
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? '' : c)), 1800);
  };

  const host = room.players.find((p) => p.id === room.hostId);
  const shownLink = streamer && link ? link.replace(/[A-Z0-9]{5}$/, MASK) : link;
  const enough = room.game === 'deathmatch' ? room.players.length >= 2 : true;
  const myTeam = room.players.find((p) => p.id === you?.id)?.team || 'a';

  return (
    <div className="lobby">
      <div className="lobby-main">
        {room.code && (
          <section className={`card invite ${streamer ? 'is-streaming' : ''}`}>
            <div className="invite-head">
              <h2>{t('lobby.inviteTitle')}</h2>
              <button
                type="button"
                className={`streamer-toggle ${streamer ? 'on' : ''}`}
                aria-pressed={streamer}
                title={t('streamer.hint')}
                onClick={toggleStreamer}
              >
                <Icon name={streamer ? 'eye-off' : 'eye'} size={18} />
                <span>{streamer ? t('streamer.on') : t('streamer.off')}</span>
              </button>
            </div>
            <p className="muted">{streamer ? t('streamer.lobbyHint') : t('lobby.inviteText')}</p>

            <div className="room-code" aria-label={streamer ? t('streamer.hidden') : t('play.code')}>
              {(streamer ? MASK : room.code).split('').map((c, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <span key={i}>{c}</span>
              ))}
            </div>

            <div className="invite-link">
              <input
                className="input"
                readOnly
                value={shownLink}
                onFocus={(e) => !streamer && e.target.select()}
                onCopy={(e) => {
                  if (!streamer) return;
                  e.preventDefault();
                  copy('link');
                }}
                aria-label={t('lobby.inviteTitle')}
              />
            </div>

            <div className="invite-actions">
              <button type="button" className="btn btn-cyan" onClick={() => copy('link')}>
                <Icon name={copied === 'link' ? 'check' : 'link'} size={18} />
                {copied === 'link' ? t('lobby.copied') : t('lobby.copy')}
              </button>
              <button type="button" className="btn btn-yellow" onClick={() => copy('code')}>
                <Icon name={copied === 'code' ? 'check' : 'hash'} size={18} />
                {copied === 'code' ? t('lobby.copied') : t('lobby.copyCode')}
              </button>
            </div>
          </section>
        )}

        <section className="card settings">
          <h2>{t('lobby.settings')}</h2>
          {!isHost && <p className="muted">{t('lobby.onlyHost')}</p>}

          <div className="setting-row">
            <span className="setting-label">{t('lobby.game')}</span>
            <div className="game-switch" role="radiogroup" aria-label={t('lobby.game')}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={room.game === m.id}
                  className={`game-switch-btn ${room.game === m.id ? 'on' : ''}`}
                  style={{ '--game': m.color }}
                  disabled={!isHost}
                  onClick={() => onSettings({ game: m.id })}
                >
                  <span className="gs-icon">
                    <Icon name={m.icon} size={22} />
                  </span>
                  <span className="gs-text">
                    <strong>{t(`home.${m.id}`)}</strong>
                    <small>{t(`home.${m.id}Sub`)}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {room.game === 'bingo' && (
            <>
              <div className="setting-row">
                <span className="setting-label">{t('lobby.teams')}</span>
                <div className="chips" role="radiogroup" aria-label={t('lobby.teams')}>
                  {['1v1', '2v2', '5v5'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={room.mode === m}
                      className={`chip ${room.mode === m ? 'on' : ''}`}
                      disabled={!isHost}
                      onClick={() => onSettings({ mode: m })}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <span className="setting-label">{t('lobby.myTeam')}</span>
                <div className="chips" role="radiogroup" aria-label={t('lobby.myTeam')}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={myTeam === 'a'}
                    className={`chip ${myTeam === 'a' ? 'team-a on' : ''}`}
                    onClick={() => onTeam('a')}
                  >
                    Team A
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={myTeam === 'b'}
                    className={`chip ${myTeam === 'b' ? 'beta on' : ''}`}
                    onClick={() => onTeam('b')}
                  >
                    Team B
                  </button>
                </div>
              </div>
            </>
          )}

          {(room.game === 'classic' || room.game === 'hunt') && (
            <div className="setting-row">
              <span className="setting-label">{t('lobby.rounds')}</span>
              <div className="chips" role="radiogroup" aria-label={t('lobby.rounds')}>
                {ROUND_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={room.rounds === n}
                    className={`chip ${room.rounds === n ? 'on' : ''}`}
                    disabled={!isHost}
                    onClick={() => onSettings({ rounds: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="lobby-side">
        <section className="card players">
          <h2>{t('lobby.players', { n: room.players.length })}</h2>
          <ul className="player-list">
            {room.players.map((p) => (
              <li key={p.id}>
                <Avatar value={p.avatar} size={48} />
                <span className="player-name">
                  {p.name}
                  {p.id === you?.id && <em> ({t('common.you')})</em>}
                </span>
                {room.game === 'bingo' && <span className={`chip small t-${p.team}`}>{p.team.toUpperCase()}</span>}
                {p.id === room.hostId && (
                  <span className="badge">
                    <Icon name="crown" size={14} /> {t('common.host')}
                  </span>
                )}
              </li>
            ))}
            {room.players.length < 2 && (
              <li className="is-empty">
                <span className="avatar avatar-empty" style={{ '--size': '48px' }}>
                  ?
                </span>
                <span className="player-name muted">…</span>
              </li>
            )}
          </ul>
        </section>

        <div className="card start-bar">
          {isHost ? (
            <>
              <button type="button" className="btn btn-yellow btn-big" disabled={!enough} onClick={onStart}>
                <Icon name="play" /> {t('play.start')}
              </button>
              {!enough && <p className="muted">{t('lobby.needPlayers', { n: 2 })}</p>}
            </>
          ) : (
            <p className="waiting">
              <span className="spinner small" aria-hidden="true" />
              {t('play.waitHost', { name: host?.name || '…' })}
            </p>
          )}
          <button type="button" className="btn btn-small btn-ghost" onClick={onLeave}>
            {t('play.leave')}
          </button>
        </div>
      </div>
    </div>
  );
}
