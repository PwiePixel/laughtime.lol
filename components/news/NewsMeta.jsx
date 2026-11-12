'use client';

import { APP_VERSION } from '@/lib/version';
import { formatNewsDate } from '@/lib/news';
import Icon from '../Icon';
import { useApp } from '../Providers';

/** Tag chip, date and version of one news entry. */
export default function NewsMeta({ entry }) {
  const { t, lang } = useApp();
  // the release that is running right now gets a "live" marker
  const live = entry.tag === 'release' && entry.version === APP_VERSION;
  return (
    <div className="news-meta">
      <span className={`news-tag tag-${entry.tag}`}>{t(`news.tag.${entry.tag}`)}</span>
      {live && (
        <span className="news-live">
          <span className="news-live-dot" aria-hidden="true" />
          {t('news.current')}
        </span>
      )}
      <time className="news-date" dateTime={entry.date}>
        <Icon name="calendar" size={16} /> {formatNewsDate(entry.date, lang)}
      </time>
      {entry.version && <span className="news-version">{t('news.version', { v: entry.version })}</span>}
    </div>
  );
}
