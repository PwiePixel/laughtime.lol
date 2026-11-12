'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Icon from './Icon';
import PackCard from './PackCard';
import { useApp } from './Providers';

/** Host picks the meme pack for a private room: official content, own packs or community packs. */
export default function PackPicker({ current, onPick, onClose }) {
  const { t, account } = useApp();
  const [tab, setTab] = useState(account ? 'mine' : 'public');
  const [query, setQuery] = useState('');
  const [list, setList] = useState(null);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  useEffect(() => {
    if (tab === 'official' || (tab === 'mine' && !account)) {
      setList([]);
      return undefined;
    }
    let alive = true;
    setList(null);
    const id = setTimeout(() => {
      api(`/api/packs?scope=${tab}&q=${encodeURIComponent(query)}&limit=40`)
        .then((d) => alive && setList(d.items))
        .catch(() => alive && setList([]));
    }, query ? 300 : 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [tab, query, account]);

  const choose = (pack) => {
    onPick(pack ? pack.id : null);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="card modal pack-picker pop-in" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <h2>
            <Icon name="package" /> {t('lobby.pack')}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('games.close')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="tabs" role="tablist">
          {['official', 'mine', 'public'].map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {t(`packs.${k}`)}
            </button>
          ))}
        </div>

        {tab === 'official' && (
          <button type="button" className={`pack-card official ${!current ? 'is-selected' : ''}`} onClick={() => choose(null)}>
            <span className="media-thumb pack-cover official-cover">
              <img src="/logo-mark.svg" alt="" />
            </span>
            <span className="pack-info">
              <strong className="pack-name">{t('lobby.pack.official')}</strong>
              <span className="pack-meta">{t('lobby.pack.none')}</span>
            </span>
            <span className="pack-action">{!current ? <Icon name="check-circle" /> : t('packs.select')}</span>
          </button>
        )}

        {tab === 'public' && (
          <input className="input" value={query} placeholder={t('packs.search')} onChange={(e) => setQuery(e.target.value)} aria-label={t('packs.search')} />
        )}

        {tab === 'mine' && !account && (
          <p className="muted center-text">
            {t('packs.loginHint')} <Link href="/login">{t('nav.login')}</Link>
          </p>
        )}

        {tab !== 'official' && (
          <div className="pack-list">
            {list === null && <div className="spinner" aria-hidden="true" />}
            {list?.length === 0 && (tab !== 'mine' || account) && (
              <p className="muted center-text">{tab === 'mine' ? t('packs.emptyMine') : t('packs.empty')}</p>
            )}
            {list?.map((p) => (
              <PackCard
                key={p.id}
                pack={p}
                selected={current?.id === p.id}
                onClick={p.playable ? () => choose(p) : undefined}
                action={
                  <span className="pack-action">
                    {current?.id === p.id ? <Icon name="check-circle" /> : p.playable ? t('packs.select') : <Icon name="lock" />}
                  </span>
                }
              />
            ))}
          </div>
        )}
        <Link href="/studio" className="studio-link" target="_blank">
          <Icon name="wand" size={18} /> {t('lobby.pack.studio')}
        </Link>
      </div>
    </div>
  );
}
