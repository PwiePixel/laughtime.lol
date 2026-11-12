'use client';

/**
 * Kopfzeile von GeoTime.
 *
 * Bewusst dieselben Klassen wie bei LaughTime (.header, .brand, .main-nav,
 * .lang-switch, .account-menu …): das Aussehen ist damit 1:1 dasselbe, ohne
 * dass eine einzige LaughTime-Datei angefasst wird. Eigen sind nur die
 * Einträge – Spielen und Bestenliste, kein "Best memes".
 *
 * Während einer laufenden Runde blendet sie sich aus (Vollbild) – dafür setzt
 * das Spiel `geo-in-round` auf den <body>, siehe app/geotime/theme.css.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { geoPath } from './usePath';
import { useGeo } from './GeoProviders';

const ICONS = {
  play: 'M8 5.5v13l11-6.5z',
  podium: 'M4 20h16M7 20v-7h4v7M13 20V8h4v12',
  'log-in': 'M10 17l5-5-5-5M15 12H3M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6',
  'log-out': 'M14 17l5-5-5-5M19 12H7M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4',
  'chevron-down': 'M6 9l6 6 6-6',
};

const Icon = ({ name, size = 18, fill = false }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
    <path
      d={ICONS[name]}
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={fill ? 1 : 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function GeoHeader() {
  const { t, lang, setLang, account, accountLoading, logout } = useGeo();
  const path = geoPath(usePathname());
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Nur die laufende Runde ist Vollbild – Lobby und Auswahl behalten die
  // Kopfzeile. Das Spiel setzt dafür `geo-in-round` auf den <body>.


  // wie bei LaughTime: "Spielen" ist die Startseite, dort geht die Runde los
  const links = [
    { href: '/', label: t('nav.play'), icon: 'play', fill: true },
    { href: '/leaderboard', label: t('nav.leaderboard'), icon: 'podium' },
  ];
  const isActive = (href) => (href === '/' ? path === '/' || path.startsWith('/play') : path.startsWith(href));

  return (
    <header className="header">
      <Link href="/" className="brand" aria-label={`geotime.lol – ${t('nav.home')}`}>
        <img src="/logo-mark.svg" alt="" width="62" height="30" className="brand-mark" />
        <span className="brand-text">
          geotime<span>.lol</span>
        </span>
      </Link>

      <nav className="main-nav" aria-label="Main">
        {links.map((l) => {
          const active = isActive(l.href);
          return (
            <Link key={l.href} href={l.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
              <Icon name={l.icon} fill={l.fill} />
              <span>{l.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="header-right">
        <div className="lang-switch" role="group" aria-label={t('lang.switch')}>
          {['en', 'de'].map((l) => (
            <button key={l} type="button" className={lang === l ? 'active' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        {accountLoading ? (
          <span className="account-placeholder" aria-hidden="true" />
        ) : account ? (
          <div className="account-menu" ref={ref}>
            <button type="button" className="account-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <span className="geo-avatar" aria-hidden="true">
                {(account.name || account.username || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="account-name">{account.name || account.username}</span>
              <Icon name="chevron-down" size={16} />
            </button>
            {open && (
              <div className="account-dropdown card" role="menu" onClick={() => setOpen(false)}>
                <Link role="menuitem" href="/leaderboard">
                  <Icon name="podium" /> {t('nav.leaderboard')}
                </Link>
                <button role="menuitem" type="button" onClick={logout}>
                  <Icon name="log-out" /> {t('nav.logout')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link href="/login" className="btn btn-small btn-yellow login-btn">
            <Icon name="log-in" size={16} />
            <span>{t('nav.login')}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
