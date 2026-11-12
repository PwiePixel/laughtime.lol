'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cachedGet, invalidateCache, peekCached, useCachedFetch } from '@/lib/fetchCache';
import { useDebouncedValue } from '@/lib/timing';
import { PACK_LIMITS } from '@/lib/shared';
import { uploadFile } from '@/lib/upload';
import { usePublicInfo } from '@/lib/usePublicInfo';
import Dropzone from './Dropzone';
import Icon from './Icon';
import PackCard, { MediaThumb } from './PackCard';
import { useApp } from './Providers';

// results of a search do not change within minutes – typing back and forth stays free
const SEARCH_FRESH_MS = 3 * 60_000;

const errText = (t, err, vars) => {
  const key = `err.${err?.code || err?.message || 'network'}`;
  return t(key, vars) === key ? t('err.network') : t(key, vars);
};

function UploadCard({ pack, onUploaded }) {
  const { t } = useApp();
  const info = usePublicInfo(0);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  async function onFile(file) {
    setError('');
    if (!pack) return setError(t('studio.selectPack'));
    if (file.size > info.uploadMaxMb * 1048576) return setError(errText(t, { code: 'file_too_large' }, { n: info.uploadMaxMb }));
    setProgress(0);
    try {
      const d = await uploadFile(`/api/packs/${pack.id}/upload`, file, {}, setProgress);
      // the upload bypasses api(): tell the cache that the pack lists are outdated
      invalidateCache('/api/packs');
      onUploaded(d.pack);
    } catch (err) {
      setError(errText(t, err, { n: info.uploadMaxMb }));
    } finally {
      setProgress(null);
    }
    return undefined;
  }
  return (
    <section className="card studio-upload">
      <h2>
        <Icon name="upload" /> {t('studio.uploadTitle')}
      </h2>
      <Dropzone onFile={onFile} progress={progress} maxMb={info.uploadMaxMb} disabled={!pack} compact />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small with-icon left upload-note">
        <Icon name="shield" size={16} /> {t('studio.uploadNote')}
      </p>
    </section>
  );
}

function ReviewBanner({ pack }) {
  const { t } = useApp();
  if (pack.review === 'pending') {
    return (
      <p className="review-banner is-pending">
        <Icon name="hourglass" size={18} /> {t('studio.reviewPending')}
      </p>
    );
  }
  if (pack.review === 'rejected') {
    return (
      <p className="review-banner is-rejected">
        <Icon name="flag" size={18} /> {t('studio.reviewRejected')}
        {pack.reviewNote ? ` ${t('quote', { s: pack.reviewNote })}` : ''}
      </p>
    );
  }
  if (pack.needsReview) {
    return (
      <p className="review-banner">
        <Icon name="lock" size={18} /> {t('studio.reviewNeeded')}
      </p>
    );
  }
  if (pack.review === 'approved' && pack.uploadCount > 0) {
    return (
      <p className="review-banner is-approved">
        <Icon name="approved" size={18} /> {t('studio.reviewApproved')}
      </p>
    );
  }
  return null;
}

export async function playPack(router, packId) {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game: 'classic', pack: packId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.code) throw new Error(data.error || 'network');
  router.push(`/room/${data.code}`);
}

// The three mascots live in public/images/mascots – to swap them, replace the
// PNG (same name) and run "node scripts/optimize-assets.mjs": it writes the
// small .avif/.webp versions the page really loads (the PNG is the fallback).
// size = how big the picture is drawn, x/y = fine tuning.
const STEPS = [
  { key: 'search', img: '/images/mascots/LoL_Dedetiv-asset', size: 140, x: '-45%', y: '-45%' },
  { key: 'pack', img: '/images/mascots/LoL_Bote-asset', size: 140, x: '-38%', y: '-40%' },
  { key: 'play', img: '/images/mascots/LoL_Spieler-asset', size: 140, x: '-43%', y: '-49%' },
];

function StudioSteps() {
  const { t } = useApp();
  return (
    <ol className="studio-steps">
      {STEPS.map((s, i) => (
        <li key={s.key} style={{ '--art': `${s.size}px`, '--art-x': s.x, '--art-y': s.y }}>
          <span className="studio-step-art">
            <span className="studio-step-img" aria-hidden="true">
              {/* the mascots are decoration – the text below says what happens */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <picture className="media-picture">
                <source type="image/avif" srcSet={`${s.img}.avif`} />
                <source type="image/webp" srcSet={`${s.img}.webp`} />
                <img src={`${s.img}.png`} alt="" width={s.size} height={s.size} draggable="false" decoding="async" />
              </picture>
            </span>
            <span className="studio-step-num" aria-hidden="true">
              {i + 1}
            </span>
          </span>
          <strong>{t(`studio.step${i + 1}`)}</strong>
          <span>{t(`studio.step${i + 1}.text`)}</span>
        </li>
      ))}
    </ol>
  );
}

function SearchPanel({ pack, onAdd, busyId }) {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('any');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const inPack = new Set((pack?.items || []).map((i) => i.id));

  // search-as-you-type: one request once the typing pauses; an emptied box
  // (= browse) answers at once, and a search that was just shown comes from the cache
  const typed = q.trim();
  const term = useDebouncedValue(typed, typed ? 450 : 0);
  const searching = typed !== term;

  useEffect(() => {
    let alive = true;
    const url = `/api/studio/search?kind=${kind}&q=${encodeURIComponent(term.length >= 2 ? term : '')}`;
    setItems(peekCached(url)?.items ?? null);
    setError('');
    cachedGet(url, { ttl: SEARCH_FRESH_MS })
      .then((d) => alive && setItems(d.items))
      .catch((err) => {
        if (!alive) return;
        setItems([]);
        setError(errText(t, err));
      });
    return () => {
      alive = false;
    };
  }, [term, kind, t]);

  return (
    <section className="card studio-search">
      <div className="section-row">
        <h2>
          <Icon name="plus" /> {t('studio.searchTitle')}
        </h2>
        <div className="tabs" role="tablist">
          {['any', 'image', 'video'].map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {t(`studio.kind.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="studio-search-row">
        <Icon name="search" className="search-icon" />
        <input
          className="input"
          value={q}
          maxLength={40}
          placeholder={t('studio.searchPlaceholder')}
          aria-label={t('studio.searchPlaceholder')}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {!q.trim() && <p className="muted small">{t('studio.browseHint')}</p>}
      {!pack && <p className="form-error">{t('studio.selectPack')}</p>}
      {error && <p className="form-error">{error}</p>}
      <div className="media-grid">
        {(items === null || searching) && <div className="spinner" aria-hidden="true" />}
        {items?.length === 0 && !error && !searching && <p className="muted">{t('studio.noResults')}</p>}
        {!searching && items?.map((m) => {
          const added = inPack.has(m.id);
          return (
            <div key={m.id} className={`media-tile ${added ? 'is-added' : ''}`}>
              <MediaThumb media={m} size={160} />
              <span className="media-title" title={m.title}>
                {m.title}
              </span>
              <button
                type="button"
                className="media-add"
                disabled={!pack || added || busyId === m.id}
                aria-label={added ? t('studio.added') : t('studio.add')}
                title={added ? t('studio.added') : t('studio.add')}
                onClick={() => onAdd(m)}
              >
                {busyId === m.id ? <span className="spinner tiny" /> : <Icon name={added ? 'check' : 'plus'} size={20} strokeWidth={3} />}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PackEditor({ pack, onChange, onDelete, onRemove }) {
  const { t } = useApp();
  const router = useRouter();
  const [name, setName] = useState(pack.name);
  const [description, setDescription] = useState(pack.description);
  const wantsPublic = pack.public || pack.review === 'pending';
  const [isPublic, setIsPublic] = useState(wantsPublic);
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setName(pack.name);
    setDescription(pack.description);
    setIsPublic(wantsPublic);
    setError('');
  }, [pack.id, pack.name, pack.description, wantsPublic]);

  const dirty = name !== pack.name || description !== pack.description || isPublic !== wantsPublic;

  async function save(e) {
    e?.preventDefault();
    setState('saving');
    setError('');
    try {
      const d = await api(`/api/packs/${pack.id}`, { method: 'PATCH', body: { name, description, public: isPublic } });
      onChange(d.pack);
      setState('saved');
      setTimeout(() => setState(''), 1500);
    } catch (err) {
      setError(errText(t, err));
      setState('');
    }
  }

  async function play() {
    setState('playing');
    try {
      await playPack(router, pack.id);
    } catch (err) {
      setError(errText(t, err));
      setState('');
    }
  }

  async function copy() {
    const url = `${window.location.origin}/packs/${pack.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="card pack-editor">
      <form className="pack-form" onSubmit={save}>
        <div className="pack-form-fields">
          <label className="label" htmlFor="pack-name">
            {t('studio.packName')}
          </label>
          <input
            id="pack-name"
            className="input"
            value={name}
            maxLength={PACK_LIMITS.name}
            placeholder={t('studio.packNamePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="label" htmlFor="pack-desc">
            {t('studio.description')}
          </label>
          <input
            id="pack-desc"
            className="input"
            value={description}
            maxLength={PACK_LIMITS.description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="visibility" role="radiogroup">
            <button type="button" role="radio" aria-checked={isPublic} className={`chip ${isPublic ? 'on' : ''}`} onClick={() => setIsPublic(true)}>
              <Icon name="globe" size={16} /> {pack.needsReview ? t('studio.publicReview') : t('studio.public')}
            </button>
            <button type="button" role="radio" aria-checked={!isPublic} className={`chip ${!isPublic ? 'on' : ''}`} onClick={() => setIsPublic(false)}>
              <Icon name="lock" size={16} /> {t('studio.private')}
            </button>
          </div>
        </div>
        <div className="pack-form-actions">
          <button type="submit" className="btn btn-yellow" disabled={!dirty || state === 'saving'}>
            <Icon name={state === 'saved' ? 'check' : 'pencil'} size={18} /> {state === 'saved' ? t('studio.saved') : t('studio.save')}
          </button>
          <button type="button" className="btn btn-pink" disabled={!pack.playable || state === 'playing'} onClick={play}>
            <Icon name="play" size={18} /> {t('studio.play')}
          </button>
          <button type="button" className="btn btn-white" onClick={copy} disabled={!pack.public}>
            <Icon name="link" size={18} /> {copied ? t('studio.copied') : t('studio.share')}
          </button>
          <button type="button" className="btn btn-ghost btn-small danger" onClick={() => window.confirm(t('studio.confirmDelete')) && onDelete(pack)}>
            <Icon name="trash" size={16} /> {t('studio.delete')}
          </button>
        </div>
      </form>
      {error && <p className="form-error">{error}</p>}
      <ReviewBanner pack={pack} />

      <h3 className="pack-items-title">{t('studio.items', { n: pack.itemCount, max: PACK_LIMITS.items })}</h3>
      {!pack.playable && <p className="pack-min-hint">{t('studio.minHint', { n: PACK_LIMITS.minItems })}</p>}
      {pack.items?.length ? (
        <div className="media-grid in-pack">
          {pack.items.map((m) => (
            <div key={m.id} className="media-tile">
              <MediaThumb media={m} size={130} />
              <span className="media-title" title={m.title}>
                {m.title}
              </span>
              <button type="button" className="media-remove" aria-label={t('studio.remove')} title={t('studio.remove')} onClick={() => onRemove(m)}>
                <Icon name="x" size={16} strokeWidth={3} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-note">{t('studio.noItems')}</p>
      )}
    </section>
  );
}

function CommunityPacks() {
  const { t } = useApp();
  const packs = useCachedFetch('/api/packs?scope=public&limit=12', { ttl: 60_000 }).data?.items;
  if (!packs?.length) return null;
  return (
    <section className="studio-community">
      <h2 className="section-title">
        <Icon name="users" /> {t('studio.community')}
      </h2>
      <p className="muted-on-dark center-text">{t('studio.communityText')}</p>
      <div className="pack-grid">
        {packs.map((p) => (
          <Link key={p.id} href={`/packs/${p.id}`} className="pack-link">
            <PackCard pack={p} action={<Icon name="arrow-right" />} />
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function StudioPage() {
  const { t, account, accountLoading } = useApp();
  const params = useSearchParams();
  const [packs, setPacks] = useState(null);
  const [current, setCurrent] = useState(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const created = useRef(false);

  const openPack = useCallback(async (id) => {
    try {
      const d = await api(`/api/packs/${id}`);
      setCurrent(d.pack);
    } catch (err) {
      setError(errText(t, err));
    }
  }, [t]);

  const loadPacks = useCallback(async () => {
    const d = await api('/api/packs?scope=mine&limit=60');
    setPacks(d.items);
    return d.items;
  }, []);

  useEffect(() => {
    if (!account) return;
    (async () => {
      try {
        let list = await loadPacks();
        // the first pack is created automatically
        if (!list.length && !created.current) {
          created.current = true;
          await api('/api/packs', { method: 'POST', body: { name: t('studio.firstPack'), public: true } });
          list = await loadPacks();
        }
        const wanted = params.get('pack');
        const pick = list.find((p) => p.id === wanted) || list[0];
        if (pick) openPack(pick.id);
      } catch (err) {
        setError(errText(t, err));
        setPacks([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  const updateCurrent = (pack) => {
    setCurrent(pack);
    setPacks((list) => (list || []).map((p) => (p.id === pack.id ? { ...pack, items: undefined } : p)));
  };

  async function createNew(e) {
    e.preventDefault();
    setError('');
    try {
      const d = await api('/api/packs', { method: 'POST', body: { name: newName, public: true } });
      setNewName('');
      await loadPacks();
      setCurrent(d.pack);
    } catch (err) {
      setError(errText(t, err));
    }
  }

  async function add(m) {
    if (!current) return;
    setBusyId(m.id);
    setError('');
    try {
      const d = await api(`/api/packs/${current.id}/items`, { method: 'POST', body: { id: m.id } });
      updateCurrent(d.pack);
    } catch (err) {
      setError(errText(t, err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(m) {
    try {
      const d = await api(`/api/packs/${current.id}/items/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      updateCurrent(d.pack);
    } catch (err) {
      setError(errText(t, err));
    }
  }

  async function del(pack) {
    try {
      await api(`/api/packs/${pack.id}`, { method: 'DELETE' });
      const list = await loadPacks();
      setCurrent(null);
      if (list[0]) openPack(list[0].id);
    } catch (err) {
      setError(errText(t, err));
    }
  }

  return (
    <div className="page studio-page">
      <header className="studio-hero">
        <h1 className="studio-title">{t('studio.title')}</h1>
        <p className="lead">{t('studio.sub')}</p>
      </header>
      <StudioSteps />

      {accountLoading ? (
        <div className="page-center">
          <div className="spinner" aria-hidden="true" />
        </div>
      ) : !account ? (
        <div className="card studio-login">
          <div className="big-icon">
            <Icon name="lock" size={48} />
          </div>
          <h2>{t('studio.loginTitle')}</h2>
          <p className="muted">{t('studio.loginText')}</p>
          <div className="row-center">
            <Link className="btn btn-yellow" href="/login?next=%2Fstudio">
              <Icon name="log-in" /> {t('nav.login')}
            </Link>
            <Link className="btn btn-white" href="/login?mode=register&next=%2Fstudio">
              <Icon name="user-plus" /> {t('auth.register')}
            </Link>
          </div>
        </div>
      ) : (
        <div className="studio-layout">
          <aside className="card studio-packs">
            <h2>
              <Icon name="layers" /> {t('studio.myPacks')}
            </h2>
            <div className="pack-list">
              {packs === null && <div className="spinner" aria-hidden="true" />}
              {packs?.map((p) => (
                <PackCard key={p.id} pack={p} selected={current?.id === p.id} onClick={() => openPack(p.id)} />
              ))}
            </div>
            {packs && packs.length < PACK_LIMITS.packs && (
              <form className="new-pack" onSubmit={createNew}>
                <input
                  className="input"
                  value={newName}
                  maxLength={PACK_LIMITS.name}
                  placeholder={t('studio.newPack')}
                  aria-label={t('studio.newPack')}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <button type="submit" className="btn btn-cyan" disabled={newName.trim().length < 2}>
                  <Icon name="plus" /> {t('studio.create')}
                </button>
              </form>
            )}
          </aside>
          <div className="studio-main">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {current ? (
              <PackEditor pack={current} onChange={updateCurrent} onDelete={del} onRemove={remove} />
            ) : (
              packs?.length > 0 && <div className="card">{t('studio.selectPack')}</div>
            )}
            <UploadCard pack={current} onUploaded={updateCurrent} />
            <SearchPanel pack={current} onAdd={add} busyId={busyId} />
          </div>
        </div>
      )}
      <CommunityPacks />
    </div>
  );
}
