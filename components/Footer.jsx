'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { OPERATOR } from '@/lib/operator';
import { useApp } from './Providers';

const SOURCES = {
  imgflip: { label: 'Imgflip', url: 'https://imgflip.com' },
  giphy: { label: 'Powered by GIPHY', url: 'https://giphy.com' },
  klipy: { label: 'Powered by KLIPY', url: 'https://klipy.com' },
  reddit: { label: 'Reddit', url: 'https://www.reddit.com' },
};

export default function Footer() {
  const { t } = useApp();
  const [sources, setSources] = useState([]);

  useEffect(() => {
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d) => setSources((d.sources || []).filter((s) => SOURCES[s])))
      .catch(() => {});
  }, []);

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
