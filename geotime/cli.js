#!/usr/bin/env node
/**
 * GeoTime.lol – Instanzen aus der Konsole steuern
 *
 * Die Instanzen laufen im Prozess von LaughTime, deshalb redet die CLI über
 * HTTP mit dem laufenden Server (kein zweiter Prozess, keine zweite Startdatei):
 *
 *   node geotime/cli.js list
 *   node geotime/cli.js beta            neue Beta-Instanz
 *   node geotime/cli.js stop beta-1
 *
 * Dafür muss GEOTIME_ADMIN_TOKEN in der .env stehen (Schutz vor Fremdzugriff).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

// .env von LaughTime lesen (dieselbe Datei, nur lesen)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i > 0 && !process.env[s.slice(0, i).trim()]) process.env[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

const port = process.env.PORT_GEOTIME || 3001;
const token = process.env.GEOTIME_ADMIN_TOKEN || '';
const base = `http://127.0.0.1:${port}/geotime-api/instances`;
const args = process.argv.slice(2);
const cmd = args[0] || 'list';

const call = async (method, body) => {
  const res = await fetch(base, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

try {
  if (cmd === 'list') {
    const { instances } = await call('GET');
    if (!instances.length) console.log('Keine Instanz läuft.');
    for (const i of instances) {
      console.log(`${i.id.padEnd(8)} Port ${String(i.port).padEnd(6)} ${i.channel.padEnd(11)} ${i.players} Spieler · seit ${Math.round(i.uptimeMs / 60000)} min`);
    }
  } else if (cmd === 'beta' || cmd === 'start') {
    const res = await call('POST', { action: 'start', id: args[1], by: 'cli' });
    console.log(`Beta-Instanz ${res.id} läuft auf Port ${res.port}.`);
    console.log('Dateien in geotime/updates/beta/ greifen sofort – ohne Neustart.');
  } else if (cmd === 'stop') {
    if (!args[1]) throw new Error('Welche Instanz? node geotime/cli.js stop beta-1');
    await call('POST', { action: 'stop', id: args[1] });
    console.log(`Instanz ${args[1]} gestoppt.`);
  } else {
    console.log('Befehle: list | beta [id] | stop <id>');
  }
} catch (err) {
  console.error(`Fehler: ${err.message}`);
  if (/unauthorized/.test(err.message)) console.error('GEOTIME_ADMIN_TOKEN in der .env setzen.');
  process.exitCode = 1;
}
