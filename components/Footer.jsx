'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useCachedFetch } from '@/lib/fetchCache';
import { OPERATOR } from '@/lib/operator';
import { useApp } from './Providers';

const SOURCES = {
  imgflip: { label: 'Imgflip', url: 'https://imgflip.com' },
  giphy: { label: 'Powered by GIPHY', url: 'https://giphy.com' },
  klipy: { label: 'Powered by KLIPY', url: 'https://klipy.com' },
  reddit: { label: 'Reddit', url: 'https://www.reddit.com' },
};

// which sources are switched on changes with the server settings only
const SOURCES_FRESH_MS = 5 * 60_000;

export default function Footer() {
  const { t } = useApp();
  // the start page asks for the same list: both share one request
  const { data } = useCachedFetch('/api/sources', { ttl: SOURCES_FRESH_MS });
  const sources = useMemo(() => (data?.sources || []).filter((s) => SOURCES[s]), [data]);

  return (
    <footer className="footer">
      <span>
        © {new Date().getFullYear()} {OPERATOR.platform}
      </span>
      {sources.length > 0 && (
        <span className="footer-media">
          {t('footer.media')}{' '}
          {sources.map((s, i) => (
            <span key={s}>
              {i > 0 && ' · '}
              <a href={SOURCES[s].url} target="_blank" rel="noopener noreferrer nofollow">
                {SOURCES[s].label}
              </a>
            </span>
          ))}
        </span>
      )}
      <Link href="/news">{t('nav.news')}</Link>
      <Link href="/legal">{t('nav.legal')}</Link>
    </footer>
  );
}
