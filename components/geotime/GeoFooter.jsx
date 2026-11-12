'use client';

/**
 * Fußzeile von GeoTime – dieselbe Machart wie bei LaughTime (.footer), nur mit
 * der eigenen Plattform und dem eigenen Impressum. Dazu die Nachweise für die
 * kostenlosen Karten- und Bilddienste.
 */
import Link from 'next/link';
import { GEO_OPERATOR } from '@/lib/geotime/operator';
import { useGeo } from './GeoProviders';

/**
 * Nachweise für die kostenlosen Dienste. Sie stehen hier und im Impressum,
 * damit sie nicht als Kasten über der Karte liegen müssen.
 */
const CREDITS = [
  { name: 'Panoramax', url: 'https://panoramax.fr' },
  { name: 'Mapillary', url: 'https://www.mapillary.com' },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright' },
  { name: 'OpenFreeMap', url: 'https://openfreemap.org' },
  { name: 'Esri', url: 'https://www.esri.com' },
];

export default function GeoFooter() {
  const { t } = useGeo();
  return (
    <footer className="footer">
      <span>
        © {new Date().getFullYear()} {GEO_OPERATOR.platform}
      </span>
      <span className="footer-media">
        {t('footer.media')}{' '}
        {CREDITS.map((c, i) => (
          <span key={c.name}>
            {i > 0 && ' · '}
            <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">
              {c.name}
            </a>
          </span>
        ))}
      </span>
      <Link href="/legal">{t('nav.legal')}</Link>
    </footer>
  );
}
