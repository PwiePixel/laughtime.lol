'use client';

import Link from 'next/link';
import { pick, splitTitle } from '@/lib/news';
import Icon from '../Icon';
import { useApp } from '../Providers';
import NewsMeta from './NewsMeta';

/**
 * One news entry in full: hero, highlight cards and the changelog sections.
 * `single` is the entry's own page (/news/<id>) – it links back to the overview.
 */
export default function NewsArticle({ entry, single = false }) {
  const { t, lang } = useApp();
  const [head, tail] = splitTitle(pick(entry.title, lang));
  const titleId = `news-title-${entry.id}`;
  const highlights = entry.highlights || [];
  const sections = entry.sections || [];

  return (
    <article className="news-article" aria-labelledby={titleId}>
      <header className="news-hero" id={entry.id}>
        <span className="news-hero-shine" aria-hidden="true" />
        <p className="news-kicker">
          <Icon name="sparkles" size={18} /> {t('news.kicker')}
        </p>
        <h1 className="news-title" id={titleId}>
          <span>{head}</span>
          {tail && <span className="hl">{tail}</span>}
        </h1>
        <NewsMeta entry={entry} />
        <p className="news-summary">{pick(entry.summary, lang)}</p>
        <div className="news-actions">
          <Link href="/" className="btn btn-yellow btn-big">
            <Icon name="play" size={22} /> {t('news.play')}
          </Link>
          {single && (
            <Link href="/news" className="btn btn-white">
              <Icon name="arrow-left" size={18} /> {t('news.all')}
            </Link>
          )}
        </div>
      </header>

      {highlights.length > 0 && (
        <section className="news-block" aria-labelledby={`${titleId}-highlights`}>
          <h2 className="news-h2" id={`${titleId}-highlights`}>
            {t('news.highlights')}
          </h2>
          <ul className="news-highlights">
            {highlights.map((h, i) => (
              <li key={h.icon + i} className="card news-highlight" style={{ '--i': i }}>
                <span className="news-highlight-icon" aria-hidden="true">
                  <Icon name={h.icon} size={26} />
                </span>
                <h3>{pick(h.title, lang)}</h3>
                <p>{pick(h.text, lang)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.length > 0 && (
        <section className="news-block" aria-labelledby={`${titleId}-changelog`}>
          <h2 className="news-h2" id={`${titleId}-changelog`}>
            {t('news.changelog')}
          </h2>
          <div className="news-sections">
            {sections.map((s, i) => (
              <section key={i} className="news-section" style={{ '--i': i }}>
                <h3>
                  <span className="news-section-icon" aria-hidden="true">
                    <Icon name={s.icon || 'check'} size={18} />
                  </span>
                  {pick(s.title, lang)}
                </h3>
                <ul>
                  {s.items.map((item, n) => (
                    <li key={n}>
                      {pick(item, lang)}
                      {item.link && (
                        <>
                          {' '}
                          <Link href={item.link.href} className="news-item-link">
                            {pick(item.link, lang)} <Icon name="arrow-right" size={14} />
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
