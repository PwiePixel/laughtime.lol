'use client';

/**
 * Straßenansicht über Panoramax – ohne Token, ohne Anmeldung.
 *
 * Panoramax liefert offene Straßenbilder (CC-BY-SA). Rundumbilder kommen in
 * eine Kugel (photo-sphere-viewer), normale Fotos werden einfach gezeigt.
 *
 * Laufen wie bei Street View:
 *   • Pfeile liegen **im Bild** auf dem Boden, in der Richtung, in die es
 *     weitergeht. Anklicken = dorthin laufen.
 *   • Pfeiltaste nach oben läuft dorthin, wohin man gerade schaut.
 *   • Unten steht dieselbe Auswahl noch einmal als Leiste – praktisch, wenn
 *     ein Weg hinter einem liegt.
 *
 * Die Richtungen kommen vom eigenen Server und sind **relativ** („30 m nach
 * Nordost"). Koordinaten bekommt der Browser nie zu sehen, sonst wüsste man
 * sofort, wo man ist.
 *
 * Nach außen verhält sich die Ansicht wie die Mapillary-Variante: `onView`
 * meldet Bild-ID, Blickrichtung und Neigung. Die Koordinaten stehen auf null –
 * der Server schlägt sie bei Bedarf selbst nach.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import { useGeo } from './GeoProviders';

/** Himmelsrichtung als Wort – für die Vorlesehilfe */
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dirName = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Pfeil, der im Bild auf dem Boden liegt */
const ARROW_HTML = (deg, meters) => `
  <span class="geo-ground" style="--turn:${deg}deg">
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 6 L40 28 L28 28 L28 42 L20 42 L20 28 L8 28 Z"
            fill="#FFD23F" stroke="#170A2E" stroke-width="4" stroke-linejoin="round"/>
    </svg>
    <b>${meters} m</b>
  </span>`;

const deg = (rad) => ((rad * 180) / Math.PI + 360) % 360;

export default function PanoPsv({ imageId, onView, className = '' }) {
  const { t } = useGeo();
  const host = useRef(null);
  const viewer = useRef(null);
  const markers = useRef(null);
  const reportRef = useRef(onView);
  const stepsRef = useRef([]);
  const goRef = useRef(() => {});
  const [shot, setShot] = useState(null);
  const [at, setAt] = useState(imageId || null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  reportRef.current = onView;

  const steps = useMemo(() => shot?.steps || [], [shot]);
  stepsRef.current = steps;

  /** zu einem Nachbarbild laufen */
  const go = useCallback((id) => {
    if (id) setAt(id);
  }, []);
  goRef.current = go;

  // Wenn der Server ein neues Bild vorgibt (neue Runde, neuer Ort), dorthin
  useEffect(() => {
    if (imageId) setAt(imageId);
  }, [imageId]);

  // Bilddaten holen: Adresse, Blickrichtung, Nachbarn
  useEffect(() => {
    if (!at) {
      setLoading(false);
      return undefined;
    }
    let dead = false;
    setLoading(true);
    fetch(`/geotime-api/pano/${encodeURIComponent(at)}`, { signal: AbortSignal.timeout(12000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (dead) return;
        setShot(data);
        setError('');
      })
      .catch((err) => !dead && setError(err.message))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [at]);

  const report = useCallback(() => {
    const v = viewer.current;
    const pos = v?.getPosition?.();
    reportRef.current?.({
      lat: null,
      lng: null,
      imageId: at,
      // Blickrichtung = Ausrichtung des Bildes plus Drehung im Bild
      heading: Math.round((((shot?.azimuth || 0) + deg(pos?.yaw || 0)) % 360 + 360) % 360),
      pitch: Math.round(((pos?.pitch || 0) * 180) / Math.PI),
      zoom: Number(((v?.getZoomLevel?.() ?? 0) / 100).toFixed(2)),
    });
  }, [at, shot]);

  // Kugelansicht für Rundumbilder: einmal aufbauen, danach nur noch das Bild
  // tauschen – so gibt es beim Weiterlaufen kein Flackern.
  useEffect(() => {
    const is360 = shot?.fov === 360;
    if (!shot?.url || !is360) return undefined;
    let dead = false;

    (async () => {
      try {
        const [psv, mk] = await Promise.all([
          import('@photo-sphere-viewer/core'),
          import('@photo-sphere-viewer/markers-plugin'),
        ]);
        await import('@photo-sphere-viewer/core/index.css');
        await import('@photo-sphere-viewer/markers-plugin/index.css');
        if (dead || !host.current) return;

        // Pfeile auf den Boden legen: die Richtung ist relativ zur Ausrichtung
        // des Bildes, deshalb Kompassrichtung minus Bildrichtung.
        const paintArrows = () => {
          const plugin = markers.current;
          if (!plugin || dead) return;
          try {
            plugin.clearMarkers();
            for (const s of shot.steps || []) {
              const turn = (((s.bearing - (shot.azimuth || 0)) % 360) + 360) % 360;
              plugin.addMarker({
                id: `step-${s.id}`,
                position: { yaw: `${turn}deg`, pitch: '-32deg' },
                html: ARROW_HTML(turn, s.meters),
                size: { width: 78, height: 88 },
                anchor: 'center center',
                className: 'geo-ground-marker',
                tooltip: `${s.meters} m ${dirName(s.bearing)}`,
                data: { id: s.id },
              });
            }
          } catch {
            /* der Viewer wird gerade getauscht */
          }
        };

        if (!viewer.current) {
          const instance = new psv.Viewer({
            container: host.current,
            panorama: shot.url,
            navbar: false,
            defaultZoomLvl: 20,
            minFov: 25,
            maxFov: 100,
            mousewheel: true,
            touchmoveTwoFingers: false,
            loadingTxt: '',
            plugins: [[mk.MarkersPlugin, { markers: [] }]],
          });
          viewer.current = instance;
          markers.current = instance.getPlugin(mk.MarkersPlugin);
          markers.current?.addEventListener('select-marker', (e) => goRef.current(e.marker?.config?.data?.id));
          instance.addEventListener('position-updated', () => report());
          // die Pfeile dürfen erst dazu, wenn das Bild wirklich steht
          instance.addEventListener('ready', () => {
            report();
            paintArrows();
          });
        } else {
          await viewer.current.setPanorama(shot.url, { showLoader: true, transition: false });
          paintArrows();
        }
        report();
      } catch (err) {
        if (!dead) setError(err?.message || 'Viewer konnte nicht geladen werden.');
      }
    })();

    return () => {
      dead = true;
    };
  }, [shot, report]);

  // Viewer abräumen, wenn die Ansicht verschwindet oder ein flaches Foto kommt
  useEffect(() => {
    const is360 = shot?.fov === 360;
    if (is360 || !viewer.current) return;
    try {
      viewer.current.destroy();
    } catch {
      /* egal */
    }
    viewer.current = null;
    markers.current = null;
  }, [shot]);

  useEffect(
    () => () => {
      try {
        viewer.current?.destroy();
      } catch {
        /* egal */
      }
      viewer.current = null;
      markers.current = null;
    },
    [],
  );

  // Normale Fotos brauchen keinen Viewer – dann nur die Blickrichtung melden
  useEffect(() => {
    if (!shot?.url || shot.fov === 360) return;
    report();
  }, [shot, report]);

  // Pfeiltaste hoch: dorthin laufen, wohin man gerade schaut
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'w' && e.key !== 'W') return;
      const list = stepsRef.current;
      if (!list.length) return;
      const v = viewer.current;
      const look = v ? (deg(v.getPosition().yaw) + (shot?.azimuth || 0)) % 360 : shot?.azimuth || 0;
      // der Weg, der am ehesten in Blickrichtung liegt
      const best = [...list].sort((a, b) => {
        const da = Math.abs(((a.bearing - look + 540) % 360) - 180);
        const db = Math.abs(((b.bearing - look + 540) % 360) - 180);
        return db - da;
      })[0];
      if (best) {
        e.preventDefault();
        goRef.current(best.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shot]);

  return (
    <div className={`geo-pano ${className}`}>
      {shot?.fov === 360 ? (
        <div ref={host} className="geo-pano-host" />
      ) : (
        shot?.url && (
          <div className="geo-pano-host geo-pano-flat" style={{ '--shot': `url(${JSON.stringify(shot.url)})` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot.url} alt="" />
          </div>
        )
      )}

      {loading && <div className="geo-pano-note">{t('pano.loading')}</div>}
      {error && <div className="geo-pano-note geo-pano-bad">{t('pano.failed')}</div>}

      {steps.length > 0 && (
        <div className="geo-steps">
          <span className="geo-steps-label">
            <Icon name="radar" size={16} />
            {t('pano.walk')}
          </span>
          <div className="geo-steps-row">
            {steps.map((s) => (
              <button
                key={s.id}
                type="button"
                className="geo-step"
                title={`${s.meters} m ${dirName(s.bearing)}`}
                aria-label={`${s.meters} m ${dirName(s.bearing)}`}
                onClick={() => go(s.id)}
              >
                <span className="geo-step-arrow" style={{ transform: `rotate(${s.bearing - 90}deg)` }}>
                  <Icon name="arrow-right" size={18} />
                </span>
                <b>{s.meters} m</b>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
