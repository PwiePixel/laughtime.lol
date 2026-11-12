import { cookies } from 'next/headers';
import { LANG_COOKIE, normalizeLang, translate } from '@/lib/i18n';

// Link previews for invite links: "LaughTime – party room invite" (no room code in title/description)
export async function roomMetadata(path) {
  const store = await cookies();
  const lang = normalizeLang(store.get(LANG_COOKIE)?.value);
  const title = translate(lang, 'meta.inviteTitle');
  const description = translate(lang, 'meta.inviteDescription');
  const base = process.env.PUBLIC_URL || 'https://laughtime.lol';
  const images = [{ url: '/banner.png', width: 1200, height: 630, alt: translate(lang, 'meta.bannerAlt') }];
  return {
    title: { absolute: title },
    description,
    robots: { index: false },
    openGraph: {
      title,
      description,
      url: `${base.replace(/\/$/, '')}${path}`,
      siteName: 'laughtime.lol',
      type: 'website',
      locale: lang === 'de' ? 'de_DE' : 'en_US',
      images,
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/banner.png'] },
  };
}
