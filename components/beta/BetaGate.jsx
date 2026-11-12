'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '../Icon';
import { useApp } from '../Providers';

// pages that stay reachable for everybody: logging in and the legal texts
const OPEN_PATHS = ['/login', '/legal'];

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'laughtime.lol';
  }
};

/**
 * Notice on a beta host for visitors who may not use the beta (BETA_ACCESS):
 * better a clear "this is for …" than quietly showing the stable page there.
 *   reason   null | 'accounts' | 'admins' – decided by the server per request
 *   mainUrl  where the regular version lives
 */
export default function BetaGate({ reason = null, mainUrl = '', children }) {
  const pathname = usePathname() || '/';
  const { t, account, accountLoading } = useApp();
  if (!reason || OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return children;
  const kind = reason === 'accounts' ? 'accounts' : 'admins';
  const host = hostOf(mainUrl);
  const next = pathname.startsWith('/') && !pathname.startsWith('//') ? `?next=${encodeURIComponent(pathname)}` : '';
  return (
    <div className="page-narrow beta-gate-page">
      <div className="card beta-gate" role="alert">
        <div className="beta-gate-icon" aria-hidden="true">
          <Icon name={kind === 'accounts' ? 'key' : 'lock'} size={40} />
        </div>
        <span className="beta-chip">{t('beta.badge')}</span>
        <h1>{t(`beta.gate.${kind}.title`)}</h1>
        <p className="lead">{t(`beta.gate.${kind}.text`)}</p>
        {account && <p className="muted small">{t('beta.gate.notTeam', { name: account.displayName })}</p>}
        <div className="beta-gate-actions">
          {!account && !accountLoading && (
            <Link href={`/login${next}`} className={`btn ${kind === 'accounts' ? 'btn-yellow' : 'btn-white'}`}>
              <Icon name="log-in" size={18} /> {t(kind === 'accounts' ? 'beta.gate.login' : 'beta.gate.teamLogin')}
            </Link>
          )}
          {mainUrl && (
            <a href={mainUrl} className={`btn ${kind === 'accounts' && !account ? 'btn-white' : 'btn-yellow'}`}>
              <Icon name="play" size={18} /> {t('beta.gate.main', { host })}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
