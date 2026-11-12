'use client';

import Link from 'next/link';
import { useActivity } from './ActivityContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { cachedGet, peekCached } from '@/lib/fetchCache';
import Avatar from './Avatar';
import Icon from './Icon';
import { DETAIL_MAX_HEIGHT, LikeButton } from './MemeCard';
import { reportHttp } from './ReportDialog';
import useReport from './useReport';
import MemeCanvas from './MemeCanvas';
import { useApp } from './Providers';

export default function MemePage({ id }) {
  const { t, lang } = useApp();
  const router = useRouter();
  const activity = useActivity();
  const url = `/api/memes/${encodeURIComponent(id)}`;
  // opened a moment ago (back/forward): there at once
  const [meme, setMeme] = useState(() => peekCached(url)?.meme ?? null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [openReport, reportDialog] = useReport();

  useEffect(() => {
    let alive = true;
    cachedGet(url, { ttl: 30_000 })
      .then((d) => alive && setMeme(d.meme))
      .catch((err) => alive && setError(err.code || 'network'));
    return () => {
      alive = false;
    };
  }, [url]);

  if (error) {
    return (
      <div className="page-narrow center">
        <div className="card">
          <div className="big-icon">
            <Icon name="search-x" size={56} />
          </div>
          <p className="lead">{t('memes.notFound')}</p>
          <Link className="btn btn-yellow" href="/memes">
            {t('nav.memes')}
          </Link>
        </div>
      </div>
    );
  }
  if (!meme) return <div className="page-center page-loading">{t('common.loading')}</div>;

  async function share() {
    const url = activity ? `${activity.publicUrl}/m/${meme.id}` : window.location.href;
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'laughtime.lol', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* cancelled */
    }
  }

  async function remove() {
    if (!window.confirm(t('memes.confirmDelete'))) return;
    await api(`/api/memes/${meme.id}`, { method: 'DELETE' }).catch(() => {});
    if (activity) activity.navigate('/memes');
    else router.replace('/memes');
  }

  return (
    <div className="page-wide meme-page">
      <Link href="/memes" className="back-link">
        <Icon name="arrow-left" size={18} /> {t('nav.memes')}
      </Link>
      <div className="meme-detail">
        <div className="meme-detail-media">
          <MemeCanvas media={meme.media} captions={meme.captions} maxHeight={DETAIL_MAX_HEIGHT} downloadable priority />
        </div>
        <aside className="card meme-detail-side">
          <Link href={`/u/${meme.author.username}`} className="meme-author big">
            <Avatar value={meme.author.avatar} size={52} />
            <span>
              <strong>{meme.author.displayName}</strong>
              <small className="muted">@{meme.author.username}</small>
            </span>
          </Link>
          <div className="detail-stats">
            <span>
              <Icon name="trophy" size={18} /> {t('memes.roundWinner')}
            </span>
            <span>
              <Icon name="star" size={18} /> {t('memes.score', { avg: meme.avg, votes: meme.votes })}
            </span>
            <span>
              <Icon name="users" size={18} /> {t('memes.players', { n: meme.players })}
            </span>
            <span title={new Date(meme.createdAt).toLocaleString(lang)}>
              <Icon name="calendar" size={18} /> {timeAgo(meme.createdAt, lang)}
            </span>
          </div>
          <div className="row-gap">
            <LikeButton meme={meme} onChange={setMeme} />
            {!meme.mine && (
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => openReport({ kind: 'meme', name: meme.author?.displayName, avatar: meme.author?.avatar }, reportHttp({ memeId: meme.id }))}
              >
                <Icon name="flag" size={16} /> {t('report.thisMeme')}
              </button>
            )}
            <button type="button" className="btn btn-small btn-white" onClick={share}>
              <Icon name="share" size={16} /> {copied ? t('lobby.copied') : t('memes.share')}
            </button>
          </div>
          {meme.canDelete && (
            <button type="button" className="link-btn danger" onClick={remove}>
              <Icon name="trash" size={14} /> {t('memes.delete')}
            </button>
          )}
          <Link className="btn btn-yellow btn-block" href="/">
            <Icon name="play" /> {t('memes.playToo')}
          </Link>
        </aside>
      </div>
      {reportDialog}
    </div>
  );
}
