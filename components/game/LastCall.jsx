'use client';

import Icon from '../Icon';
import { useApp } from '../Providers';

/**
 * Sub line of a phase head. Shows the normal hint, or the "last call" notice of
 * the paced modes in the same place - so nothing jumps when the clock is cut.
 * `short` replaces the hint on phones, where the line must not wrap or be cut off.
 */
export default function PhaseSub({ lastCall, done, short, children }) {
  const { t } = useApp();
  if (!lastCall) {
    if (!short) return <p className="muted phase-sub">{children}</p>;
    return (
      <p className="muted phase-sub has-short">
        <span className="sub-full">{children}</span>
        <span className="sub-short">{short}</span>
      </p>
    );
  }
  return (
    <p className="phase-sub last-call" role="status">
      <Icon name="hourglass" size={16} strokeWidth={2.8} />
      <strong>{t('pace.lastCall')}</strong>
      <span>{t(done ? 'pace.lastCallWait' : 'pace.lastCallYou')}</span>
    </p>
  );
}
