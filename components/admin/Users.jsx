'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import Avatar from '../Avatar';
import Icon from '../Icon';
import { useApp } from '../Providers';
import { sanctionUntil } from '../SanctionGate';
import ModActions from './ModActions';

function UserDetail({ id, onClose, onChanged }) {
  const { t, lang } = useApp();
  const [u, setU] = useState(null);
  const [confirm, setConfirm] = useState('');
  const load = useCallback(() => {
    api(`/api/admin/users/${id}`)
      .then((d) => setU(d.user))
      .catch(() => setU(false));
  }, [id]);
  useEffect(() => load(), [load]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  async function del() {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' }).catch(() => {});
    onChanged();
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="card modal user-detail pop-in" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <h2>
            <Icon name="user" /> {t('admin.userTitle')}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('games.close')}>
            <Icon name="x" />
          </button>
        </div>
        {u === null && <div className="spinner" aria-hidden="true" />}
        {u && (
          <>
            <div className="ud-head">
              <Avatar value={u.avatar} size={64} />
              <div>
                <h3>{u.displayName}</h3>
                <p className="muted small">
                  <Link href={`/u/${u.username}`} target="_blank">
                    @{u.username}
                  </Link>{' '}
                  · #{u.id} {u.isAdmin && `· ${t('nav.admin')}`}
                </p>
                <p className="muted small">
                  {t('admin.joined', { when: timeAgo(u.createdAt, lang) })} · {t('admin.lastSeen', { when: timeAgo(u.lastSeen, lang) })}
                  {u.discord && ` · Discord: ${u.discord}`}
                </p>
              </div>
            </div>
            {u.bio && <p className="rg-comment">{t('quote', { s: u.bio })}</p>}
            <div className="ud-stats">
              <span>
                <strong>{u.stats.games}</strong> {t('stats.games')}
              </span>
              <span>
                <strong>{u.stats.points}</strong> {t('stats.points')}
              </span>
              <span>
                <strong>{u.memes}</strong> {t('admin.memes')}
              </span>
              <span>
                <strong>{u.packs}</strong> {t('admin.packsCount')}
              </span>
              <span>
                <strong>{u.uploads}</strong> {t('admin.tot.uploads')}
              </span>
            </div>
            {u.sanction && (
              <p className="review-banner is-rejected">
                <Icon name={u.sanction.type === 'ban' ? 'lock' : 'flag'} size={18} /> {t(`admin.type.${u.sanction.type}`)} · {t(`mod.reason.${u.sanction.reason}`)} ·{' '}
                {sanctionUntil(t, lang, u.sanction)}
              </p>
            )}
            {u.online.length > 0 && (
              <p className="small">
                <span className="live-dot" /> {t('admin.onlineIn', { code: u.online.map((o) => o.code).join(', ') })}
              </p>
            )}
            <ModActions
              target={{ key: `u:${u.id}`, name: u.displayName, avatar: u.avatar, guest: false, username: u.username, online: u.online, sanction: u.sanction, isAdmin: u.isAdmin }}
              onChanged={() => {
                load();
                onChanged();
              }}
            />
            <h4>{t('admin.history')}</h4>
            {u.sanctions.length ? (
              <ul className="ud-list">
                {u.sanctions.map((s) => (
                  <li key={s.id}>
                    <strong>{t(`admin.type.${s.type}`)}</strong> · {t(`mod.reason.${s.reason}`)} {s.note && `· ${s.note}`}
                    <span className="muted small">
                      {' '}
                      · {timeAgo(s.createdAt, lang)} · {t('admin.by', { name: s.by })} · {s.active ? sanctionUntil(t, lang, s) : t('admin.ended')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{t('admin.noHistory')}</p>
            )}
            <h4>{t('admin.reportsAbout')}</h4>
            {u.reports.length ? (
              <ul className="ud-list">
                {u.reports.map((r, i) => (
                  <li key={i}>
                    <strong>{t(`report.reason.${r.reason}`)}</strong> {r.comment && `– ${t('quote', { s: r.comment })}`}
                    <span className="muted small">
                      {' '}
                      · {timeAgo(r.createdAt, lang)} · {t(`admin.status.${r.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{t('admin.noReportsUser')}</p>
            )}
            {!u.isAdmin && (
              <details className="danger-zone ud-delete">
                <summary>{t('admin.deleteAccount')}</summary>
                <p className="muted small">{t('admin.deleteHint', { name: u.username })}</p>
                <div className="row-start">
                  <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={u.username} aria-label={u.username} />
                  <button type="button" className="btn btn-danger" disabled={confirm !== u.username} onClick={del}>
                    <Icon name="trash" size={18} /> {t('admin.deleteAccount')}
                  </button>
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Users() {
  const { t, lang } = useApp();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => {
    api(`/api/admin/users?q=${encodeURIComponent(q)}`)
      .then((d) => setUsers(d.users))
      .catch(() => setUsers([]));
  }, [q]);
  useEffect(() => {
    const id = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  return (
    <div className="admin-users">
      <div className="studio-search-row admin-search">
        <Icon name="search" className="search-icon" />
        <input className="input" value={q} placeholder={t('admin.searchUsers')} aria-label={t('admin.searchUsers')} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card lb-table-wrap">
        <table className="lb-table admin-table">
          <thead>
            <tr>
              <th>{t('lb.player')}</th>
              <th className="hide-sm">{t('admin.col.joined')}</th>
              <th className="hide-sm">{t('admin.col.lastSeen')}</th>
              <th className="num hide-sm">{t('stats.games')}</th>
              <th className="num">{t('admin.col.reports')}</th>
              <th className="num">{t('admin.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => setOpen(u.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(u.id)}>
                <td>
                  <span className="lb-user">
                    <Avatar value={u.avatar} size={32} />
                    <span>
                      <strong>
                        {u.online && <span className="live-dot" />} {u.displayName}
                      </strong>
                      <small className="muted">@{u.username}</small>
                    </span>
                  </span>
                </td>
                <td className="hide-sm small">{new Date(u.createdAt).toLocaleDateString(lang)}</td>
                <td className="hide-sm small">{timeAgo(u.lastSeen, lang)}</td>
                <td className="num hide-sm">{u.games}</td>
                <td className="num">{u.reports || '–'}</td>
                <td className="num">
                  {u.isAdmin ? (
                    <span className="badge">{t('nav.admin')}</span>
                  ) : u.sanction ? (
                    <span className="badge badge-sanction">{t(`admin.type.${u.sanction.type}`)}</span>
                  ) : (
                    <span className="badge badge-muted">{t('admin.ok')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users?.length === 0 && <p className="muted center-text">{t('admin.noUsers')}</p>}
      </div>
      {open && <UserDetail id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}
