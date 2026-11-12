/**
 * GeoTime.lol – Fundorte (HOT-MODUL)
 *
 * Woher kommt ein Startpunkt? Aus einer Liste von Gegenden, in denen es
 * erfahrungsgemäß Straßenbilder gibt. Für jede Runde wird eine Gegend gezogen
 * und darin ein echtes Bild gesucht.
 *
 * Zwei Bildquellen, beide kostenlos:
 *
 *   panoramax – offenes Straßenbild-Projekt (CC-BY-SA). **Ohne Anmeldung, ohne
 *               Schlüssel.** Das ist der Normalfall: GeoTime zeigt sofort echte
 *               Straßenansichten. Am besten sind die Rundumbilder (360°),
 *               danach wird nach normalen Fotos gesucht.
 *   mapillary – weltweit mehr Bilder, braucht aber einen kostenlosen Token
 *               (mapillary.com → Developer → Tokens) als
 *               GEOTIME_MAPILLARY_TOKEN in der .env. Ist der da, nimmt GeoTime
 *               automatisch Mapillary.
 *
 * Wichtig fürs Spiel: die echten Koordinaten bleiben auf dem Server, bis die
 * Runde vorbei ist. Der Client bekommt nur die Bild-ID.
 *
 * Diese Datei ist hot austauschbar: neue Gegenden über
 * geotime/updates/<kanal>/game/locations.js einspielen – ohne Neustart.
 */

import { boxAround, moves as panoMoves, picture as panoPicture, search as panoSearch } from '../pano.js';

/** Gegenden mit guter Abdeckung. radius in Kilometern. */
export const AREAS = [
  { name: 'Berlin', lat: 52.52, lng: 13.405, r: 12, land: 'DE' },
  { name: 'Hamburg', lat: 53.551, lng: 9.993, r: 10, land: 'DE' },
  { name: 'Köln', lat: 50.938, lng: 6.96, r: 9, land: 'DE' },
  { name: 'München', lat: 48.137, lng: 11.575, r: 9, land: 'DE' },
  { name: 'Frankfurt', lat: 50.11, lng: 8.682, r: 8, land: 'DE' },
  { name: 'Wien', lat: 48.208, lng: 16.373, r: 9, land: 'AT' },
  { name: 'Zürich', lat: 47.377, lng: 8.541, r: 7, land: 'CH' },
  { name: 'Amsterdam', lat: 52.37, lng: 4.895, r: 8, land: 'NL' },
  { name: 'Brüssel', lat: 50.847, lng: 4.352, r: 8, land: 'BE' },
  { name: 'Paris', lat: 48.857, lng: 2.352, r: 9, land: 'FR' },
  { name: 'Lyon', lat: 45.764, lng: 4.836, r: 7, land: 'FR' },
  { name: 'Madrid', lat: 40.417, lng: -3.704, r: 9, land: 'ES' },
  { name: 'Barcelona', lat: 41.385, lng: 2.173, r: 8, land: 'ES' },
  { name: 'Lissabon', lat: 38.722, lng: -9.139, r: 8, land: 'PT' },
  { name: 'Rom', lat: 41.903, lng: 12.496, r: 9, land: 'IT' },
  { name: 'Mailand', lat: 45.464, lng: 9.19, r: 8, land: 'IT' },
  { name: 'London', lat: 51.507, lng: -0.128, r: 12, land: 'GB' },
  { name: 'Manchester', lat: 53.481, lng: -2.242, r: 8, land: 'GB' },
  { name: 'Dublin', lat: 53.35, lng: -6.26, r: 8, land: 'IE' },
  { name: 'Kopenhagen', lat: 55.677, lng: 12.568, r: 8, land: 'DK' },
  { name: 'Stockholm', lat: 59.329, lng: 18.069, r: 9, land: 'SE' },
  { name: 'Oslo', lat: 59.914, lng: 10.752, r: 8, land: 'NO' },
  { name: 'Helsinki', lat: 60.17, lng: 24.938, r: 8, land: 'FI' },
  { name: 'Warschau', lat: 52.23, lng: 21.012, r: 9, land: 'PL' },
  { name: 'Prag', lat: 50.076, lng: 14.438, r: 8, land: 'CZ' },
  { name: 'Budapest', lat: 47.498, lng: 19.04, r: 8, land: 'HU' },
  { name: 'Athen', lat: 37.984, lng: 23.728, r: 8, land: 'GR' },
  { name: 'Istanbul', lat: 41.008, lng: 28.978, r: 12, land: 'TR' },
  { name: 'New York', lat: 40.713, lng: -74.006, r: 12, land: 'US' },
  { name: 'Chicago', lat: 41.878, lng: -87.63, r: 10, land: 'US' },
  { name: 'San Francisco', lat: 37.775, lng: -122.419, r: 8, land: 'US' },
  { name: 'Los Angeles', lat: 34.052, lng: -118.244, r: 14, land: 'US' },
  { name: 'Miami', lat: 25.762, lng: -80.192, r: 9, land: 'US' },
  { name: 'Seattle', lat: 47.606, lng: -122.332, r: 9, land: 'US' },
  { name: 'Austin', lat: 30.267, lng: -97.743, r: 9, land: 'US' },
  { name: 'Toronto', lat: 43.653, lng: -79.383, r: 10, land: 'CA' },
  { name: 'Montreal', lat: 45.502, lng: -73.567, r: 9, land: 'CA' },
  { name: 'Vancouver', lat: 49.283, lng: -123.121, r: 8, land: 'CA' },
  { name: 'Mexiko-Stadt', lat: 19.433, lng: -99.133, r: 12, land: 'MX' },
  { name: 'São Paulo', lat: -23.551, lng: -46.633, r: 12, land: 'BR' },
  { name: 'Rio de Janeiro', lat: -22.907, lng: -43.173, r: 10, land: 'BR' },
  { name: 'Buenos Aires', lat: -34.604, lng: -58.382, r: 10, land: 'AR' },
  { name: 'Santiago', lat: -33.449, lng: -70.669, r: 9, land: 'CL' },
  { name: 'Bogotá', lat: 4.711, lng: -74.072, r: 9, land: 'CO' },
  { name: 'Kapstadt', lat: -33.925, lng: 18.424, r: 9, land: 'ZA' },
  { name: 'Johannesburg', lat: -26.204, lng: 28.047, r: 10, land: 'ZA' },
  { name: 'Nairobi', lat: -1.292, lng: 36.822, r: 9, land: 'KE' },
  { name: 'Lagos', lat: 6.524, lng: 3.379, r: 10, land: 'NG' },
  { name: 'Kairo', lat: 30.044, lng: 31.236, r: 10, land: 'EG' },
  { name: 'Tel Aviv', lat: 32.085, lng: 34.781, r: 8, land: 'IL' },
  { name: 'Dubai', lat: 25.205, lng: 55.271, r: 10, land: 'AE' },
  { name: 'Bangkok', lat: 13.756, lng: 100.502, r: 10, land: 'TH' },
  { name: 'Singapur', lat: 1.352, lng: 103.82, r: 8, land: 'SG' },
  { name: 'Kuala Lumpur', lat: 3.139, lng: 101.687, r: 9, land: 'MY' },
  { name: 'Jakarta', lat: -6.208, lng: 106.846, r: 10, land: 'ID' },
  { name: 'Tokio', lat: 35.676, lng: 139.65, r: 12, land: 'JP' },
  { name: 'Osaka', lat: 34.694, lng: 135.502, r: 9, land: 'JP' },
  { name: 'Seoul', lat: 37.567, lng: 126.978, r: 10, land: 'KR' },
  { name: 'Taipeh', lat: 25.033, lng: 121.565, r: 8, land: 'TW' },
  { name: 'Sydney', lat: -33.869, lng: 151.209, r: 10, land: 'AU' },
  { name: 'Melbourne', lat: -37.814, lng: 144.963, r: 10, land: 'AU' },
  { name: 'Auckland', lat: -36.849, lng: 174.763, r: 9, land: 'NZ' },
  { name: 'Delhi', lat: 28.614, lng: 77.209, r: 12, land: 'IN' },
  { name: 'Mumbai', lat: 19.076, lng: 72.878, r: 10, land: 'IN' },
];

const KM_PER_DEG = 111.32;

/** zufälliger Punkt im Umkreis einer Gegend */
function jitter(area) {
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.sqrt(Math.random()) * area.r; // gleichmäßig über die Fläche
  const lat = area.lat + (dist * Math.sin(angle)) / KM_PER_DEG;
  const lng = area.lng + (dist * Math.cos(angle)) / (KM_PER_DEG * Math.cos((area.lat * Math.PI) / 180));
  return { lat, lng };
}

/** kleines Rechteck um einen Punkt (Mapillary sucht per bbox) */
function bbox({ lat, lng }, km) {
  const dLat = km / KM_PER_DEG;
  const dLng = km / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((n) => n.toFixed(6)).join(',');
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Ein echtes Mapillary-Bild in der Nähe suchen.
 * @returns {Promise<{id:string, lat:number, lng:number, area:string, land:string}|null>}
 */
/**
 * Anfrage an Mapillary. Der Token gehört laut deren Anleitung in die Kopfzeile
 * („Authorization: OAuth MLY|…") und nicht in die Adresse – so geht er auch
 * nicht durch die Umkodierung kaputt.
 * @returns {Promise<object|null>} null = hat nicht geklappt (kein Abbruch)
 */
async function askMapillary(cfg, path, ms = 6000) {
  try {
    const res = await fetch(`${cfg.pano.apiUrl}${path}`, {
      headers: { Authorization: `OAuth ${cfg.pano.token}` },
      signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) {
      lastMapillaryError = `HTTP ${res.status}`;
      return null;
    }
    return await res.json();
  } catch (err) {
    lastMapillaryError = err?.name === 'TimeoutError' ? 'Zeitüberschreitung' : err.message;
    return null;
  }
}

/** letzter Grund, warum Mapillary nicht wollte – nur für die Meldung */
let lastMapillaryError = '';

async function findMapillary(cfg, area, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const point = jitter(area);
    const data = await askMapillary(
      cfg,
      `/images?fields=id,computed_geometry,geometry,is_pano&limit=40&bbox=${bbox(point, 1.2)}`,
    );
    if (!data) continue; // Mapillary hakt gerade – nächste Gegend probieren
    const items = (data.data || []).filter((x) => x?.id);
    if (!items.length) continue;
    // 360°-Bilder zuerst, die machen mehr Spaß
    const panos = items.filter((x) => x.is_pano);
    const hit = pick(panos.length ? panos : items);
    const geo = hit.computed_geometry || hit.geometry;
    const [lng, lat] = geo?.coordinates || [];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    return { id: String(hit.id), lat, lng, area: area.name, land: area.land, pano: Boolean(hit.is_pano), source: 'mapillary' };
  }
  return null;
}

/**
 * Ein echtes Panoramax-Bild in der Nähe suchen – ohne Token.
 * Rundumbilder zuerst; gibt es keine, tut es auch ein normales Foto.
 * @returns {Promise<{id:string, lat:number, lng:number, area:string, land:string}|null>}
 */
async function findPanoramax(cfg, area, { tries = 3, only360 = true } = {}) {
  for (let i = 0; i < tries; i++) {
    const point = jitter(area);
    let items = [];
    try {
      items = await panoSearch(cfg, boxAround(point, 1.2), { only360, limit: 40 });
    } catch (err) {
      throw new Error(`Panoramax nicht erreichbar: ${err.message}`);
    }
    if (!items.length) continue;
    const hit = pick(items);
    return { id: hit.id, lat: hit.lat, lng: hit.lng, area: area.name, land: area.land, pano: hit.fov === 360, source: 'panoramax' };
  }
  return null;
}

/** Startpunkt für GeoHunt bei Panoramax */
async function nearbyPanoramax(cfg, point) {
  const box = boxAround(point, 0.7);
  let items = [];
  try {
    items = await panoSearch(cfg, box, { only360: true, limit: 40 });
    if (!items.length) items = await panoSearch(cfg, box, { limit: 40 });
  } catch {
    return null;
  }
  if (!items.length) return null;
  const hit = pick(items);
  return { id: hit.id, lat: hit.lat, lng: hit.lng, pano: hit.fov === 360, source: 'panoramax' };
}

/**
 * Einen Startpunkt in der Nähe eines Ziels suchen (für GeoHunt).
 * Der Spieler startet also ein Stück weg und läuft von dort hin.
 * @param {object} cfg
 * @param {{lat:number,lng:number}} target
 * @param {{min:number,max:number}} range  Entfernung in Kilometern
 */
export async function nearbyLocation(cfg, target, range = { min: 0.8, max: 2.5 }) {
  if (cfg.pano.provider === 'demo') {
    const angle = Math.random() * Math.PI * 2;
    const dist = range.min + Math.random() * (range.max - range.min);
    return {
      id: `demo-start-${Date.now().toString(36)}`,
      lat: target.lat + (dist * Math.sin(angle)) / KM_PER_DEG,
      lng: target.lng + (dist * Math.cos(angle)) / (KM_PER_DEG * Math.cos((target.lat * Math.PI) / 180)),
      pano: true,
      demo: true,
      source: 'demo',
    };
  }
  // vier Startpunkte rundherum gleichzeitig versuchen – nacheinander dauert
  // das im schlechtesten Fall zu lange, und der Raum wartet darauf
  const spots = Array.from({ length: 4 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const dist = range.min + Math.random() * (range.max - range.min);
    return {
      lat: target.lat + (dist * Math.sin(angle)) / KM_PER_DEG,
      lng: target.lng + (dist * Math.cos(angle)) / (KM_PER_DEG * Math.cos((target.lat * Math.PI) / 180)),
    };
  });

  if (cfg.pano.provider === 'panoramax') {
    const found = await Promise.all(spots.map((s) => nearbyPanoramax(cfg, s).catch(() => null)));
    const hit = found.find(Boolean);
    if (hit) return hit;
  } else {
    const found = await Promise.all(
      spots.map(async (point) => {
        const data = await askMapillary(
          cfg,
          `/images?fields=id,computed_geometry,geometry,is_pano&limit=25&bbox=${bbox(point, 0.7)}`,
        );
        const items = (data?.data || []).filter((x) => x?.id);
        if (!items.length) return null;
        const panos = items.filter((x) => x.is_pano);
        const hit = pick(panos.length ? panos : items);
        const geo = hit.computed_geometry || hit.geometry;
        const [lng, lat] = geo?.coordinates || [];
        if (typeof lat !== 'number') return null;
        return { id: String(hit.id), lat, lng, pano: Boolean(hit.is_pano), source: 'mapillary' };
      }),
    );
    const hit = found.find(Boolean);
    if (hit) return hit;
  }
  // Mapillary will gerade nicht? Dann eben ein offenes Bild von Panoramax –
  // Hauptsache, die Runde läuft weiter.
  return nearbyPanoramax(cfg, { lat: target.lat, lng: target.lng });
}


/**
 * Mehrere Gegenden **gleichzeitig** absuchen und das erste brauchbare Bild
 * nehmen. Nacheinander zu fragen dauerte im schlechtesten Fall Minuten – eine
 * Runde soll aber in ein paar Sekunden stehen.
 *
 * @param {Function} find  (cfg, area) => Promise<Ort|null>
 * @param {number} lanes   wie viele Gegenden gleichzeitig
 * @param {Set<string>} seen  Bilder, die schon dran waren
 */
async function firstOf(cfg, find, lanes, seen) {
  const areas = new Set();
  while (areas.size < lanes) areas.add(pick(AREAS));
  const results = await Promise.all([...areas].map((area) => find(cfg, area).catch(() => null)));
  return results.find((r) => r && !seen.has(r.id)) || null;
}

/**
 * Einen Fundort für eine Runde ziehen.
 * @param {object} cfg  Instanz-Konfiguration
 * @param {object} [opts]
 * @param {string[]} [opts.exclude]  Bild-IDs, die schon dran waren
 * @returns {Promise<{id:string, lat:number, lng:number, area:string, land:string}>}
 */
export async function nextLocation(cfg, { exclude = [] } = {}) {
  if (cfg.pano.provider === 'demo') {
    // Entwickler-Modus: kein Token nötig, kein echtes Bild – nur zum Testen
    const area = pick(AREAS);
    const point = jitter(area);
    return {
      id: `demo-${Date.now().toString(36)}`,
      ...point,
      area: area.name,
      land: area.land,
      pano: true,
      demo: true,
      source: 'demo',
    };
  }
  const seen = new Set(exclude);
  if (cfg.pano.provider === 'panoramax') {
    // Erst Rundumbilder (die machen als Straßenansicht am meisten her),
    // danach normale Fotos – beides in mehreren Gegenden gleichzeitig.
    for (let round = 0; round < 2; round++) {
      const found = await firstOf(cfg, (c, a) => findPanoramax(c, a, { tries: 1 }), 5, seen);
      if (found) return found;
    }
    const any = await firstOf(cfg, (c, a) => findPanoramax(c, a, { tries: 1, only360: false }), 5, seen);
    if (any) return any;
    throw new Error('Kein Bild gefunden – bitte noch einmal versuchen.');
  }
  if (!cfg.pano.token) throw new Error('GEOTIME_MAPILLARY_TOKEN fehlt (kostenlos auf mapillary.com)');
  lastMapillaryError = '';
  for (let round = 0; round < 2; round++) {
    const found = await firstOf(cfg, (c, a) => findMapillary(c, a, 1), 5, seen);
    if (found) return found;
  }
  // Mapillary streikt (Zeitüberschreitung, 500 …)? Dann übernimmt Panoramax,
  // damit die Runde trotzdem startet. Das braucht keinen Schlüssel.
  for (const only360 of [true, false]) {
    const found = await firstOf(cfg, (c, a) => findPanoramax(c, a, { tries: 1, only360 }), 5, seen);
    if (found) return found;
  }
  throw new Error(
    lastMapillaryError
      ? `Kein Bild gefunden (Mapillary: ${lastMapillaryError}) – bitte noch einmal versuchen.`
      : 'Kein Bild gefunden – bitte noch einmal versuchen.',
  );
}

/**
 * Nachbarbilder zum Weiterlaufen (nur Panoramax; Mapillary macht das im
 * Viewer selbst). Zurück kommen nur relative Richtungen – nie Koordinaten.
 */
export async function stepsFrom(cfg, imageId) {
  if (cfg.pano.provider !== 'panoramax') return [];
  const from = await panoPicture(cfg, imageId).catch(() => null);
  if (!from) return [];
  return panoMoves(cfg, from);
}
