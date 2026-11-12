/**
 * GeoTime.lol – Straßenbilder von Panoramax
 *
 * Panoramax ist ein offenes Straßenbild-Projekt (CC-BY-SA 4.0). Anders als bei
 * Mapillary braucht es **keinen Schlüssel und keine Anmeldung** – damit läuft
 * GeoTime sofort mit echten Straßenansichten.
 *
 * Warum das über den eigenen Server läuft und nicht direkt aus dem Browser:
 *
 *   1. Die echte Position einer Runde bleibt geheim. Der Browser bekommt nur
 *      die Bild-Adresse und die Blickrichtung – nie Länge und Breite. Zum
 *      Weiterlaufen gibt es Nachbarbilder mit *relativer* Richtung
 *      („20 Meter nach Nordost"), daraus lässt sich der Standort nicht
 *      ableiten.
 *   2. Der Server merkt sich die Koordinaten zu jeder Bild-ID. GeoHunt fragt
 *      damit „wärmer oder kälter?", ohne dass der Browser je die Wahrheit sieht.
 *
 * Die API ist STAC: /search liefert GeoJSON-„features", jedes Bild hat feste
 * Adressen für Original (hd), 2048 Pixel (sd) und Vorschau (thumb).
 */

const CACHE_MAX = 4000;
const CACHE_MS = 2 * 60 * 60 * 1000; // zwei Stunden
const KM_PER_DEG = 111.32;

/** Bild-ID -> { lat, lng, azimuth, fov, url, thumb, at } */
const cache = new Map();

function remember(entry) {
  if (!entry?.id) return entry;
  if (cache.size > CACHE_MAX) {
    // ältere Hälfte wegwerfen, das reicht völlig
    const keys = [...cache.keys()].slice(0, Math.floor(CACHE_MAX / 2));
    for (const k of keys) cache.delete(k);
  }
  cache.set(entry.id, { ...entry, at: Date.now() });
  return entry;
}

function cached(id) {
  const hit = cache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(id);
    return null;
  }
  return hit;
}

async function ask(url, ms = 9000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`panoramax ${res.status}`);
  return res.json();
}

/** ein STAC-„feature" auf das eindampfen, was GeoTime braucht */
function toPicture(f) {
  if (!f?.id) return null;
  const [lng, lat] = f.geometry?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const p = f.properties || {};
  return {
    id: String(f.id),
    lat,
    lng,
    azimuth: Number(p['view:azimuth']) || 0,
    fov: Number(p['pers:interior_orientation']?.field_of_view) || 0,
    url: f.assets?.sd?.href || f.assets?.hd?.href || p['geovisio:image'] || '',
    thumb: f.assets?.thumb?.href || p['geovisio:thumbnail'] || '',
    seq: f.collection ? String(f.collection) : null,
  };
}

/** Rechteck um einen Punkt (in Kilometern) */
export function boxAround({ lat, lng }, km) {
  const dLat = km / KM_PER_DEG;
  const dLng = km / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((n) => n.toFixed(6)).join(',');
}

/**
 * Bilder in einem Rechteck suchen.
 * @param {object} cfg    Instanz-Konfiguration
 * @param {string} bbox   "minLng,minLat,maxLng,maxLat"
 * @param {object} [opts]
 * @param {boolean} [opts.only360]  nur Rundumbilder (die machen mehr Spaß)
 */
export async function search(cfg, bbox, { only360 = false, limit = 40 } = {}) {
  const filter = only360 ? '&filter=field_of_view%3D360' : '';
  const data = await ask(`${cfg.pano.panoramaxUrl}/search?bbox=${bbox}&limit=${limit}${filter}`);
  return (data.features || []).map(toPicture).filter(Boolean).map(remember);
}

/** ein einzelnes Bild – erst im Gedächtnis nachsehen, dann fragen */
export async function picture(cfg, id) {
  const hit = cached(id);
  if (hit) return hit;
  const data = await ask(`${cfg.pano.panoramaxUrl}/search?ids=${encodeURIComponent(id)}`);
  const found = (data.features || []).map(toPicture).filter(Boolean)[0];
  return found ? remember(found) : null;
}

/** Koordinaten zu einer Bild-ID – nur für den Server (Wärme, Bingo-Prüfung) */
export async function coordsOf(cfg, id) {
  const p = cached(id) || (await picture(cfg, id).catch(() => null));
  return p ? { lat: p.lat, lng: p.lng } : null;
}

/** Richtung von a nach b in Grad (0 = Norden) */
function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Entfernung in Metern (reicht für Nachbarbilder völlig) */
function meters(a, b) {
  const dLat = (b.lat - a.lat) * KM_PER_DEG;
  const dLng = (b.lng - a.lng) * KM_PER_DEG * Math.cos((a.lat * Math.PI) / 180);
  return Math.round(Math.hypot(dLat, dLng) * 1000);
}

/**
 * Wohin kann man von hier aus laufen?
 * Zurück kommen nur *relative* Angaben: Richtung und Entfernung in Metern.
 * Damit kann man sich bewegen, aber nicht ausrechnen, wo man ist.
 * @returns {Promise<Array<{id:string, bearing:number, meters:number, fov:number}>>}
 */
export async function moves(cfg, from, { radiusM = 60, max = 8 } = {}) {
  let found = [];
  try {
    found = await search(cfg, boxAround(from, radiusM / 1000), { limit: 60 });
  } catch {
    return [];
  }
  const out = found
    .filter((p) => p.id !== from.id)
    .map((p) => ({ id: p.id, bearing: bearing(from, p), meters: meters(from, p), fov: p.fov }))
    .filter((p) => p.meters >= 2 && p.meters <= radiusM)
    .sort((a, b) => a.meters - b.meters);

  // pro Himmelsrichtung nur das nächste Bild – sonst steht man vor zwanzig
  // Pfeilen, die alle in dieselbe Richtung zeigen
  const perSector = new Map();
  for (const p of out) {
    const sector = Math.round(p.bearing / 45) % 8;
    if (!perSector.has(sector)) perSector.set(sector, p);
  }
  return [...perSector.values()].sort((a, b) => a.bearing - b.bearing).slice(0, max);
}

/** Was der Browser sehen darf: Bild und Blickrichtung, aber keine Koordinaten */
export function publicPicture(p) {
  return { id: p.id, url: p.url, thumb: p.thumb, azimuth: p.azimuth, fov: p.fov };
}
