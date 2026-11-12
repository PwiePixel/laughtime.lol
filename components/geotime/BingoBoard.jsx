'use client';

/**
 * Bingo-Feld über der Straßenansicht.
 *
 * Sieht aus wie die Karten von LaughTime: heller Kasten, dicker Rahmen,
 * Schlagschatten. Am PC steht es als Spalte rechts, auf dem Handy als Leiste
 * unten, die sich ein- und ausklappen lässt.
 */
import { useState } from 'react';
import Icon from '@/components/Icon';
import { hyphenate } from '@/lib/geotime/hyphen';

const MARK = { accepted: 'check', tribunal: 'hourglass', rejected: 'x', free: 'star' };

/** Felder je Team zählen – für den Stand im Kopf des Kastens */
function tally(board) {
  const out = { a: 0, b: 0, open: 0 };
  for (const c of board.cells) {
    if (c.status === 'accepted' && out[c.team] !== undefined) out[c.team] += 1;
    else if (c.status === 'open') out.open += 1;
  }
  return out;
}

export default function BingoBoard({ board, myTeam, onClaim, busyCell, disabled, onDone, t }) {
  const [open, setOpen] = useState(true);
  if (!board) return null;
  const score = tally(board);

  return (
    <section className={`geo-board ${open ? 'open' : ''}`}>
      <div className="geo-board-head">
        <button type="button" className="geo-board-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name="chevron-down" size={18} />
          <strong>Bingo</strong>
        </button>
        <span className={`geo-team-score t-a ${myTeam === 'a' ? 'mine' : ''}`}>
          A <b>{score.a}</b>
        </span>
        <span className={`geo-team-score t-b ${myTeam === 'b' ? 'mine' : ''}`}>
          B <b>{score.b}</b>
        </span>
        <button type="button" className="btn btn-small btn-yellow" onClick={onDone}>
          {t ? t('play.done') : 'Fertig'}
        </button>
      </div>

      <div className="geo-bingo" style={{ '--n': board.size }} role="grid" aria-label="Bingo">
        {board.cells.map((cell) => {
          const mine = cell.team === myTeam;
          const done = cell.status === 'accepted' || cell.status === 'free';
          return (
            <button
              key={cell.i}
              type="button"
              role="gridcell"
              className={`geo-cell s-${cell.status} ${cell.team ? `t-${cell.team}` : ''} ${mine ? 'mine' : ''}`}
              disabled={disabled || done || busyCell === cell.i}
              onClick={() => onClaim?.(cell)}
              title={cell.term}
            >
              <span className="geo-cell-term">{hyphenate(cell.term)}</span>
              {busyCell === cell.i ? (
                <span className="geo-cell-mark">…</span>
              ) : (
                MARK[cell.status] && (
                  <span className="geo-cell-mark">
                    <Icon name={MARK[cell.status]} size={14} />
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
