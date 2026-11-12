import { cookies } from 'next/headers';
import { LANG_COOKIE, normalizeLang } from '@/lib/geotime/i18n';
import { LEGAL } from '@/lib/geotime/legal';
import { GEO_OPERATOR } from '@/lib/geotime/operator';

/**
 * Impressum von GeoTime – gleicher Aufbau und dieselben Bausteine wie bei
 * LaughTime (.page-legal, .card.prose, .contact-list), nur mit den Angaben
 * und Texten von geotime.lol.
 */
export async function generateMetadata() {
  const lang = normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
  return { title: { absolute: `GeoTime.lol – ${LEGAL[lang].title}` } };
}

export default async function GeotimeLegalPage() {
  const lang = normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
  const L = LEGAL[lang];
  return (
    <div className="page-legal">
      <div className="card prose">
        <h1>{L.title}</h1>

        <h2>{L.contactTitle}</h2>
        <dl className="contact-list">
          <dt>{L.labels.platform}</dt>
          <dd>
            {GEO_OPERATOR.platform} ({GEO_OPERATOR.domain})
          </dd>
          <dt>{L.labels.operator}</dt>
          <dd>
            <a href={GEO_OPERATOR.url} target="_blank" rel="noopener">
              {GEO_OPERATOR.name}
            </a>
          </dd>
          <dt>{L.labels.location}</dt>
          <dd>{lang === 'de' ? GEO_OPERATOR.locationDe : GEO_OPERATOR.location}</dd>
          <dt>{L.labels.email}</dt>
          <dd>
            <a href={`mailto:${GEO_OPERATOR.email}`}>{GEO_OPERATOR.email}</a>
          </dd>
        </dl>
        <p className="legal-note">{L.note}</p>

        {L.sections.map((s) => (
          <section key={s.title}>
            <h2>{s.title}</h2>
            {s.paragraphs.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
