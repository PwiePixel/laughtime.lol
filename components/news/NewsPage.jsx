'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { byId, latest, older } from '@/lib/news';
import Icon from '../Icon';
import { useApp } from '../Providers';
import NewsArticle from './NewsArticle';
import NewsTimeline from './NewsTimeline';
import { markNewsSeen } from './newsSeen';

/**
 * The news area. Without `id` it is the overview (/news): the newest entry in
 * full, everything older as a timeline. With `id` it shows that one entry.
 */
export default function NewsPage({ id = null }) {
  const { t } = useApp();
  const newest = latest();
  const entry = id ? byId(id) : newest;
  const isNewest = Boolean(entry) && entry.id === newest?.id;

  // opening the newest entry clears the "new" dot in the navigation
  useEffect(() => {
    if (isNewest) markNewsSeen(entry.id);
  }, [isNewest, entry?.id]);

  if (!entry) {
    return (
      <div className="news-page page-center">
        <span className="big-icon">
          <Icon name="sparkles" size={44} />
        </span>
        <h1>{t('news.metaTitle')}</h1>
        <p className="muted">{t('news.empty')}</p>
        <Link href="/" className="btn btn-yellow">
          <Icon name="play" size={18} /> {t('news.play')}
        </Link>
      </div>
    );
  }

  return (
    <div className="news-page">
      <NewsArticle entry={entry} single={Boolean(id)} />
      {!id && <NewsTimeline entries={older()} />}
    </div>
  );
}
