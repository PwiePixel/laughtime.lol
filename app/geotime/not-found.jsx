import { cookies } from 'next/headers';
import Link from 'next/link';
import { LANG_COOKIE, normalizeLang, translate } from '@/lib/geotime/i18n';

/**
 * Eigene 404-Seite von GeoTime. Bewusst ohne die Bausteine von LaughTime
 * (kein Header, kein Konten-Kontext) – das hier ist eine eigene Website.
 */
export const metadata = {
  title: { absolute: 'GeoTime.lol – 404' },
  robots: { index: false, follow: false },
};

const TEXT = {
  de: { lead: 'Diese Adresse gibt es auf GeoTime nicht.', back: 'Zur Startseite' },
  en: { lead: 'This address does not exist on GeoTime.', back: 'Back to the start' },
};

export default async function GeotimeNotFound() {
  const store = await cookies();
  const lang = normalizeLang(store.get(LANG_COOKIE)?.value);
  const text = TEXT[lang] || TEXT.en;
  return (
    <div className="geo-stack">
      <h1>404</h1>
      <p className="muted">{text.lead}</p>
      <p style={{ margin: 0 }}>
        <Link href="/" className="btn btn-big btn-yellow">
          {text.back}
        </Link>
      </p>
    </div>
  );
}
