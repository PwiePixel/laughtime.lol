'use client';

import Link from 'next/link';
import { latest, pick } from '@/lib/news';
import Icon from '../Icon';
import { useApp } from '../Providers';

/** "What's new" teaser on the start page (links to /news). */
export default function NewsTeaser() {
  const { t, lang, activityMode } = useApp();
  const entry = latest();
  // the Discord Activity has no news area
  if (activityMode || !entry) return null;
  const chips = (entry.highlights || []).slice(0, 4);
  return (
    <section className="news-teaser" aria-labelledby="news-teaser-title">
      <div className="news-teaser-head">
        <span className="news-teaser-badge">{t('news.new')}</span>
        <h2 className="news-teaser-title" id="news-teaser-title">
          {pick(entry.teaser || entry.title, lang)}
        </h2>
      </div>
      {chips.length > 0 && (
        <ul className="news-chips news-teaser-chips">
          {chips.map((h, i) => (
            <li key={h.icon + i} className="news-chip">
              <Icon name={h.icon} size={15} /> {pick(h.title, lang)}
            </li>
          ))}
        </ul>
      )}
      <Link href="/news" className="btn btn-yellow news-teaser-cta">
        {t('news.teaser.cta')} <Icon name="arrow-right" size={18} />
      </Link>
    </section>
  );
}
