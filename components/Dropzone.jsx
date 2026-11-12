'use client';

import { useEffect, useRef, useState } from 'react';
import { UPLOAD_TYPES } from '@/lib/shared';
import { fileFromEvent } from '@/lib/upload';
import Icon from './Icon';
import { useApp } from './Providers';

/** Drop / choose / paste a picture or GIF. */
export default function Dropzone({ onFile, progress = null, maxMb = 8, disabled = false, compact = false, pasteTarget = true }) {
  const { t } = useApp();
  const [over, setOver] = useState(false);
  const input = useRef(null);
  // dragenter/dragleave also fire for every child: count them instead of toggling
  const depth = useRef(0);
  const busy = progress !== null;

  useEffect(() => {
    if (!pasteTarget || disabled) return undefined;
    const onPaste = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const f = fileFromEvent(e);
      if (f) {
        e.preventDefault();
        onFile(f);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFile, pasteTarget, disabled]);

  return (
    <label
      className={`dropzone ${over ? 'is-over' : ''} ${busy ? 'is-busy' : ''} ${compact ? 'is-compact' : ''} ${disabled ? 'is-disabled' : ''}`}
      aria-busy={busy || undefined}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        if (!disabled && !busy) setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const f = fileFromEvent(e);
        if (f && !disabled && !busy) onFile(f);
      }}
    >
      <input
        ref={input}
        type="file"
        accept={UPLOAD_TYPES.join(',')}
        className="sr-only"
        disabled={disabled || busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <span className="dropzone-icon" aria-hidden="true">
        {busy ? <span className="dl-progress" style={{ '--p': `${progress * 3.6}deg` }}><span>{progress}</span></span> : <Icon name="image-up" size={compact ? 26 : 40} />}
      </span>
      <span className="dropzone-text">
        <strong>{busy ? t('upload.uploading', { n: progress }) : over ? t('ui.upload.release') : t('upload.drop')}</strong>
        <small>{t('upload.types', { n: maxMb })}</small>
      </span>
    </label>
  );
}
