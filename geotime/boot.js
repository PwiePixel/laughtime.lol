/**
 * GeoTime.lol – Start aus LaughTimes index.js
 *
 * LaughTime bleibt die einzige Startdatei. Nachdem der LaughTime-Server läuft,
 * ruft index.js einmal startGeotime() auf. Ab da hört GeoTime auf seinem
 * eigenen Port (PORT_GEOTIME), mit eigener Datenbank (data/geotime.db),
 * eigenem WebSocket (/geotime-ws) und eigenen Hot-Updates.
 *
 * Ist PORT_GEOTIME nicht gesetzt oder GEOTIME_ENABLED=false, passiert nichts –
 * LaughTime läuft dann wie bisher allein.
 */
import { ensureDirs, geotimeEnabled, instanceConfig } from './config.js';
import { closeAll } from './db.js';
import { registerCommands } from './discord.js';
import { GeoInstances } from './instances.js';

let instances = null;

/**
 * @param {object} options
 * @param {number} options.appPort  Port, auf dem der Next.js-Server von LaughTime läuft
 */
export async function startGeotime({ appPort, log = console.log } = {}) {
  if (!geotimeEnabled()) {
    log('\x1b[36m[geotime]\x1b[0m aus (PORT_GEOTIME fehlt oder GEOTIME_ENABLED=false)');
    return null;
  }
  ensureDirs();
  instances = new GeoInstances({ appPort, log });

  const cfg = instanceConfig({});
  await instances.start({ id: cfg.instanceId, channel: 'production', port: cfg.port, by: 'start' });

  // /beta bei Discord anmelden (nur wenn Bot-Token hinterlegt ist)
  registerCommands(cfg, { log: (...m) => log('\x1b[36m[geotime]\x1b[0m', ...m) }).catch(() => {});

  // sauber herunterfahren, wenn Pterodactyl den Container stoppt
  const shutdown = async () => {
    await instances?.stopAll();
    closeAll();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return instances;
}

export const getInstances = () => instances;
