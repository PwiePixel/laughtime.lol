import { cookies, headers } from 'next/headers';
import Footer from '@/components/Footer';
import Header from '@/components/Header';
import Providers from '@/components/Providers';
import SanctionGate from '@/components/SanctionGate';
import { LANG_COOKIE, normalizeLang, translate } from '@/lib/i18n';
import { memeFont, uiFont } from './fonts';
import './globals.css';
import './community.css';
import './modes.css';

async function getLang() {
  const store = await cookies();
  return normalizeLang(store.get(LANG_COOKIE)?.value);
}

export async function generateMetadata() {
  const lang = await getLang();
  const base = process.env.PUBLIC_URL || 'https://laughtime.lol';
  return {
    metadataBase: new URL(base),
    title: { default: translate(lang, 'meta.title'), template: '%s · laughtime.lol' },
    description: translate(lang, 'meta.description'),
    applicationName: 'LaughTime',
    openGraph: {
      title: translate(lang, 'meta.title'),
      description: translate(lang, 'meta.description'),
      url: base,
      siteName: 'laughtime.lol',
      type: 'website',
      locale: lang === 'de' ? 'de_DE' : 'en_US',
      images: [{ url: '/banner.png', width: 1200, height: 630, alt: translate(lang, 'meta.bannerAlt') }],
    },
    twitter: {
      card: 'summary_large_image',
      title: translate(lang, 'meta.title'),
      description: translate(lang, 'meta.description'),
      images: ['/banner.png'],
    },
  };
}

export const viewport = {
  themeColor: '#1E0B40',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }) {
  const store = await cookies();
  const lang = normalizeLang(store.get(LANG_COOKIE)?.value);

  // GeoTime.lol liegt im selben Build, ist aber eine eigene Seite unter einer
  // eigenen Domain: dort gehören Kopfzeile, Fußzeile und die Konten-Logik von
  // LaughTime nicht hin. Das Kennzeichen setzt der GeoTime-Port (geotime/
  // instances.js); bei jeder normalen LaughTime-Anfrage fehlt es und unten
  // läuft alles unverändert weiter.
  const requestHeaders = await headers();
  if (requestHeaders.get('x-geotime-instance')) {
    // GeoTime hat ein eigenes Sprach-Cookie (gt_lang), Standard ist Englisch
    const geoLang = store.get('gt_lang')?.value === 'de' ? 'de' : 'en';
    return (
      <html lang={geoLang} className={`${uiFont.variable} ${memeFont.variable}`}>
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang={lang} className={`${uiFont.variable} ${memeFont.variable}`}>
      <body>
        <Providers lang={lang} memeFontFamily={memeFont.style.fontFamily}>
          <div className="bg-dots" aria-hidden="true" />
          <Header />
          <main className="main">
            <SanctionGate>{children}</SanctionGate>
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
