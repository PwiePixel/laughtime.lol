'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import Icon from '../Icon';
import { useApp } from '../Providers';
import SanctionDialog from './SanctionDialog';

/**
 * Buttons for one target: reset name, kick, restrict, ban (+ dismiss / lift).
 * target: { key, name, avatar, guest, username, online[], sanction, isAdmin }
 */
export default function ModActions({ target, suggest, onChanged, onDismiss, compact = false }) {
  const { t } = useApp();
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');

  async function call(key, path, body, text) {
    setBusy(key);
    try {
      const res = await api(path, { method: 'POST', body });
      setFlash(typeof text === 'function' ? text(res) : text);
      onChanged?.();
    } catch (err) {
      const k = `admin.err.${err.code}`;
      setFlash(t(k) === k ? t('err.network') : t(k));
    } finally {
      setBusy('');
      setTimeout(() => setFlash(''), 3500);
    }
  }

  if (target.isAdmin) return <p className="muted small">{t('admin.isAdmin')}</p>;
  const online = target.online?.length > 0;
  return (
    <div className={`mod-actions ${compact ? 'is-compact' : ''}`}>
      <button
        type="button"
        className="btn btn-small btn-white"
        disabled={Boolean(busy)}
        onClick={() => window.confirm(t('admin.confirmResetName', { name: target.name })) && call('name', '/api/admin/reset-name', { target: { key: target.key } }, (r) => t('admin.nameResetDone', { name: r.name }))}
      >
        <Icon name="edit" size={16} /> {t('admin.resetName')}
      </button>
      {!target.guest && (
        <button
          type="button"
          className="btn btn-small btn-white"
          disabled={Boolean(busy)}
          onClick={() =>
            window.confirm(t('admin.confirmResetUsername', { name: target.username })) &&
            call('username', '/api/admin/reset-username', { userId: Number(target.key.slice(2)) }, (r) => t('admin.usernameResetDone', { name: r.username }))
          }
        >
          <Icon name="user" size={16} /> {t('admin.resetUsername')}
        </button>
      )}
      {online && (
        <button type="button" className="btn btn-small btn-white" disabled={Boolean(busy)} onClick={() => call('kick', '/api/admin/kick', { target: { key: target.key } }, t('admin.kicked'))}>
          <Icon name="door" size={16} /> {t('admin.kick')}
        </button>
      )}
      <button type="button" className="btn btn-small btn-pink" disabled={Boolean(busy)} onClick={() => setDialog('restrict')}>
        <Icon name="flag" size={16} /> {t('admin.restrict')}
      </button>
      <button type="button" className="btn btn-small btn-danger" disabled={Boolean(busy)} onClick={() => setDialog('ban')}>
        <Icon name="lock" size={16} /> {t('admin.ban')}
      </button>
      {target.sanction && (
        <button type="button" className="btn btn-small btn-cyan" disabled={Boolean(busy)} onClick={() => call('lift', `/api/admin/sanctions/${target.sanction.id}/lift`, {}, t('admin.lifted'))}>
          <Icon name="lock-open" size={16} /> {t('admin.lift')}
        </button>
      )}
      {onDismiss && (
        <button type="button" className="btn btn-small btn-ghost" disabled={Boolean(busy)} onClick={onDismiss}>
          <Icon name="check" size={16} /> {t('admin.dismiss')}
        </button>
      )}
      {flash && (
        <span className="mod-flash" role="status">
          {flash}
        </span>
      )}
      {dialog && (
        <SanctionDialog
          target={target}
          type={dialog}
          suggest={suggest}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setFlash(t('admin.sanctionDone'));
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
