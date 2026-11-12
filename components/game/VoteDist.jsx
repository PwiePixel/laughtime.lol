'use client';

import { useEffect, useState } from 'react';
import { RATINGS } from '@/lib/shared';
import Icon from '../Icon';
import { useApp } from '../Providers';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** counts from 0 to `target` (the reveal moment); jumps straight there with reduced motion */
export function useCountUp(target, ms = 900) {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (!target || reducedMotion()) {
      setValue(target || 0);
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      // ease out: fast first, settles on the final number
      setValue(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/** How often each rating was given - five bars, never who voted what. */
export default function VoteDist({ dist, compact = false }) {
  const { t } = useApp();
  if (!Array.isArray(dist) || dist.length !== 5) return null;
  const max = Math.max(1, ...dist);
  const label = `${t('vote.dist')}: ${RATINGS.map((r, i) => t('vote.distRow', { label: t(`vote.r${r.score}`), n: dist[i] })).join(', ')}`;
  return (
    <div className={`vote-dist ${compact ? 'is-compact' : ''}`} role="img" aria-label={label}>
      {RATINGS.map((r, i) => (
        <span key={r.score} className={`vd-col rating-${r.score} ${dist[i] ? '' : 'is-zero'}`} style={{ '--i': i }}>
          {!compact && <span className="vd-count">{dist[i]}</span>}
          <span className="vd-track">
            <span className="vd-bar" style={{ '--h': dist[i] / max }} />
          </span>
          {compact ? (
            <span className="vd-count">{dist[i]}</span>
          ) : (
            <span className="vd-icon">
              <Icon name={r.icon} size={16} strokeWidth={2.4} />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/** filling dots: `done` of `total` (the text stays for screen readers) */
export function ProgressDots({ done, total, label }) {
  const shown = Math.min(24, Math.max(0, total));
  return (
    <span className="dots" role="img" aria-label={label}>
      {Array.from({ length: shown }, (_, i) => (
        <i key={i} className={i < done ? 'on' : ''} />
      ))}
    </span>
  );
}
