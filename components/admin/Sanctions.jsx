'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import Avatar from '../Avatar';
import Icon from '../Icon';
import { useApp } from '../Providers';
import { sanctionUntil } from '../SanctionGate';

export default function Sanctions() {
  const { t, lang } = useApp();
  const [all, setAll] = useState(false);
  const [list, setList] = useState(null);
  const load = useCallback(() => {
    api(`/api/admin/sanctions${all ? '?all=1' : ''}`)
      .then((d) => setList(d.sanctions))
      .catch(() => setList([]));
  }, [all]);
  useEffect(() => load(), [load]);

  async function lift(id) {
    await api(`/api/admin/sanctions/${id}/lift`, { method: 'POST', body: {} }).catch(() => {});
    load();
  }

  return (
    <div className="admin-sanctions">
      <div className="range-row">
        <div className="tabs">
          <button type="button" className={!all ? 'on' : ''} onClick={() => setAll(false)}>
            {t('admin.activeOnly')}
          </button>
          <button type="button" className={all ? 'on' : ''} onClick={() => setAll(true)}>
            {t('admin.allHistory')}
          </button>
        </div>
      </div>
      {list === null && <div className="spinner" aria-hidden="true" />}
      {list?.length === 0 && (
        <div className="card center-text">
          <p className="lead">{t('admin.noSanctions')}</p>
        </div>
      )}
      <ul className="sanction-list">
        {list?.map((s) => (
          <li key={s.id} className={`card sanction-row ${s.active ? '' : 'is-ended'}`}>
            <Avatar value={s.target?.avatar} icon={s.target ? undefined : 'ghost'} size={40} />
            <div className="sr-main">
              <strong>
                {s.name} <span className="muted small">{s.guest ? `(${t('admin.guest')}${s.withIp ? ' + IP' : ''})` : `@${s.target?.username}`}</span>
              </strong>
              <span className="small">
                <span className={`badge ${s.type === 'ban' ? 'badge-alert' : 'badge-sanction'}`}>
                  <Icon name={s.type === 'ban' ? 'lock' : 'flag'} size={12} /> {t(`admin.type.${s.type}`)}
                </span>{' '}
                {t(`mod.reason.${s.reason}`)}
                {s.note && ` · ${t('quote', { s: s.note })}`}
              </span>
              <span className="muted small">
                {timeAgo(s.createdAt, lang)} · {t('admin.by', { name: s.by })} · {s.active ? sanctionUntil(t, lang, s) : s.liftedAt ? t('admin.liftedAt', { when: timeAgo(s.liftedAt, lang) }) : t('admin.ended')}
              </span>
            </div>
            {s.active && (
              <button type="button" className="btn btn-small btn-cyan" onClick={() => lift(s.id)}>
                <Icon name="lock-open" size={16} /> {t('admin.lift')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
