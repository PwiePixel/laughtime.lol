/**
 * GeoTime.lol – Konfiguration
 *
 * GeoTime liegt im LaughTime-Projekt und benutzt dieselbe .env. Damit sich
 * nichts beißt, gehören GeoTime alle Schlüssel mit GEOTIME_-Präfix (plus
 * PORT_GEOTIME). Die Datenbank liegt getrennt in data/geotime.db.
 *
 * Eine "Instanz" ist ein eigener Port im selben Prozess:
 *   prod    -> PORT_GEOTIME,      data/geotime.db,          updates/production
 *   beta-1  -> Port aus dem Pool, data/geotime-beta-1.db,   updates/beta
 */
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS_DIR, DATA_DIR, GEOTIME_DIR, RUNTIME_DIR, UPDATES_DIR } from './paths.js';

/** Kartenstile, die frühere Fassungen eingetragen haben (gelten als leer) */
const OLD_STYLES = [
  'https://tiles.openfreemap.org/styles/liberty',
  'https://tiles.openfreemap.org/styles/bright',
  'https://tiles.openfreemap.org/styles/positron',
];

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const bool = (v, d = false) => (v === undefined || v === '' ? d : v === 'true' || v === '1' || v === 'yes');
const list = (v) =>
  String(v || '')
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

let file = null;
/** geotime/instances.json (Ports, Beta-Regeln) */
export function instancesConfig({ fresh = false } = {}) {
  if (!file || fresh) file = JSON.parse(fs.readFileSync(path.join(GEOTIME_DIR, 'instances.json'), 'utf8'));
  return file;
}

/** Ports, die Beta-Instanzen benutzen dürfen (in Pterodactyl als Allocation anlegen!) */
export function betaPortPool() {
  const cfg = instancesConfig().beta;
  const fromEnv = list(process.env[cfg.portPoolEnv]).map(Number).filter((n) => Number.isFinite(n));
  return fromEnv.length ? fromEnv : cfg.portPool;
}

/** Ist GeoTime überhaupt eingeschaltet? (ohne Port läuft nur LaughTime) */
export const geotimeEnabled = () => bool(process.env.GEOTIME_ENABLED, true) && num(process.env.PORT_GEOTIME, 0) > 0;

/** Hostname aus einer URL ziehen ("https://geotime.lol/" -> "geotime.lol") */
const hostOf = (value) => {
  try {
    return new URL(String(value)).host.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Domains, unter denen GeoTime laufen darf.
 * Alles andere (z. B. laughtime.lol) wird auf die eigene Domain umgeleitet –
 * so taucht GeoTime nie unter einer LaughTime-Adresse auf.
 */
export function geotimeDomains(publicUrl) {
  const own = hostOf(publicUrl);
  const extra = list(process.env.GEOTIME_DOMAINS).map((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  return [...new Set([own, ...extra].filter(Boolean))];
}

/** gemeinsame Einstellungen (gelten für alle Instanzen) */
export function baseConfig() {
  const publicUrl = (process.env.GEOTIME_PUBLIC_URL || 'https://geotime.lol').replace(/\/$/, '');
  return {
    host: process.env.GEOTIME_HOST || process.env.SERVER_HOST || '0.0.0.0',
    publicUrl,
    // eigene Domain(s): Anfragen mit fremdem Host werden hierher umgeleitet
    domains: geotimeDomains(publicUrl),
    // Umleiten nur, wenn eine echte Domain hinterlegt ist (lokal stört das nur)
    enforceDomain: bool(process.env.GEOTIME_ENFORCE_DOMAIN, /^https:\/\//.test(publicUrl)),
    // solange die Seite noch nicht fertig ist: nicht in Suchmaschinen
    noindex: bool(process.env.GEOTIME_NOINDEX, false),
    assetsDir: ASSETS_DIR,
    trustProxy: bool(process.env.GEOTIME_TRUST_PROXY ?? process.env.TRUST_PROXY, true),
    hotReload: bool(process.env.GEOTIME_HOT_RELOAD, true),
    discord: {
      clientId: process.env.GEOTIME_DISCORD_CLIENT_ID || '',
      clientSecret: process.env.GEOTIME_DISCORD_CLIENT_SECRET || '',
      botToken: process.env.GEOTIME_DISCORD_BOT_TOKEN || '',
      publicKey: process.env.GEOTIME_DISCORD_PUBLIC_KEY || '',
      apiUrl: (process.env.GEOTIME_DISCORD_API_URL || 'https://discord.com/api').replace(/\/$/, ''),
      adminIds: list(process.env.GEOTIME_DISCORD_ADMINS),
    },
    // Straßenbilder. Ohne alles läuft GeoTime mit Panoramax: offene
    // Straßenbilder (CC-BY-SA), ohne Anmeldung, ohne Schlüssel. Wer einen
    // kostenlosen Mapillary-Token einträgt, bekommt automatisch Mapillary –
    // die Abdeckung ist weltweit besser.
    pano: {
      provider:
        process.env.GEOTIME_PANO_PROVIDER ||
        (process.env.GEOTIME_MAPILLARY_TOKEN ? 'mapillary' : 'panoramax'),
      token: process.env.GEOTIME_MAPILLARY_TOKEN || '',
      apiUrl: (process.env.GEOTIME_MAPILLARY_API || 'https://graph.mapillary.com').replace(/\/$/, ''),
      panoramaxUrl: (process.env.GEOTIME_PANORAMAX_API || 'https://api.panoramax.xyz/api').replace(/\/$/, ''),
    },
    // Karte zum Raten: Kachelbilder von Esri (Straßenkarte + Luftbild), frei
    // und ohne Schlüssel. Leer lassen = eingebaute Bildkarte. Wer lieber eine
    // Vektorkarte will, trägt hier eine Stil-Adresse ein (z. B. OpenFreeMap).
    map: {
      // Alte .env-Dateien tragen hier noch die OpenFreeMap-Vektorkarte. Die
      // braucht einen Web Worker und bleibt in manchen Builds leer – deshalb
      // gilt dieser eine alte Wert als „nicht gesetzt" und GeoTime nimmt die
      // eingebaute Bildkarte. Jede andere Adresse wird weiter benutzt.
      style: OLD_STYLES.includes((process.env.GEOTIME_MAP_STYLE || '').trim())
        ? ''
        : (process.env.GEOTIME_MAP_STYLE || '').trim(),
    },
    game: {
      maxRooms: num(process.env.GEOTIME_MAX_ROOMS, 200),
      teamSizes: list(process.env.GEOTIME_TEAM_SIZES).length ? list(process.env.GEOTIME_TEAM_SIZES) : ['1v1', '2v2', '5v5'],
      roundMinutes: num(process.env.GEOTIME_ROUND_MINUTES, 15),
      // klassischer Modus (wie GeoGuessr)
      classicRounds: num(process.env.GEOTIME_CLASSIC_ROUNDS, 5),
      classicSeconds: num(process.env.GEOTIME_CLASSIC_SECONDS, 120),
      // Bingo
      bingoSeconds: num(process.env.GEOTIME_BINGO_SECONDS, 600),
      tribunalSeconds: num(process.env.GEOTIME_TRIBUNAL_SECONDS, 45),
      // GeoHunt (Zeit je Runde) und Geo Star (Zeit fürs ganze Spiel)
      huntSeconds: num(process.env.GEOTIME_HUNT_SECONDS, 240),
      starSeconds: num(process.env.GEOTIME_STAR_SECONDS, 300),
    },
  };
}

/**
 * Konfiguration einer Instanz.
 * @param {object} options
 * @param {string} [options.id]       "prod" oder "beta-1"
 * @param {string} [options.channel]  "production" | "beta"
 * @param {number} [options.port]
 */
export function instanceConfig({ id, channel, port } = {}) {
  const cfg = instancesConfig();
  const instanceId = id || cfg.production.id;
  const chan = channel || (instanceId === cfg.production.id ? 'production' : 'beta');
  return {
    ...baseConfig(),
    instanceId,
    channel: chan,
    isBeta: chan === 'beta',
    port: port || num(process.env.PORT_GEOTIME, cfg.production.portFallback),
    // eigene Datenbank im data-Ordner von LaughTime, aber eigene Datei
    dbFile: path.join(DATA_DIR, instanceId === cfg.production.id ? 'geotime.db' : `geotime-${instanceId}.db`),
    updatesDir: path.join(UPDATES_DIR, chan),
  };
}

/** Ordner anlegen (data/ gibt es schon von LaughTime, wir legen nur dazu) */
export function ensureDirs() {
  for (const dir of [DATA_DIR, RUNTIME_DIR, path.join(UPDATES_DIR, 'production'), path.join(UPDATES_DIR, 'beta')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
