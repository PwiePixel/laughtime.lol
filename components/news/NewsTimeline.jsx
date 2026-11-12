'use client';

import Link from 'next/link';
import { pick } from '@/lib/news';
import Icon from '../Icon';
import { useApp } from '../Providers';
import NewsMeta from './NewsMeta';

/** Older entries as a timeline; every item links to its own page. */
export default function NewsTimeline({ entries }) {
  const { t, lang } = useApp();
  if (!entries?.length) return null;
  return (
    <section className="news-block news-older" aria-labelledby="news-older-title">
      <h2 className="news-h2" id="news-older-title">
        {t('news.older')}
      </h2>
      <ol className="news-timeline">
        {entries.map((entry) => (
          <li key={entry.id} id={entry.id} className={`news-timeline-item tag-${entry.tag}`}>
            <span className="news-timeline-dot" aria-hidden="true" />
            <div className="card news-timeline-card">
              <NewsMeta entry={entry} />
              <h3>
                <Link href={`/news/${entry.id}`}>{pick(entry.title, lang)}</Link>
              </h3>
              <p>{pick(entry.summary, lang)}</p>
              {entry.highlights?.length > 0 && (
                <ul className="news-chips">
                  {entry.highlights.slice(0, 4).map((h, i) => (
                    <li key={h.icon + i} className="news-chip">
                      <Icon name={h.icon} size={15} /> {pick(h.title, lang)}
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/news/${entry.id}`} className="more-link" aria-label={`${t('news.readMore')}: ${pick(entry.title, lang)}`}>
                {t('news.readMore')} <Icon name="arrow-right" size={16} />
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
