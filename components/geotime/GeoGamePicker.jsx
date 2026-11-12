'use client';

/**
 * Auswahlfenster für die Spielart – Aufbau und Klassen sind 1:1 die von
 * LaughTime (.modal-backdrop, .card.modal.game-picker, .game-options,
 * .game-option). Erst wählt man „schnell" oder „privat", dann hier das Spiel,
 * danach geht es direkt in die Runde bzw. in die Lobby.
 */
import { useEffect } from 'react';
import Icon from '@/components/Icon';
import { useGeo } from './GeoProviders';

/** dieselben Farben und Zeichen wie die Kacheln auf der Startseite */
export const GEO_MODES = [
  { id: 'classic', icon: 'target', color: 'var(--yellow)' },
  { id: 'bingo', icon: 'layers', color: 'var(--pink)', needsFriends: true },
  { id: 'hunt', icon: 'radar', color: 'var(--green)' },
  { id: 'deathmatch', icon: 'swords', color: 'var(--orange)', needsFriends: true },
  { id: 'star', icon: 'star', color: '#b18cff' },
];

export default function GeoGamePicker({ purpose = 'quick', busy = null, onPick, onClose }) {
  const { t } = useGeo();

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  // Allein geht alles außer den Spielarten, die andere brauchen
  const modes = GEO_MODES.filter((m) => purpose !== 'quick' || !m.needsFriends);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="card modal game-picker pop-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="geo-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          <h2 id="geo-picker-title">
            <Icon name={purpose === 'quick' ? 'globe' : 'lock'} />{' '}
            {t(purpose === 'quick' ? 'games.quickTitle' : 'games.privateTitle')}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('games.close')}>
            <Icon name="x" />
          </button>
        </div>

        <div className="game-options">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`game-option game-${m.id}`}
              style={{ '--game': m.color }}
              disabled={Boolean(busy)}
              onClick={() => onPick(m.id)}
            >
              <span className="game-art" aria-hidden="true">
                <Icon name={m.icon} size={44} strokeWidth={2.4} />
              </span>
              <span className="game-body">
                <strong>{t(`home.${m.id}`)}</strong>
                <span>{t(`home.${m.id}Sub`)}</span>
              </span>
              <span className="game-go">
                {busy === m.id ? (
                  <span className="spinner small" aria-hidden="true" />
                ) : (
                  <Icon name="arrow-right" size={26} />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
