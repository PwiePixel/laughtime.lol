'use client';

import Link from 'next/link';
import { useApp } from '../Providers';

/** Small "BETA" marker next to the logo while the visitor is in the beta channel. */
export default function BetaBadge() {
  const { channel, t } = useApp();
  if (channel !== 'beta') return null;
  return (
    <Link href="/beta" className="beta-badge" aria-label={t('beta.badge.label')} title={t('beta.badge.label')}>
      {t('beta.badge')}
    </Link>
  );
}
