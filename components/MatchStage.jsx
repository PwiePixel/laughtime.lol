'use client';

import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import LolLogo from './LolLogo';
import { useApp } from './Providers';

const TIPS = ['match.tip1', 'match.tip2', 'match.tip3', 'match.tip4'];

/** Full-screen "loading" stage with the animated LoL logo (matchmaking + public lobby). */
export default function MatchStage({ title, game, players = [], slots = 0, progress = 0, countText, startsIn, note, found, children }) {
  const { t } = useApp();
  const [tip, setTip] = useState(0);
  useEffect(() => {
    setTip(Math.floor(Math.random() * TIPS.length));
    const id = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 6000);
    return () => clearInterval(id);
  }, []);
  const empty = Math.max(0, slots - players.length);

  return (
    <div className={`match-stage ${found ? 'is-found' : ''}`}>
      <div className="mm-visual" aria-hidden="true">
        <span className="mm-ring r1" />
        <span className="mm-ring r2" />
        <span className="mm-ring r3" />
        <LolLogo className="mm-logo" />
      </div>
      <h1 className="mm-title" aria-live="polite">
        {title}
        {!found && (
          <span className="mm-dots">
            <i />
            <i />
            <i />
          </span>
        )}
      </h1>
      {game && (
        <span className={`mm-game game-${game}`}>
          <Icon name={game === 'hunt' ? 'search' : 'image'} size={16} /> {t(`games.${game}`)}
        </span>
      )}

      <div className="mm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span style={{ width: `${Math.min(100, Math.max(4, progress * 100))}%` }} />
      </div>
      {countText && <p className="mm-count">{countText}</p>}

      <ul className="mm-players">
        {players.map((p, i) => (
          <li key={p.id || `${p.name}-${i}`} className="mm-player">
            <Avatar value={p.avatar} size={54} />
            <span>{p.name}</span>
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`empty-${i}`} className="mm-player is-empty">
            <span className="avatar avatar-empty" style={{ '--size': '54px' }}>
              ?
            </span>
            <span>&nbsp;</span>
          </li>
        ))}
      </ul>

      {startsIn && (
        <p className="mm-starts">
          <Icon name="hourglass" size={18} /> {startsIn}
        </p>
      )}
      {note && <p className="mm-note">{note}</p>}
      <p className="mm-tip" key={tip}>
        {t(TIPS[tip])}
      </p>
      {children}
    </div>
  );
}
