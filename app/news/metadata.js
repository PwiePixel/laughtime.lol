// Metadata of the news pages (title, description, Open Graph) in the visitor's language.
import { cookies } from 'next/headers';
import { LANG_COOKIE, normalizeLang, translate } from '@/lib/i18n';
import { latest, pick } from '@/lib/news';

/** `entry` set: the page of that entry; otherwise the overview with the newest entry as preview */
export async function newsMetadata(entry = null) {
  const store = await cookies();
  const lang = normalizeLang(store.get(LANG_COOKIE)?.value);
  const preview = entry || latest();
  const path = entry ? `/news/${entry.id}` : '/news';
  const title = entry ? pick(entry.title, lang) : translate(lang, 'news.metaTitle');
  const description = entry ? pick(entry.summary, lang) : translate(lang, 'news.metaDescription');
  // shared links show the newest entry, not a generic line
  const shareTitle = preview ? pick(preview.title, lang) : title;
  const shareText = preview ? pick(preview.summary, lang) : description;
  const banner = { url: '/banner.png', width: 1200, height: 630, alt: translate(lang, 'meta.bannerAlt') };
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: shareTitle,
      description: shareText,
      url: path,
      siteName: 'laughtime.lol',
      type: entry ? 'article' : 'website',
      locale: lang === 'de' ? 'de_DE' : 'en_US',
      images: [banner],
      ...(entry ? { publishedTime: `${entry.date}T00:00:00.000Z` } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description: shareText,
      images: [banner.url],
    },
  };
}
