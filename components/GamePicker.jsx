'use client';

import { useEffect } from 'react';
import { GAME_MODES } from '@/lib/shared';
import { usePublicInfo } from '@/lib/usePublicInfo';
import Icon from './Icon';
import { useApp } from './Providers';

/** Small game selection window: Classic or GIF Hunt. */
export default function GamePicker({ purpose = 'quick', busy = null, onPick, onClose }) {
  const { t } = useApp();
  const info = usePublicInfo();

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="card modal game-picker pop-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          <h2 id="game-picker-title">
            <Icon name={purpose === 'quick' ? 'globe' : 'lock'} /> {t(purpose === 'quick' ? 'games.quickTitle' : 'games.privateTitle')}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('games.close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="game-options">
          {GAME_MODES.filter((g) => purpose !== 'quick' || !g.privateOnly).map((g) => (
            <button
              key={g.id}
              type="button"
              className={`game-option game-${g.id}`}
              style={{ '--game': g.color }}
              disabled={Boolean(busy)}
              onClick={() => onPick(g.id)}
            >
              <span className="game-art" aria-hidden="true">
                <Icon name={g.icon} size={44} strokeWidth={2.4} />
                {g.id === 'hunt' && <span className="game-art-gif">GIF</span>}
                {g.id === 'swap' && <span className="game-art-gif">UPLOAD</span>}
              </span>
              <span className="game-body">
                <strong>{t(`games.${g.id}`)}</strong>
                <span>{t(`games.${g.id}.text`, { n: info.huntSearches })}</span>
                {purpose === 'quick' && info[g.id]?.players > 0 && (
                  <span className="game-online">
                    <span className="live-dot" /> {t('games.players', { n: info[g.id]?.players ?? 0 })}
                  </span>
                )}
              </span>
              <span className="game-go">
                {busy === g.id ? <span className="spinner small" aria-hidden="true" /> : <Icon name="arrow-right" size={26} />}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
