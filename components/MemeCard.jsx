'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, timeAgo } from '@/lib/api';
import { frameSlotWidth, preloadMedia, responsiveImage } from '@/lib/media';
import Avatar from './Avatar';
import Icon from './Icon';
import MemeCanvas from './MemeCanvas';
import { ReportButton, reportHttp } from './ReportDialog';
import useReport from './useReport';
import { useApp } from './Providers';

export function LikeButton({ meme, onChange }) {
  const { t, account } = useApp();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const disabled = busy || meme.mine;
  async function toggle() {
    if (!account) {
      setHint(t('memes.loginToLike'));
      setTimeout(() => setHint(''), 2500);
      return;
    }
    setBusy(true);
    try {
      const res = await api(`/api/memes/${meme.id}/like`, { method: 'POST', body: {} });
      onChange?.({ ...meme, liked: res.liked, likes: res.likes });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="like-wrap">
      <button
        type="button"
        className={`like-btn ${meme.liked ? 'on' : ''}`}
        aria-pressed={meme.liked}
        aria-label={meme.liked ? t('memes.unlike') : t('memes.like')}
        title={meme.mine ? t('memes.ownMeme') : undefined}
        disabled={disabled}
        onClick={toggle}
      >
        <Icon name="heart" size={18} fill={meme.liked ? 'currentColor' : 'none'} />
        <span>{meme.likes}</span>
      </button>
      {hint && (
        <span className="like-hint" role="status">
          {hint} <Link href="/login">{t('nav.login')}</Link>
        </span>
      )}
    </span>
  );
}

// height limit of the meme page (components/MemePage.jsx): what is preloaded here is exactly what is shown there
export const DETAIL_MAX_HEIGHT = 'min(70vh, 720px)';

/** Fetches the big version of a meme, so its own page opens without waiting (pointer or finger on the link). */
function warmDetail(media) {
  if (!media?.src) return;
  if (media.kind === 'video') {
    preloadMedia(media.src, { kind: 'video' });
    return;
  }
  const ratio = media.width && media.height ? media.width / media.height : 1;
  const { srcSet, sizes } = responsiveImage(media.src, { width: frameSlotWidth(DETAIL_MAX_HEIGHT, ratio), intrinsicWidth: media.width });
  preloadMedia(media.src, { srcSet, sizes });
}

/**
 * A meme in a grid. Cards load lazily; `priority` marks the first ones of a
 * page, which are on screen right away.
 */
export default function MemeCard({ meme, rank, onChange, onDelete, showAuthor = true, priority = false }) {
  const { t, lang } = useApp();
  const [gone, setGone] = useState(false);
  const [openReport, reportDialog] = useReport();
  if (gone) return null;
  const warm = () => warmDetail(meme.media);
  return (
    <article className="card meme-card">
      {rank && <span className={`rank-badge rank-${Math.min(rank, 4)}`}>#{rank}</span>}
      {meme.private && meme.mine && (
        <span className="private-badge" title={t('memes.privateHint')}>
          <Icon name="eye-off" size={14} /> {t('memes.private')}
        </span>
      )}
      <div className="meme-card-media">
        <MemeCanvas media={meme.media} captions={meme.captions} maxHeight="300px" onFail={() => setGone(true)} downloadable lazy={!priority} />
      </div>
      <div className="meme-card-meta">
        {showAuthor && meme.author && (
          <Link href={`/u/${meme.author.username}`} className="meme-author">
            <Avatar value={meme.author.avatar} size={30} />
            <span>{meme.author.displayName}</span>
          </Link>
        )}
        <LikeButton meme={meme} onChange={onChange} />
      </div>
      <div className="meme-card-foot muted small">
        <Link href={`/m/${meme.id}`} className="meme-open" title={new Date(meme.createdAt).toLocaleString(lang)} onPointerEnter={warm} onFocus={warm} onTouchStart={warm}>
          <Icon name="share" size={14} /> {timeAgo(meme.createdAt, lang)}
        </Link>
        <span>
          {t('memes.score', { avg: meme.avg, votes: meme.votes })}
        </span>
        {!meme.mine && (
          <ReportButton label={t('report.thisMeme')} onClick={() => openReport({ kind: 'meme', name: meme.author?.displayName, avatar: meme.author?.avatar }, reportHttp({ memeId: meme.id }))} />
        )}
        {meme.canDelete && onDelete && (
          <button type="button" className="link-btn danger" onClick={() => onDelete(meme)}>
            <Icon name="trash" size={14} /> {t('memes.delete')}
          </button>
        )}
      </div>
      {reportDialog}
    </article>
  );
}
