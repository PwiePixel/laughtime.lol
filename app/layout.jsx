import { cookies, headers } from 'next/headers';
import Footer from '@/components/Footer';
import Header from '@/components/Header';
import Providers from '@/components/Providers';
import SanctionGate from '@/components/SanctionGate';
import PwaBoot from '@/components/v2/PwaBoot';
import { BETA_COOKIE, betaEnabledFromEnv, betaHostsFromEnv, resolveChannel } from '@/lib/features';
import { LANG_COOKIE, normalizeLang, translate } from '@/lib/i18n';
import { memeFont, uiFont } from './fonts';
import './globals.css';
import './community.css';
import './modes.css';
import './v2.css';
import './modes-v2.css';
import './news.css';
import './pwa.css';
import './beta.css';
import './activity.css';
import './media.css';

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
    // installable web app (public/manifest.json, worker: public/sw.js)
    manifest: '/manifest.json',
    appleWebApp: { capable: true, title: 'LaughTime', statusBarStyle: 'black-translucent' },
    formatDetection: { telephone: false },
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
  // use the whole screen of phones with a notch (app/pwa.css keeps content out of it)
  viewportFit: 'cover',
};

export default async function RootLayout({ children }) {
  const store = await cookies();
  const lang = normalizeLang(store.get(LANG_COOKIE)?.value);
  // main page and beta page are the same app: the channel only switches features on
  const requestHeaders = await headers();
  const channel = resolveChannel({
    host: requestHeaders.get('x-forwarded-host') || requestHeaders.get('host') || '',
    optedIn: store.get(BETA_COOKIE)?.value === '1',
    betaHosts: betaHostsFromEnv(process.env),
    enabled: betaEnabledFromEnv(process.env),
  });

  return (
    <html lang={lang} className={`${uiFont.variable} ${memeFont.variable}`}>
      <body>
        <Providers lang={lang} channel={channel} memeFontFamily={memeFont.style.fontFamily}>
          <div className="bg-dots" aria-hidden="true" />
          <Header />
          <main className="main">
            <SanctionGate>{children}</SanctionGate>
          </main>
          <Footer />
          <PwaBoot />
        </Providers>
      </body>
    </html>
  );
}
