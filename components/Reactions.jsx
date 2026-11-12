'use client';

import { useEffect, useRef, useState } from 'react';
import { REACTIONS, REACTION_COLORS } from '@/lib/shared';
import Icon from './Icon';

export function ReactionBar({ send }) {
  return (
    <div className="reaction-bar" role="group" aria-label="Reactions">
      {REACTIONS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => send({ t: 'react', emoji: r })}
          aria-label={r}
          style={{ '--rc': REACTION_COLORS[r] }}
        >
          <Icon name={r} size={22} />
        </button>
      ))}
    </div>
  );
}

export function FloatingReactions({ onReact }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  useEffect(
    () =>
      onReact((msg) => {
        const id = ++idRef.current;
        const item = { id, name: msg.emoji, left: 8 + Math.random() * 84, drift: (Math.random() - 0.5) * 60 };
        setItems((list) => [...list.slice(-30), item]);
        setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), 2600);
      }),
    [onReact],
  );
  return (
    <div className="floating-reactions" aria-hidden="true">
      {items.map((r) => (
        <span key={r.id} style={{ left: `${r.left}%`, '--drift': `${r.drift}px`, '--rc': REACTION_COLORS[r.name] || '#fff' }}>
          <Icon name={r.name} size={30} strokeWidth={2.6} />
        </span>
      ))}
    </div>
  );
}
