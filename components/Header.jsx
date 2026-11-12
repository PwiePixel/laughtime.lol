'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import Avatar from './Avatar';
import Icon from './Icon';
import { useApp } from './Providers';

function AccountMenu({ inActivity = false }) {
  const { t, account, accountLoading, logout } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // admins: number of open reports + pending packs
  const [todo, setTodo] = useState(0);
  useEffect(() => {
    if (!account?.isAdmin) return undefined;
    const load = () =>
      api('/api/admin/summary')
        .then((d) => setTodo(d.openReports + d.pendingPacks))
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [account?.isAdmin, pathname]);

  if (accountLoading) return <span className="account-placeholder" aria-hidden="true" />;
  if (!account) {
    return (
      <Link href="/login" className="btn btn-small btn-yellow login-btn">
        <Icon name="log-in" size={16} />
        <span>{t('nav.login')}</span>
      </Link>
    );
  }
  return (
    <div className="account-menu" ref={ref}>
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar value={account.avatar} size={34} />
        <span className="account-name">{account.displayName}</span>
        {todo > 0 && <span className="todo-dot" aria-label={t('admin.todo', { n: todo })}>{todo > 9 ? '9+' : todo}</span>}
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div className="account-dropdown card" role="menu" onClick={() => setOpen(false)}>
          <Link role="menuitem" href={`/u/${account.username}`}>
            <Icon name="user" size={18} /> {t('nav.profile')}
          </Link>
          <Link role="menuitem" href="/studio">
            <Icon name="wand" size={18} /> {t('nav.studio')}
          </Link>
          <Link role="menuitem" href="/account">
            <Icon name="settings" size={18} /> {t('nav.settings')}
          </Link>
          {account.isAdmin && (
            <Link role="menuitem" href="/admin">
              <Icon name="shield" size={18} /> {t('nav.admin')}
              {todo > 0 && <span className="tab-badge">{todo}</span>}
            </Link>
          )}
          {/* inside Discord the Discord account is the login */}
          {!inActivity && (
            <button role="menuitem" type="button" onClick={logout}>
              <Icon name="log-out" size={18} /> {t('nav.logout')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Site header. Inside the Discord Activity it is rendered by ActivityApp with
 * `activityView` (the open view) – its links are then handled by the activity.
 */
export default function Header({ activityView = null }) {
  const { lang, setLang, t, activityMode } = useApp();
  const pathname = usePathname();
  const inActivity = activityView !== null;
  // the layout's header steps aside for the activity's own one –
  // and GeoTime (own game, own ports) brings its own look entirely
  if (!inActivity && (activityMode || pathname?.startsWith('/activity'))) return null;
  const links = [
    { href: '/', label: t('nav.play'), icon: 'play', view: 'game' },
    { href: '/memes', label: t('nav.memes'), icon: 'trophy', view: 'memes' },
    { href: '/leaderboard', label: t('nav.leaderboard'), icon: 'podium', view: 'leaderboard' },
  ];
  const isActive = (l) => (inActivity ? activityView === l.view : l.href === '/' ? pathname === '/' : pathname.startsWith(l.href));
  return (
    <header className={`header ${inActivity ? 'in-activity' : ''}`}>
      <Link href="/" className="brand" aria-label={`laughtime.lol – ${t('nav.home')}`}>
        <img src="/logo-mark.svg" alt="" width="62" height="30" className="brand-mark" />
        <span className="brand-text">
          laughtime<span>.lol</span>
        </span>
      </Link>
      <nav className="main-nav" aria-label="Main">
        {links.map((l) => {
          const active = isActive(l);
          return (
            <Link key={l.href} href={l.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
              <Icon name={l.icon} size={18} />
              <span>{l.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="header-right">
        <div className="lang-switch" role="group" aria-label="Language">
          {['en', 'de'].map((l) => (
            <button
              key={l}
              type="button"
              className={lang === l ? 'active' : ''}
              aria-pressed={lang === l}
              onClick={() => setLang(l, { refresh: !inActivity })}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <AccountMenu inActivity={inActivity} />
      </div>
    </header>
  );
}
