'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '../Providers';

// Target is stored as "u:12 (name)", "g:<pid> (name)" or "pack:3 (name)".
function splitTarget(target = '') {
  const m = /^(\S+) \((.*)\)$/s.exec(target);
  return m ? { key: m[1], name: m[2] } : { key: '', name: target };
}

function formatDetails(t, raw) {
  if (!raw) return '';
  let d = null;
  try {
    d = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!d || typeof d !== 'object') return raw;
  const parts = [];
  if (d.duration) parts.push(t(`admin.dur.${d.duration}`));
  if (d.reason) parts.push(t(`mod.reason.${d.reason}`));
  if (d.note) parts.push(t('quote', { s: d.note }));
  if (d.ip) parts.push(t('admin.log.ip'));
  return parts.join(' · ');
}

export default function Log() {
  const { t, lang } = useApp();
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    api('/api/admin/log')
      .then((d) => setEntries(d.entries))
      .catch(() => setEntries([]));
  }, []);
  if (entries === null) return <div className="spinner" aria-hidden="true" />;
  const fmtDate = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="card lb-table-wrap">
      <table className="lb-table admin-table log-table">
        <thead>
          <tr>
            <th className="c-time">{t('admin.col.time')}</th>
            <th className="c-admin hide-sm">{t('admin.col.admin')}</th>
            <th className="c-action">{t('admin.col.action')}</th>
            <th className="c-target">{t('admin.col.target')}</th>
            <th className="hide-sm">{t('admin.col.details')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const key = `admin.action.${e.action}`;
            const target = splitTarget(e.target);
            return (
              <tr key={e.id}>
                <td className="small nowrap">
                  <span className="log-date">{fmtDate.format(new Date(e.createdAt))}</span>
                  <span className="log-key">{fmtTime.format(new Date(e.createdAt))}</span>
                </td>
                <td className="hide-sm">{e.admin}</td>
                <td>
                  <strong>{t(key) === key ? e.action : t(key)}</strong>
                </td>
                <td>
                  <span className="log-target">{target.name}</span>
                  {target.key && <small className="log-key">{target.key}</small>}
                </td>
                <td className="small muted hide-sm">{formatDetails(t, e.details)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!entries.length && <p className="muted center-text">{t('admin.nothingHere')}</p>}
    </div>
  );
}
