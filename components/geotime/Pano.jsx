'use client';

/**
 * Straßenansicht – kostenlos über Mapillary.
 *
 * Mapillary (von Meta) stellt weltweit Straßenbilder der Community bereit. Der
 * Token ist kostenlos (mapillary.com → Developer → Tokens) und gehört als
 * GEOTIME_MAPILLARY_TOKEN in die .env. Der Viewer (mapillary-js) wird erst
 * geladen, wenn er wirklich gebraucht wird – er ist groß.
 *
 * Wichtig: der Client bekommt vom Server NUR die Bild-ID, nie die Koordinaten
 * der laufenden Runde. Blickrichtung und Position der aktuellen Ansicht kann
 * der Viewer melden – die braucht das Bingo für den Snap.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export default function Pano({ imageId, token, provider = 'mapillary', onView, className = '' }) {
  const host = useRef(null);
  const viewer = useRef(null);
  const view = useRef({ lat: null, lng: null, heading: 0, pitch: 0, zoom: 0, imageId: null });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Achtung: `onView` kommt als neue Funktion bei jedem Rendern herein. Hinge
  // der Viewer daran, würde er zweimal pro Sekunde neu aufgebaut – genau das
  // war der Grund für das ewige „Straßenansicht lädt…". Darum über eine Ref.
  const viewRef = useRef(onView);
  viewRef.current = onView;
  const report = useCallback(() => viewRef.current?.({ ...view.current }), []);

  useEffect(() => {
    if (provider === 'demo' || !imageId) return undefined;
    let dead = false;
    let instance = null;

    (async () => {
      try {
        const { Viewer } = await import('mapillary-js');
        await import('mapillary-js/dist/mapillary.css');
        if (dead || !host.current) return;
        instance = new Viewer({
          accessToken: token,
          container: host.current,
          imageId,
          component: { cover: false, bearing: false, zoom: false },
        });
        viewer.current = instance;

        const readPose = async () => {
          try {
            const [image, pov] = await Promise.all([instance.getImage(), instance.getPointOfView()]);
            view.current = {
              lat: image?.lngLat?.lat ?? image?.computedLngLat?.lat ?? null,
              lng: image?.lngLat?.lng ?? image?.computedLngLat?.lng ?? null,
              heading: Math.round(pov?.bearing ?? 0),
              pitch: Math.round(pov?.tilt ?? 0),
              zoom: Number((pov?.zoom ?? 0).toFixed(2)),
              imageId: image?.id ?? imageId,
            };
            report();
          } catch {
            /* der Viewer ist gerade beschäftigt – beim nächsten Mal wieder */
          }
        };

        instance.on('image', () => {
          setLoading(false);
          readPose();
        });
        instance.on('moveend', readPose);
        instance.on('load', () => setLoading(false));
      } catch (err) {
        if (!dead) setError(err?.message || 'Viewer konnte nicht geladen werden.');
      }
    })();

    return () => {
      dead = true;
      try {
        instance?.remove();
      } catch {
        /* egal */
      }
      viewer.current = null;
    };
  }, [imageId, token, provider, report]);

  // Testmodus: ohne echten Viewer gibt es keine Blickrichtung. Damit sich das
  // Spiel trotzdem komplett durchspielen lässt, melden wir eine Platzhalter-
  // Ansicht. Im Normalbetrieb (Mapillary) kommen hier echte Werte.
  useEffect(() => {
    if (provider !== 'demo' || !imageId) return;
    view.current = { lat: 51.5, lng: 0, heading: 0, pitch: 0, zoom: 0, imageId };
    report();
  }, [provider, imageId, report]);

  if (provider === 'demo') {
    return (
      <div className={`geo-pano geo-pano-demo ${className}`}>
        <p>
          <strong>Testmodus</strong>
          <br />
          Hier wäre die Straßenansicht. Für echte Bilder einen kostenlosen Mapillary-Token in{' '}
          <code>GEOTIME_MAPILLARY_TOKEN</code> eintragen.
        </p>
      </div>
    );
  }

  return (
    <div className={`geo-pano ${className}`}>
      <div ref={host} className="geo-pano-host" />
      {loading && !error && <div className="geo-pano-note">Straßenansicht lädt…</div>}
      {error && <div className="geo-pano-note geo-pano-error">{error}</div>}
    </div>
  );
}
