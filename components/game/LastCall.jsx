'use client';

import Icon from '../Icon';
import { useApp } from '../Providers';

/**
 * Sub line of a phase head. Shows the normal hint, or the "last call" notice of
 * the paced modes in the same place - so nothing jumps when the clock is cut.
 */
export default function PhaseSub({ lastCall, done, children }) {
  const { t } = useApp();
  if (!lastCall) return <p className="muted phase-sub">{children}</p>;
  return (
    <p className="phase-sub last-call" role="status">
      <Icon name="hourglass" size={16} strokeWidth={2.8} />
      <strong>{t('pace.lastCall')}</strong>
      <span>{t(done ? 'pace.lastCallWait' : 'pace.lastCallYou')}</span>
    </p>
  );
}
