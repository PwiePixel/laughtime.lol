'use client';

/**
 * Karte zum Raten – Kachelbilder von Esri (World Street Map). Kostenlos,
 * kein Schlüssel, kein Konto.
 *
 * Warum Kachelbilder und keine Vektorkarte mehr?
 * Vektorkarten rechnet maplibre in einem Web Worker aus. Next legt die
 * Arbeiterdatei beim Bauen unter einem neuen Namen ab, ohne deren Import
 * anzupassen – der Arbeiter stirbt still, die Karte bleibt leer (siehe
 * geotime/nextassets.js, das flickt den Namen). Bilder brauchen keinen
 * Arbeiter: sie werden direkt gezeichnet und sind damit unkaputtbar. Straßen
 * und Namen sind hier schon ins Bild gebacken.
 *
 * Zwei Aufgaben:
 *   1. tippen -> Marker setzen (`onPick`)
 *   2. auswerten -> echte Position, alle Tipps, Linien und die Entfernung
 *
 * maplibre-gl wird erst beim Öffnen geladen, damit die Startseite leicht bleibt.
 *
 * Bewusst so gebaut:
 *   • Tippen funktioniert, sobald die Karte da ist – nicht erst, wenn auch die
 *     letzte Kachel geladen ist. Bei langsamer Verbindung kann man sonst
 *     dasitzen und nichts geht.
 *   • Die Linien vom Tipp zur echten Position liegen als SVG über der Karte und
 *     nicht als Kartenebene darin. So sehen sie immer gleich aus (dicker
 *     Strich, runde Enden) und hängen nicht davon ab, wie weit der Kartenstil
 *     geladen ist.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { distanceText } from '@/lib/geotime/format';
import { useGeo } from './GeoProviders';

const TEAM_COLOR = { a: '#35E0FF', b: '#FF4FA3' };
const TRUTH_COLOR = '#FFD23F';

/** Kacheln ohne Schlüssel und ohne Anmeldung (Nachweis: Fußzeile/Impressum) */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const MAP_TILES = `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`;

/** Kartenstil komplett aus Bildern – braucht keinen Web Worker */
const RASTER_STYLE = {
  version: 8,
  sources: {
    'geo-base': { type: 'raster', tiles: [MAP_TILES], tileSize: 256, maxzoom: 19 },
  },
  layers: [
    { id: 'geo-bg', type: 'background', paint: { 'background-color': '#cfd8e3' } },
    { id: 'geo-base', type: 'raster', source: 'geo-base' },
  ],
};

export default function GuessMap({ style, pick, onPick, result = null, className = '' }) {
  const { t, lang } = useGeo();
  const host = useRef(null);
  const map = useRef(null);
  const lib = useRef(null);
  const markers = useRef([]);
  const pickRef = useRef(onPick);
  const [live, setLive] = useState(false);
  const [lines, setLines] = useState([]);

  pickRef.current = onPick;

  /** Linien neu ausrechnen: Bildschirmkoordinaten von Tipp und echter Position */
  const drawLines = useCallback(() => {
    const m = map.current;
    if (!m || !result?.truth) return setLines([]);
    const to = m.project([result.truth.lng, result.truth.lat]);
    const next = (result.guesses || [])
      .filter((g) => !g.skipped && Number.isFinite(g.lat) && Number.isFinite(g.lng))
      .map((g) => {
        const from = m.project([g.lng, g.lat]);
        // an beiden Enden Platz lassen, damit die Linie nicht über den
        // Markern klebt
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const gap = Math.min(15, len / 3);
        const ux = (dx / len) * gap;
        const uy = (dy / len) * gap;
        return {
          id: g.playerId,
          color: TEAM_COLOR[g.team] || '#ffffff',
          text: Number.isFinite(g.km) ? distanceText(g.km, lang) : '',
          x1: from.x + ux,
          y1: from.y + uy,
          x2: to.x - ux,
          y2: to.y - uy,
          mx: (from.x + to.x) / 2,
          my: (from.y + to.y) / 2,
        };
      });
    return setLines(next);
  }, [result, lang]);

  // Karte einmal aufbauen
  useEffect(() => {
    let dead = false;
    let settle = null;
    (async () => {
      const maplibre = await import('maplibre-gl');
      await import('maplibre-gl/dist/maplibre-gl.css');
      if (dead || !host.current) return;
      const L = maplibre.default || maplibre;
      lib.current = L;
      const m = new L.Map({
        container: host.current,
        // eine eigene Adresse aus der .env gewinnt, sonst die Bildkarte
        style: style || RASTER_STYLE,
        center: [10, 30],
        zoom: 0.7,
        dragRotate: false,
        pitchWithRotate: false,
        // Der Nachweis-Kasten von maplibre würde die halbe Karte zudecken.
        // Die Nachweise stehen stattdessen in der Fußzeile und im Impressum –
        // das verlangen OpenStreetMap und Esri so auch.
        attributionControl: false,
      });
      m.touchZoomRotate.disableRotation();
      m.addControl(new L.NavigationControl({ showCompass: false }), 'top-right');
      // tippen = raten; hängt NICHT am vollständigen Laden der Kacheln
      m.on('click', (e) => pickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      const show = () => !dead && setLive(true);
      m.on('load', show);
      m.on('styledata', show);
      settle = setTimeout(show, 4000); // Notbremse bei zäher Verbindung
      map.current = m;
    })();
    return () => {
      dead = true;
      clearTimeout(settle);
      map.current?.remove();
      map.current = null;
    };
  }, [style]);

  // Marker neu zeichnen (eigener Tipp oder die ganze Auswertung)
  useEffect(() => {
    const m = map.current;
    const L = lib.current;
    if (!m || !L) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];

    const dot = (color, label) => {
      const el = document.createElement('div');
      el.className = 'geo-marker';
      el.style.background = color;
      if (label) el.dataset.label = label;
      return el;
    };

    if (result) {
      const points = [[result.truth.lng, result.truth.lat]];
      markers.current.push(new L.Marker({ element: dot(TRUTH_COLOR, '!') }).setLngLat(points[0]).addTo(m));
      for (const g of result.guesses || []) {
        if (g.skipped || !Number.isFinite(g.lat)) continue;
        points.push([g.lng, g.lat]);
        markers.current.push(
          new L.Marker({ element: dot(TEAM_COLOR[g.team] || '#ffffff', (g.name || '?').slice(0, 2)) })
            .setLngLat([g.lng, g.lat])
            .setPopup(new L.Popup({ offset: 14, closeButton: false }).setText(`${g.name}: ${g.points} Punkte`))
            .addTo(m),
        );
      }
      if (points.length > 1) {
        const b = points.reduce((acc, p) => acc.extend(p), new L.LngLatBounds(points[0], points[0]));
        m.fitBounds(b, { padding: 60, maxZoom: 9, duration: 600 });
      } else {
        m.easeTo({ center: points[0], zoom: 4, duration: 600 });
      }
      drawLines();
      return;
    }

    if (pick) markers.current.push(new L.Marker({ element: dot('#7CFF6B') }).setLngLat([pick.lng, pick.lat]).addTo(m));
  }, [pick, result, live, lang, drawLines]);

  // Linien mitziehen, solange die Karte sich bewegt
  useEffect(() => {
    const m = map.current;
    if (!m || !result) return undefined;
    m.on('move', drawLines);
    m.on('resize', drawLines);
    drawLines();
    return () => {
      m.off('move', drawLines);
      m.off('resize', drawLines);
    };
  }, [result, live, drawLines]);

  return (
    <div className={`geo-map ${className}`}>
      <div ref={host} className="geo-map-host" />
      {lines.length > 0 && (
        <>
          <svg className="geo-lines" aria-hidden="true">
            {lines.map((l) => (
              <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} />
            ))}
          </svg>
          <div className="geo-tags" aria-hidden="true">
            {lines
              .filter((l) => l.text)
              .map((l) => (
                <span
                  key={l.id}
                  className="geo-dist"
                  style={{ '--tag': l.color, left: `${l.mx}px`, top: `${l.my}px` }}
                >
                  {l.text}
                </span>
              ))}
          </div>
        </>
      )}
      {!live && <div className="geo-map-note">{t('map.loading')}</div>}
    </div>
  );
}
