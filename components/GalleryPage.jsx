'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cachedGet, peekCached } from '@/lib/fetchCache';
import { useDebouncedValue } from '@/lib/timing';
import Icon from './Icon';
import MemeCard from './MemeCard';
import { useApp } from './Providers';

const PERIODS = ['week', 'month', 'all'];
// a list that was just shown is still good when the visitor flips back to it
const LIST_FRESH_MS = 30_000;
// the first pictures are above the fold on every screen: they load first
const EAGER_CARDS = 2;

export default function GalleryPage({ user: userProp }) {
  const { t } = useApp();
  const params = useSearchParams();
  // the Discord Activity passes the filter directly (its URL belongs to Discord)
  const user = userProp !== undefined ? userProp : params.get('user');
  const [sort, setSort] = useState('top');
  const [period, setPeriod] = useState(user ? 'all' : 'week');
  const [items, setItems] = useState(null);
  const [nextOffset, setNextOffset] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const query = useCallback(
    (offset) =>
      `/api/memes?sort=${sort}&period=${sort === 'new' ? 'all' : period}&limit=24&offset=${offset}${
        user ? `&user=${encodeURIComponent(user)}` : ''
      }`,
    [sort, period, user],
  );

  // clicking through the filters quickly: the first click loads at once, of the
  // rest only the last one reaches the server
  const firstPage = useDebouncedValue(query(0), 220, { leading: true });

  useEffect(() => {
    let alive = true;
    const show = (d) => {
      setItems(d.items);
      setNextOffset(d.nextOffset);
    };
    // a list seen a moment ago is painted right away, without a spinner in between
    const known = peekCached(firstPage);
    if (known) show(known);
    else setItems(null);
    cachedGet(firstPage, { ttl: LIST_FRESH_MS })
      .then((d) => alive && show(d))
      .catch(() => alive && setItems((list) => list || []));
    return () => {
      alive = false;
    };
  }, [firstPage]);

  // the list on screen still belongs to the previous filter for a moment
  const settling = firstPage !== query(0);

  async function loadMore() {
    if (nextOffset === null || settling) return;
    setLoadingMore(true);
    try {
      const d = await api(query(nextOffset));
      setItems((list) => [...list, ...d.items.filter((m) => !list.some((x) => x.id === m.id))]);
      setNextOffset(d.nextOffset);
    } finally {
      setLoadingMore(false);
    }
  }

  const update = (m) => setItems((list) => list.map((x) => (x.id === m.id ? m : x)));
  const remove = async (m) => {
    if (!window.confirm(t('memes.confirmDelete'))) return;
    await api(`/api/memes/${m.id}`, { method: 'DELETE' }).catch(() => {});
    setItems((list) => list.filter((x) => x.id !== m.id));
  };

  return (
    <div className="page-wide gallery-page">
      <div className="page-head">
        <div>
          <h1>{user ? t('memes.byUser', { name: user }) : t('memes.title')}</h1>
          <p className="muted">{t('memes.sub')}</p>
        </div>
        {user && (
          <Link className="btn btn-small btn-white" href={`/u/${encodeURIComponent(user)}`}>
            <Icon name="arrow-left" size={16} /> {t('memes.backToProfile')}
          </Link>
        )}
      </div>

      <div className="filter-bar">
        <div className="tabs" role="tablist">
          {['top', 'new'].map((s) => (
            <button key={s} type="button" role="tab" aria-selected={sort === s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
              <Icon name={s === 'top' ? 'flame' : 'clock'} size={18} />
              {t(`memes.sort.${s}`)}
            </button>
          ))}
        </div>
        {sort === 'top' && (
          <div className="chips" role="radiogroup" aria-label={t('lb.period')}>
            {PERIODS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={period === p} className={`chip ${period === p ? 'on' : ''}`} onClick={() => setPeriod(p)}>
                {t(`period.${p}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {items === null ? (
        <div className="page-center">
          <div className="spinner" aria-hidden="true" />
        </div>
      ) : items.length === 0 ? (
        <div className="card center empty-card">
          <div className="big-icon">
            <Icon name="images" size={52} />
          </div>
          <p className="lead">{t('memes.empty')}</p>
          <p className="muted">{t('memes.howToGetIn')}</p>
          <Link className="btn btn-yellow" href="/">
            <Icon name="play" /> {t('nav.play')}
          </Link>
        </div>
      ) : (
        <>
          <div className="meme-grid">
            {items.map((m, i) => (
              <MemeCard key={m.id} meme={m} rank={sort === 'top' && !user && i < 3 ? i + 1 : null} onChange={update} onDelete={remove} priority={i < EAGER_CARDS} />
            ))}
          </div>
          {nextOffset !== null && (
            <p className="center-text">
              <button type="button" className="btn btn-white" onClick={loadMore} disabled={loadingMore || settling}>
                {loadingMore ? t('common.loading') : t('memes.more')}
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
