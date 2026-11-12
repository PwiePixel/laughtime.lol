'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { loadProfile } from '@/lib/profile';
import Avatar from './Avatar';
import Icon from './Icon';
import { useApp } from './Providers';

const REASONS = {
  player: ['name', 'harassment', 'spam', 'other'],
  meme: ['meme', 'upload', 'harassment', 'other'],
};

/**
 * target: { kind: 'player' | 'meme', name?, avatar?, media? }
 * send:   async (reason, comment) => void   (throws ApiError / Error(code))
 */
export default function ReportDialog({ target, send, onClose }) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [state, setState] = useState('idle'); // idle | busy | done
  const [error, setError] = useState('');
  const reasons = REASONS[target.kind] || REASONS.player;

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    if (!reason) return;
    setState('busy');
    setError('');
    try {
      await send(reason, comment.trim());
      setState('done');
      setTimeout(onClose, 1800);
    } catch (err) {
      const key = `err.${err.code || err.message}`;
      setError(t(key) === key ? t('err.network') : t(key));
      setState('idle');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form className="card modal report-dialog pop-in" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="picker-head">
          <h2>
            <Icon name="flag" /> {target.kind === 'meme' ? t('report.memeTitle') : t('report.playerTitle')}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('games.close')}>
            <Icon name="x" />
          </button>
        </div>
        {state === 'done' ? (
          <div className="report-done">
            <div className="big-icon is-green">
              <Icon name="check-circle" size={48} />
            </div>
            <p className="lead">{t('report.thanks')}</p>
          </div>
        ) : (
          <>
            {target.name && (
              <p className="report-target">
                {target.avatar && <Avatar value={target.avatar} size={36} />}
                <strong>{target.name}</strong>
              </p>
            )}
            <span className="label">{t('report.why')}</span>
            <div className="report-reasons" role="radiogroup">
              {reasons.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={reason === r}
                  className={`chip ${reason === r ? 'on' : ''}`}
                  onClick={() => setReason(r)}
                >
                  {t(`report.reason.${r}`)}
                </button>
              ))}
            </div>
            <label className="label" htmlFor="report-comment">
              {t('report.comment')}
            </label>
            <textarea
              id="report-comment"
              className="input"
              rows={2}
              maxLength={300}
              value={comment}
              placeholder={t('report.commentPlaceholder')}
              onChange={(e) => setComment(e.target.value)}
            />
            {error && <p className="form-error">{error}</p>}
            <p className="muted small">{t('report.hint')}</p>
            <div className="row-end">
              <button type="button" className="btn btn-white" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-pink" disabled={!reason || state === 'busy'}>
                <Icon name="flag" size={18} /> {t('report.send')}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

/** report via the game connection: resolves on "reported", rejects on an error message */
export function reportInGame(game, payload) {
  return new Promise((resolve, reject) => {
    let done = false;
    const off = game.onMessage((m) => {
      if (done) return;
      if (m.t === 'reported') {
        done = true;
        off();
        resolve();
      }
    });
    const offErr = game.onError?.((code) => {
      if (done) return;
      done = true;
      off();
      offErr?.();
      reject(new Error(code));
    });
    if (!game.send({ t: 'report', ...payload })) {
      done = true;
      off();
      reject(new Error('network'));
      return;
    }
    setTimeout(() => {
      if (done) return;
      done = true;
      off();
      offErr?.();
      reject(new Error('network'));
    }, 6000);
  });
}

/** report via HTTP (profiles, gallery) */
export function reportHttp(body) {
  return async (reason, comment) => {
    await api('/api/reports', { method: 'POST', body: { ...body, reason, comment, pid: loadProfile()?.pid } });
  };
}

export function ReportButton({ onClick, label, className = '' }) {
  return (
    <button type="button" className={`report-btn ${className}`} onClick={onClick} title={label} aria-label={label}>
      <Icon name="flag" size={15} />
    </button>
  );
}
