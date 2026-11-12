'use client';

import Icon from '../Icon';
import { MediaThumb } from '../PackCard';
import { useApp } from '../Providers';

/** consecutive tiles of the same search form one group */
function groupsOf(hand) {
  const groups = [];
  for (const tile of hand) {
    const last = groups[groups.length - 1];
    if (last && last.q === tile.q) last.tiles.push(tile);
    else groups.push({ q: tile.q, tiles: [tile] });
  }
  return groups;
}

/**
 * The tiles a player can choose from in the caption phase.
 * `variant="tray"`: GIF Hunt finds, grouped by search. `variant="duo"`: the two swap pictures.
 */
export default function HandTray({ hand, pickedId, onPick, variant = 'tray', title, disabled = false }) {
  const { t } = useApp();
  if (!hand?.length) return null;

  const tile = (item, n) => {
    const on = item.id === pickedId;
    return (
      <button
        key={item.id}
        type="button"
        className={`hand-tile ${on ? 'on' : ''}`}
        aria-pressed={on}
        aria-label={t(variant === 'duo' ? 'swap.option' : 'hunt.pickTile', { n })}
        disabled={disabled}
        onClick={() => !on && onPick(item.id)}
      >
        <MediaThumb media={item.media} />
        <span className="hand-check" aria-hidden="true">
          <Icon name="check" size={13} strokeWidth={3.6} />
        </span>
      </button>
    );
  };

  if (variant === 'duo') {
    return (
      <div className="hand hand-duo" role="group" aria-label={title}>
        {title && <p className="hand-title">{title}</p>}
        <div className="hand-duo-row">{hand.map((item, i) => tile(item, i + 1))}</div>
      </div>
    );
  }

  let n = 0;
  return (
    <div className="hand hand-tray" role="group" aria-label={title}>
      {title && <p className="hand-title">{title}</p>}
      <div className="hand-scroll">
        {groupsOf(hand).map((g, gi) => (
          <div key={`${gi}-${g.tiles[0].id}`} className="hand-group">
            <span className="hand-label" title={g.q || t('hunt.luckyTile')}>
              {g.q ? (
                <>
                  <Icon name="search" size={11} strokeWidth={3} /> <span>{g.q}</span>
                </>
              ) : (
                <>
                  <Icon name="dice" size={12} strokeWidth={2.8} /> <span>{t('hunt.luckyTile')}</span>
                </>
              )}
            </span>
            <div className="hand-tiles">{g.tiles.map((item) => tile(item, ++n))}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
