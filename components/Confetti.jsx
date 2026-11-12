'use client';

import { useEffect, useState } from 'react';

const COLORS = ['#FFD23F', '#FF4FA3', '#35E0FF', '#7CFF6B', '#FFFFFF', '#B18CFF'];

export default function Confetti({ count = 60 }) {
  const [pieces, setPieces] = useState([]);
  useEffect(() => {
    setPieces(
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 1.2,
        dur: 2.4 + Math.random() * 2,
        color: COLORS[i % COLORS.length],
        rot: Math.random() * 360,
        size: 7 + Math.random() * 8,
      })),
    );
  }, [count]);
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            left: `${p.left}%`,
            background: p.color,
            width: p.size,
            height: p.size * 0.45,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}
