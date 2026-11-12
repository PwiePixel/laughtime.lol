'use client';

// Remembers which news entry this visitor has already opened – drives the
// "new" dot on the News link in the navigation.
import { useEffect, useState } from 'react';

const SEEN_KEY = 'lt_news_seen';
const SEEN_EVENT = 'lt:news-seen';

/** id of the entry that was opened last; undefined when storage is blocked */
function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return undefined;
  }
}

/** called by the news pages once the newest entry is on screen */
export function markNewsSeen(id) {
  if (!id || typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(SEEN_KEY) !== id) localStorage.setItem(SEEN_KEY, id);
  } catch {
    /* storage blocked – nothing to remember */
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

/**
 * true while the newest entry has not been opened yet. Always false on the
 * server and during hydration (the answer lives in localStorage), and false
 * when storage is blocked – a dot that never goes away would only nag.
 */
export function useNewsUnread() {
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let alive = true;
    let latestId = null;
    const check = () => {
      if (!alive || !latestId) return;
      const seen = readSeen();
      setUnread(seen !== undefined && seen !== latestId);
    };
    // the header is part of every page, the changelog is not: load the entries on demand
    import('@/lib/news')
      .then((news) => {
        latestId = news.latest()?.id || null;
        check();
      })
      .catch(() => {});
    window.addEventListener(SEEN_EVENT, check);
    // another tab opened the news
    window.addEventListener('storage', check);
    return () => {
      alive = false;
      window.removeEventListener(SEEN_EVENT, check);
      window.removeEventListener('storage', check);
    };
  }, []);

  return unread;
}
