import { cookies } from 'next/headers';
import GeoFooter from '@/components/geotime/GeoFooter';
import GeoHeader from '@/components/geotime/GeoHeader';
import GeoProviders from '@/components/geotime/GeoProviders';
import { LANG_COOKIE, normalizeLang } from '@/lib/geotime/i18n';
import './theme.css';

/**
 * GeoTime.lol – eigener Bereich im gemeinsamen Next.js-Build.
 *
 * Nach außen ist das eine eigene Website unter einer eigenen Domain: intern
 * liegen die Seiten unter /geotime, erreichbar sind sie nur über die
 * GeoTime-Ports (siehe proxy.js und geotime/instances.js). Der Browser sieht
 * immer nur geotime.lol/… – nie laughtime.lol/geotime.
 *
 * Das Aussehen ist 1:1 das von LaughTime: dieselbe Hülle (.bg-dots, .main,
 * .footer) und dieselben Klassen aus app/globals.css. theme.css ergänzt nur,
 * was es bei LaughTime nicht gibt – Bingo-Feld, Karte, Straßenansicht.
 *
 * Icon, Apple-Icon und OG-Bild kommen aus geotime/assets/ und werden vom
 * GeoTime-Port selbst ausgeliefert. So hängt nie ein LaughTime-Logo an
 * geotime.lol – und laughtime.lol bleibt komplett unberührt.
 */
const BASE = (process.env.GEOTIME_PUBLIC_URL || 'https://geotime.lol').replace(/\/$/, '');
const INDEXABLE = process.env.GEOTIME_NOINDEX !== 'true' && process.env.GEOTIME_NOINDEX !== '1';
const TITLE = 'GeoTime.lol – Street View Bingo';
const DESCRIPTION = 'Find the things in Street View before the other team does.';

export const metadata = {
  metadataBase: new URL(BASE),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  applicationName: 'GeoTime',
  alternates: { canonical: '/' },
  robots: INDEXABLE ? { index: true, follow: true } : { index: false, follow: false },
  // eigene Icons (aus geotime/assets/) statt der geerbten von LaughTime
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: [{ url: '/favicon.ico' }],
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'geotime.lol',
    url: BASE,
    type: 'website',
    images: [{ url: '/opengraph-image.png', width: 1200, height: 630, alt: TITLE }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/opengraph-image.png'] },
};

export default async function GeotimeLayout({ children }) {
  const store = await cookies();
  const lang = normalizeLang(store.get(LANG_COOKIE)?.value);
  return (
    <GeoProviders lang={lang}>
      <div className="bg-dots" aria-hidden="true" />
      <GeoHeader />
      <main className="main geotime">{children}</main>
      <GeoFooter />
    </GeoProviders>
  );
}
