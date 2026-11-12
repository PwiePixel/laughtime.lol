'use client';

import { useApp } from '../Providers';
import { useNewsUnread } from './newsSeen';

/** Small "new" dot behind the News link until the newest entry has been opened. */
export default function NewsDot() {
  const { t } = useApp();
  const unread = useNewsUnread();
  if (!unread) return null;
  return (
    <span className="news-dot">
      <span className="sr-only">{t('news.unread')}</span>
    </span>
  );
}
