'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from './Providers';

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

/** whole seconds until the deadline (server clock) - re-renders once per second, not five times */
export function useSecondsLeft(deadline, serverNow) {
  const [secs, setSecs] = useState(() => Math.max(0, Math.ceil((deadline - serverNow()) / 1000)));
  useEffect(() => {
    const tick = () => setSecs(Math.max(0, Math.ceil((deadline - serverNow()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline, serverNow]);
  return secs;
}

// screen readers hear the clock at these marks only
const SPOKEN = [60, 30, 10, 5];

export default function Timer({ deadline, total, serverNow, compact = false, urgent = false }) {
  const { t } = useApp();
  const secs = useSecondsLeft(deadline, serverNow);
  const bar = useRef(null);
  const [spoken, setSpoken] = useState('');

  // the bar follows the server clock frame by frame (transform only, no re-render)
  useEffect(() => {
    if (compact || !total || !deadline) return undefined;
    let raf = 0;
    const paint = () => {
      const left = Math.max(0, deadline - serverNow());
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, left / total)})`;
      if (left > 0) raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [deadline, total, serverNow, compact]);

  useEffect(() => {
    if (SPOKEN.includes(secs)) setSpoken(t('timer.left', { n: secs }));
  }, [secs, t]);

  if (!deadline) return null;
  const hot = urgent || secs <= 10;
  return (
    <div className={`timer ${hot ? 'is-urgent' : ''} ${compact ? 'is-compact' : ''}`} role="timer" aria-live="off">
      <span className="timer-num">{secs}</span>
      {!compact && (
        <span className="timer-bar">
          <span ref={bar} />
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {spoken}
      </span>
    </div>
  );
}
