'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { OPERATOR } from '@/lib/operator';
import Icon from './Icon';
import { useApp } from './Providers';

export function sanctionUntil(t, lang, sanction) {
  if (!sanction?.until) return t('mod.permanent');
  return t('mod.until', { date: new Date(sanction.until).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) });
}

/** full-page notice for banned players */
export function BanNotice({ sanction, compact = false }) {
  const { t, lang, account, logout } = useApp();
  const ban = sanction?.type === 'ban';
  return (
    <div className={`card ban-card ${ban ? 'is-ban' : 'is-restrict'} ${compact ? 'is-compact' : ''}`} role="alert">
      <div className="ban-icon" aria-hidden="true">
        <Icon name={ban ? 'lock' : 'flag'} size={44} />
      </div>
      <h1>{ban ? t('mod.bannedTitle') : t('mod.restrictedTitle')}</h1>
      <p className="lead">{ban ? t('mod.bannedText') : t('mod.restrictedText')}</p>
      <dl className="ban-details">
        <dt>{t('mod.reasonLabel')}</dt>
        <dd>{t(`mod.reason.${sanction.reason}`)}</dd>
        {sanction.note && (
          <>
            <dt>{t('mod.noteLabel')}</dt>
            <dd>{sanction.note}</dd>
          </>
        )}
        <dt>{t('mod.durationLabel')}</dt>
        <dd>{sanctionUntil(t, lang, sanction)}</dd>
      </dl>
      <p className="muted small">
        {t('mod.appeal')} <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
      </p>
      <div className="row-center">
        {ban && account && (
          <button type="button" className="btn btn-white" onClick={logout}>
            <Icon name="log-out" size={18} /> {t('nav.logout')}
          </button>
        )}
        {!ban && (
          <Link href="/" className="btn btn-yellow">
            {t('common.backHome')}
          </Link>
        )}
        <Link href="/legal" className="btn btn-ghost">
          {t('nav.legal')}
        </Link>
      </div>
    </div>
  );
}

export default function SanctionGate({ children }) {
  const { t, lang, sanction } = useApp();
  const pathname = usePathname();
  if (sanction?.type === 'ban' && !pathname.startsWith('/legal')) {
    return (
      <div className="page-narrow ban-page">
        <BanNotice sanction={sanction} />
      </div>
    );
  }
  return (
    <>
      {sanction?.type === 'restrict' && (
        <p className="restrict-banner" role="status">
          <Icon name="flag" size={18} /> {t('mod.restrictedBanner', { reason: t(`mod.reason.${sanction.reason}`) })} · {sanctionUntil(t, lang, sanction)}
        </p>
      )}
      {children}
    </>
  );
}
