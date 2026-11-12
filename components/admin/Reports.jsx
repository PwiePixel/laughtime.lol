'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { usePolling } from '@/lib/fetchCache';
import Avatar from '../Avatar';
import Icon from '../Icon';
import MemeCanvas from '../MemeCanvas';
import { useApp } from '../Providers';
import { sanctionUntil } from '../SanctionGate';
import ModActions from './ModActions';

function Group({ g, onChanged }) {
  const { t, lang } = useApp();
  const top = Object.entries(g.reasons).sort((a, b) => b[1] - a[1])[0]?.[0];
  const target = {
    key: g.key,
    name: g.name,
    avatar: g.avatar,
    guest: g.guest,
    username: g.user?.username,
    online: g.online,
    sanction: g.sanction,
    isAdmin: g.user?.isAdmin,
  };
  async function dismiss() {
    await api('/api/admin/reports/dismiss', { method: 'POST', body: { key: g.key } }).catch(() => {});
    onChanged();
  }
  return (
    <article className="card report-group">
      <header className="rg-head">
        <Avatar value={g.avatar} size={52} />
        <div className="rg-who">
          <h3>{g.name}</h3>
          <p className="muted small">
            {g.guest ? (
              <>
                <Icon name="user" size={14} /> {t('admin.guest')}
              </>
            ) : (
              <Link href={`/u/${g.user?.username}`} target="_blank">
                @{g.user?.username}
              </Link>
            )}
            {g.reportedName !== g.name && ` · ${t('admin.reportedAs', { name: g.reportedName })}`}
          </p>
          <div className="rg-badges">
            <span className="badge badge-alert">
              <Icon name="flag" size={13} /> {t('admin.reportCount', { n: g.reports.length })}
            </span>
            {Object.entries(g.reasons).map(([r, n]) => (
              <span key={r} className="badge badge-muted">
                {t(`report.reason.${r}`)} × {n}
              </span>
            ))}
            {g.online.length > 0 && (
              <span className="badge badge-online">
                <span className="live-dot" /> {t('admin.onlineIn', { code: g.online.map((o) => o.code).join(', ') })}
              </span>
            )}
            {g.sanction && (
              <span className="badge badge-sanction">
                <Icon name={g.sanction.type === 'ban' ? 'lock' : 'flag'} size={13} /> {t(`admin.type.${g.sanction.type}`)} · {sanctionUntil(t, lang, g.sanction)}
              </span>
            )}
            {g.previous > 0 && <span className="badge badge-muted">{t('admin.previous', { n: g.previous })}</span>}
          </div>
        </div>
      </header>
      <ul className="rg-reports">
        {g.reports.map((r) => (
          <li key={r.id}>
            <div className="rg-line">
              <strong>{t(`report.reason.${r.reason}`)}</strong>
              <span className="muted small">
                {t('admin.by', { name: r.reporter || '?' })} {r.reporterAccount ? '' : `(${t('admin.guest')})`} · {timeAgo(r.createdAt, lang)}
                {r.room ? ` · #${r.room}` : ''}
              </span>
            </div>
            {r.comment && <p className="rg-comment">{t('quote', { s: r.comment })}</p>}
            {r.context?.media && (
              <div className="rg-evidence">
                <MemeCanvas media={r.context.media} captions={r.context.captions || []} maxHeight="180px" lazy />
              </div>
            )}
          </li>
        ))}
      </ul>
      <ModActions target={target} suggest={top} onChanged={onChanged} onDismiss={dismiss} />
    </article>
  );
}

export default function Reports({ onCount }) {
  const { t } = useApp();
  const [status, setStatus] = useState('open');
  const [groups, setGroups] = useState(null);
  // switching between open and done quickly: only the answer to the latest question counts
  const latest = useRef(0);
  const load = useCallback(() => {
    const ticket = ++latest.current;
    api(`/api/admin/reports?status=${status}`)
      .then((d) => {
        if (ticket !== latest.current) return;
        setGroups(d.groups);
        if (status === 'open') onCount?.(d.groups.length);
      })
      .catch(() => ticket === latest.current && setGroups([]));
  }, [status, onCount]);
  useEffect(() => load(), [load]);
  // new reports show up on their own while somebody is looking, not in a background tab
  usePolling(load, 20_000);

  return (
    <div className="admin-reports">
      <div className="range-row">
        <div className="tabs">
          {['open', 'resolved', 'dismissed'].map((s) => (
            <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {t(`admin.status.${s}`)}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-small btn-white" onClick={load}>
          <Icon name="repeat" size={16} /> {t('admin.refresh')}
        </button>
      </div>
      {groups === null && <div className="spinner" aria-hidden="true" />}
      {groups?.length === 0 && (
        <div className="card center-text">
          <div className="big-icon is-green">
            <Icon name="check-circle" size={48} />
          </div>
          <p className="lead">{status === 'open' ? t('admin.noReports') : t('admin.nothingHere')}</p>
        </div>
      )}
      <div className="review-list">
        {groups?.map((g) => (
          <Group key={g.key} g={g} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
