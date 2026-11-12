'use client';

/**
 * GeoHunt – das Zielfoto und der „Hier!"-Knopf.
 *
 * Der Server verrät nie, wie weit es noch ist. Er sagt nur, wie warm es wird
 * und in welche Richtung – sonst könnte man das Ziel aus zwei Messungen
 * ausrechnen. Das Zielfoto ist ein kleines Vorschaubild aus der
 * Straßenansicht; angetippt wird es groß.
 */
import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';

const HEAT_CLASS = {
  found: 'found',
  burning: 'burning',
  hot: 'hot',
  warm: 'warm',
  cold: 'cold',
  freezing: 'freezing',
};

export default function HuntPanel({ target, token, provider, heat, found, onArrive, busy, t }) {
  const [big, setBig] = useState(false);
  const [shot, setShot] = useState(null);
  const level = heat?.heat || null;

  // Woher das Zielfoto kommt, hängt an der Bildquelle:
  //   mapillary – Vorschaubild direkt über die Bild-ID
  //   panoramax – über den eigenen Server, damit keine Koordinaten mitkommen
  useEffect(() => {
    if (!target?.id || provider === 'demo') return setShot(null);
    if (provider !== 'panoramax') {
      return setShot(
        `https://images.mapillary.com/${encodeURIComponent(target.id)}/thumb-1024.jpg?access_token=${encodeURIComponent(token || '')}`,
      );
    }
    let dead = false;
    fetch(`/geotime-api/pano/${encodeURIComponent(target.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('pano'))))
      .then((d) => !dead && setShot(d.url || d.thumb || null))
      .catch(() => !dead && setShot(null));
    return () => {
      dead = true;
    };
  }, [target?.id, provider, token]);

  return (
    <section className={`geo-hunt ${big ? 'big' : ''}`}>
      <div className="geo-hunt-head">
        <strong>{t('hunt.target')}</strong>
        {level && (
          <span className={`geo-heat ${HEAT_CLASS[level] || ''}`}>
            {t(`hunt.heat.${level}`)}
            {heat?.bearing !== undefined && level !== 'found' && (
              <Icon name="arrow-right" size={16} style={{ transform: `rotate(${heat.bearing - 90}deg)` }} />
            )}
          </span>
        )}
      </div>

      <button type="button" className="geo-hunt-shot" onClick={() => setBig((b) => !b)} aria-label={t('hunt.target')}>
        {shot ? (
          // Rundumbilder sind lang gezogene Streifen. Darum wird für das
          // Zielfoto nur die Mitte gezeigt – das sieht aus wie ein normales
          // Foto und verrät trotzdem alles, was man zum Suchen braucht.
          <span
            className={`geo-hunt-img ${target?.pano ? 'is-360' : ''}`}
            style={{ backgroundImage: `url(${JSON.stringify(shot)})` }}
            role="img"
            aria-label={t('hunt.target')}
          />
        ) : (
          <span className="geo-hunt-placeholder">
            <Icon name="image" size={28} />
          </span>
        )}
      </button>

      {found ? (
        <p className="geo-hunt-done">
          <Icon name="check" size={18} /> {t('hunt.found')} · {t('hunt.rank', { n: found.rank })} · +{found.points}
        </p>
      ) : (
        <>
          <button type="button" className="btn btn-yellow btn-block" disabled={busy} onClick={onArrive}>
            {t('hunt.here')}
          </button>
          <p className="small muted geo-hunt-hint">{t('hunt.hint')}</p>
        </>
      )}
    </section>
  );
}
