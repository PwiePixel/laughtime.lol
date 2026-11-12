'use client';

import { useEffect, useState } from 'react';

const COLORS = ['#FFD23F', '#FF4FA3', '#35E0FF', '#7CFF6B', '#FFFFFF', '#B18CFF'];
// more pieces do not look better, they only cost frames
const MAX_PIECES = 90;

function budget(count) {
  const small = window.matchMedia('(max-width: 720px)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  return Math.round(Math.max(0, Math.min(count, MAX_PIECES)) * (small || weak ? 0.6 : 1));
}

function makePieces(n) {
  return Array.from({ length: n }, (_, i) => {
    const size = 7 + Math.random() * 8;
    const round = i % 7 === 0;
    return {
      id: i,
      style: {
        '--x': `${(Math.random() * 100).toFixed(1)}%`,
        '--w': `${size.toFixed(1)}px`,
        '--h': `${(round ? size : size * 0.45).toFixed(1)}px`,
        '--c': COLORS[i % COLORS.length],
        '--drift': `${Math.round(-70 + Math.random() * 140)}px`,
        '--tilt': `${Math.round(Math.random() * 360)}deg`,
        '--spin': `${Math.round((Math.random() < 0.5 ? -1 : 1) * (540 + Math.random() * 540))}deg`,
        '--delay': `${(Math.random() * 1.1).toFixed(2)}s`,
        '--dur': `${(2.4 + Math.random() * 1.8).toFixed(2)}s`,
        borderRadius: round ? '50%' : undefined,
      },
    };
  });
}

/**
 * One burst of confetti over the whole screen. Only transform and opacity are
 * animated (see .confetti in app/globals.css) and the pieces are removed from
 * the page as soon as the last one has landed.
 */
export default function Confetti({ count = 60 }) {
  const [pieces, setPieces] = useState(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const list = makePieces(budget(count));
    setPieces(list);
    const longest = list.reduce((max, p) => Math.max(max, parseFloat(p.style['--delay']) + parseFloat(p.style['--dur'])), 0);
    const id = setTimeout(() => setPieces(null), longest * 1000 + 150);
    return () => clearTimeout(id);
  }, [count]);

  if (!pieces?.length) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span key={p.id} style={p.style} />
      ))}
    </div>
  );
}
