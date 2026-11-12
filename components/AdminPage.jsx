'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Dashboard from './admin/Dashboard';
import Log from './admin/Log';
import Reports from './admin/Reports';
import Sanctions from './admin/Sanctions';
import Users from './admin/Users';
import { api } from '@/lib/api';
import Avatar from './Avatar';
import Icon from './Icon';
import { MediaThumb } from './PackCard';
import { useApp } from './Providers';

function ReviewCard({ pack, onDone }) {
  const { t } = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function decide(approve) {
    setBusy(true);
    try {
      await api(`/api/admin/packs/${pack.id}/review`, { method: 'POST', body: { approve, note } });
      onDone(pack.id);
    } catch {
      setBusy(false);
    }
  }
  return (
    <article className="card review-card">
      <header className="review-head">
        <div>
          <h2>{pack.name}</h2>
          <p className="pack-owner">
            <Avatar value={pack.owner?.avatar} size={24} />
            <Link href={`/u/${pack.owner?.username}`}>{pack.owner?.displayName}</Link>
            <span className="muted">
              · {t('lobby.pack.items', { n: pack.itemCount })} · {t('admin.uploads', { n: pack.uploadCount })}
            </span>
          </p>
          {pack.description && <p className="muted">{pack.description}</p>}
        </div>
      </header>
      <div className="media-grid in-pack">
        {pack.items.map((m) => (
          <a key={m.id} className={`media-tile ${m.upload && !m.approved ? 'needs-review' : ''}`} href={m.src} target="_blank" rel="noopener">
            <MediaThumb media={m} />
            <span className="media-title">{m.title}</span>
          </a>
        ))}
      </div>
      <div className="review-actions">
        <input className="input" value={note} maxLength={200} placeholder={t('admin.note')} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="btn btn-yellow" disabled={busy} onClick={() => decide(true)}>
          <Icon name="approved" size={18} /> {t('admin.approve')}
        </button>
        <button type="button" className="btn btn-white danger" disabled={busy} onClick={() => decide(false)}>
          <Icon name="flag" size={18} /> {t('admin.reject')}
        </button>
      </div>
    </article>
  );
}

function Reviews({ onCount }) {
  const { t } = useApp();
  const [packs, setPacks] = useState(null);
  const load = useCallback(() => {
    api('/api/admin/reviews')
      .then((d) => {
        setPacks(d.packs);
        onCount?.(d.packs.length);
      })
      .catch(() => setPacks([]));
  }, [onCount]);
  useEffect(() => load(), [load]);
  return (
    <div>
      <p className="muted-on-dark">{t('admin.sub')}</p>
      {packs === null && <div className="spinner" aria-hidden="true" />}
      {packs?.length === 0 && (
        <div className="card center-text">
          <div className="big-icon is-green">
            <Icon name="check-circle" size={48} />
          </div>
          <p className="lead">{t('admin.empty')}</p>
        </div>
      )}
      <div className="review-list">
        {packs?.map((p) => (
          <ReviewCard
            key={p.id}
            pack={p}
            onDone={(id) =>
              setPacks((list) => {
                const next = list.filter((x) => x.id !== id);
                onCount?.(next.length);
                return next;
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

const TABS = [
  { id: 'dashboard', icon: 'chart' },
  { id: 'reports', icon: 'flag' },
  { id: 'users', icon: 'users' },
  { id: 'sanctions', icon: 'lock' },
  { id: 'packs', icon: 'package' },
  { id: 'log', icon: 'clock' },
];

export default function AdminPage() {
  const { t, account, accountLoading } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = TABS.some((x) => x.id === params.get('tab')) ? params.get('tab') : 'dashboard';
  const [counts, setCounts] = useState({ reports: 0, packs: 0 });

  useEffect(() => {
    if (!account?.isAdmin) return undefined;
    const load = () =>
      api('/api/admin/summary')
        .then((d) => setCounts({ reports: d.openReports, packs: d.pendingPacks }))
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [account?.isAdmin]);

  const setReports = useCallback((n) => setCounts((c) => ({ ...c, reports: n })), []);
  const setPacksCount = useCallback((n) => setCounts((c) => ({ ...c, packs: n })), []);

  if (accountLoading) return <div className="page-center">{t('common.loading')}</div>;
  if (!account?.isAdmin) {
    return (
      <div className="page-narrow center">
        <div className="card">
          <div className="big-icon">
            <Icon name="lock" size={48} />
          </div>
          <p className="lead">{t('admin.forbidden')}</p>
          <Link href="/" className="btn btn-yellow">
            {t('common.backHome')}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="page-wide admin-page">
      <div className="page-head">
        <div>
          <h1>
            <Icon name="shield" size={30} /> {t('admin.panel')}
          </h1>
          <p className="muted-on-dark">{t('admin.panelSub')}</p>
        </div>
      </div>
      <nav className="admin-tabs" aria-label={t('admin.panel')}>
        {TABS.map((x) => {
          const badge = x.id === 'reports' ? counts.reports : x.id === 'packs' ? counts.packs : 0;
          return (
            <button
              key={x.id}
              type="button"
              className={tab === x.id ? 'on' : ''}
              aria-current={tab === x.id ? 'page' : undefined}
              onClick={() => router.replace(`${pathname}?tab=${x.id}`, { scroll: false })}
            >
              <Icon name={x.icon} size={18} /> {t(`admin.tab.${x.id}`)}
              {badge > 0 && <span className="tab-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'reports' && <Reports onCount={setReports} />}
      {tab === 'users' && <Users />}
      {tab === 'sanctions' && <Sanctions />}
      {tab === 'packs' && <Reviews onCount={setPacksCount} />}
      {tab === 'log' && <Log />}
    </div>
  );
}
