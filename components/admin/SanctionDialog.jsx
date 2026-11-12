'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { MOD_REASONS, SANCTION_DURATIONS } from '@/lib/shared';
import Avatar from '../Avatar';
import Icon from '../Icon';
import { useApp } from '../Providers';

const DEFAULT_REASON = { name: 'offensive_name', meme: 'offensive_content', upload: 'inappropriate_upload', harassment: 'harassment', spam: 'spam' };

/** ban / restrict with duration + preset reason */
export default function SanctionDialog({ target, type: initialType = 'ban', suggest, onDone, onClose }) {
  const { t } = useApp();
  const [type, setType] = useState(initialType);
  const [duration, setDuration] = useState(initialType === 'ban' ? '24h' : '7d');
  const [reason, setReason] = useState(DEFAULT_REASON[suggest] || 'offensive_name');
  const [note, setNote] = useState('');
  const [withIp, setWithIp] = useState(Boolean(target.guest));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/api/admin/sanctions', { method: 'POST', body: { target: { key: target.key }, type, duration, reason, note, withIp } });
      onDone(res);
    } catch (err) {
      const key = `admin.err.${err.code}`;
      setError(t(key) === key ? t('err.network') : t(key));
      setBusy(false);
    }
  }

  const needsNote = reason === 'other' && !note.trim();
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form className="card modal sanction-dialog pop-in" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="picker-head">
          <h2>
            <Icon name={type === 'ban' ? 'lock' : 'flag'} /> {t(type === 'ban' ? 'admin.banTitle' : 'admin.restrictTitle')}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('games.close')}>
            <Icon name="x" />
          </button>
        </div>
        <p className="report-target">
          <Avatar value={target.avatar} size={36} />
          <strong>{target.name}</strong>
          <span className="muted small">{target.guest ? t('admin.guest') : `@${target.username}`}</span>
        </p>

        <div className="tabs sanction-type" role="radiogroup">
          {['ban', 'restrict'].map((k) => (
            <button key={k} type="button" role="radio" aria-checked={type === k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>
              <Icon name={k === 'ban' ? 'lock' : 'flag'} size={16} /> {t(`admin.type.${k}`)}
            </button>
          ))}
        </div>
        <p className="muted small">{t(`admin.typeHint.${type}`)}</p>

        <span className="label">{t('admin.duration')}</span>
        <div className="chips" role="radiogroup">
          {Object.keys(SANCTION_DURATIONS).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={duration === d} className={`chip ${duration === d ? 'on' : ''}`} onClick={() => setDuration(d)}>
              {t(`admin.dur.${d}`)}
            </button>
          ))}
        </div>

        <span className="label">{t('admin.reason')}</span>
        <div className="reason-list" role="radiogroup">
          {MOD_REASONS.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} className={`reason-option ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
              <strong>{t(`mod.reason.${r}`)}</strong>
              <small>{t(`mod.reasonText.${r}`)}</small>
            </button>
          ))}
        </div>

        <label className="label" htmlFor="sanction-note">
          {reason === 'other' ? t('admin.noteRequired') : t('admin.note')}
        </label>
        <textarea id="sanction-note" className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />

        {target.guest && (
          <label className="switch-row">
            <span>
              <strong>{t('admin.withIp')}</strong>
              <small className="muted">{t('admin.withIpHint')}</small>
            </span>
            <input type="checkbox" className="switch" checked={withIp} onChange={(e) => setWithIp(e.target.checked)} />
          </label>
        )}

        <div className="sanction-preview">
          <span className="muted small">{t('admin.preview')}</span>
          <p>
            <strong>{t(type === 'ban' ? 'mod.bannedTitle' : 'mod.restrictedTitle')}</strong> – {t(`mod.reason.${reason}`)}
            {note.trim() ? ` · ${note.trim()}` : ''} · {duration === 'perm' ? t('mod.permanent') : t(`admin.dur.${duration}`)}
          </p>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="row-end">
          <button type="button" className="btn btn-white" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={`btn ${type === 'ban' ? 'btn-danger' : 'btn-pink'}`} disabled={busy || needsNote}>
            <Icon name={type === 'ban' ? 'lock' : 'flag'} size={18} /> {t(type === 'ban' ? 'admin.doBan' : 'admin.doRestrict')}
          </button>
        </div>
      </form>
    </div>
  );
}
