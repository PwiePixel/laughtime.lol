import { cookies } from 'next/headers';
import { LANG_COOKIE, normalizeLang } from '@/lib/i18n';
import { LEGAL } from '@/lib/legal';
import { LEGAL_V2 } from '@/lib/legal-v2';
import { OPERATOR } from '@/lib/operator';

export async function generateMetadata() {
  const lang = normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
  return { title: LEGAL[lang].title };
}

export default async function LegalPage() {
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
            {OPERATOR.platform} ({OPERATOR.domain})
          </dd>
          <dt>{L.labels.operator}</dt>
          <dd>
            <a href={OPERATOR.url} target="_blank" rel="noopener">
              {OPERATOR.name}
            </a>
          </dd>
          <dt>{L.labels.location}</dt>
          <dd>{lang === 'de' ? OPERATOR.locationDe : OPERATOR.location}</dd>
          <dt>{L.labels.email}</dt>
          <dd>
            <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
          </dd>
        </dl>
        <p className="legal-note">{L.note}</p>

        {/* the reviewed texts first, then the additions for v2 (lib/legal-v2.js) */}
        {[...L.sections, LEGAL_V2[lang]].map((s) => (
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
