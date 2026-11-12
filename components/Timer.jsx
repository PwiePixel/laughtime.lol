'use client';

import { useEffect, useState } from 'react';

export function useCountdown(deadline, serverNow) {
  const [left, setLeft] = useState(() => Math.max(0, deadline - serverNow()));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, deadline - serverNow()));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline, serverNow]);
  return left;
}

export default function Timer({ deadline, total, serverNow, compact = false }) {
  const left = useCountdown(deadline, serverNow);
  if (!deadline) return null;
  const secs = Math.ceil(left / 1000);
  const pct = total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  const urgent = secs <= 10;
  return (
    <div className={`timer ${urgent ? 'is-urgent' : ''} ${compact ? 'is-compact' : ''}`} role="timer" aria-live="off">
      <span className="timer-num">{secs}</span>
      {!compact && (
        <span className="timer-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}
