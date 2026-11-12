/**
 * GeoTime.lol – Updates anwenden
 *
 * Was in updates/<channel>/ liegt, gilt für die laufende Instanz:
 *
 *   <modul>.js     -> Modul wird neu geladen (hot.setOverride + hot.reload)
 *   public/**      -> Datei wird sofort ausgeliefert (statischer Override)
 *   config/*.json  -> Konfiguration wird neu eingelesen
 *
 * Wird eine Datei aus updates/ wieder gelöscht, zieht die Instanz das Update
 * automatisch zurück und benutzt wieder das Original aus geotime/.
 *
 * Spieler merken davon nichts: WebSockets bleiben offen, nur die Funktionen
 * dahinter sind neu. Für Änderungen an der Oberfläche schickt der Server ein
 * "update"-Signal; der Client lädt erst neu, wenn gerade keine Runde läuft.
 *
 * WICHTIG: Jede Instanz bekommt ihren eigenen Zustand (createUpdateState()) und
 * ihre eigene Registry. Ein Update im Beta-Kanal fasst die Produktion nie an.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createWatcher } from './watcher.js';

/** Stand der zuletzt angewendeten Updates einer Instanz (für /geotime-api/status) */
export function createUpdateState() {
  return {
    lastApplied: null,
    lastError: null,
    applied: 0,
    files: [],
    staticOverrides: new Map(), // "/bild.png" -> absoluter Pfad in updates/
    config: {}, // zusätzliche Konfiguration aus updates/<channel>/config/*.json
  };
}

/**
 * Wofür ist eine Datei aus updates/<kanal>/ gedacht?
 *   public/…        -> wird sofort ausgeliefert (ohne Build)
 *   config/*.json   -> Konfiguration, wird neu eingelesen
 *   alles andere .js -> Modul aus geotime/ (z. B. game/rules.js, api/routes.js)
 */
function classify(rel) {
  if (rel.startsWith('public/')) return { kind: 'static', url: `/${rel.slice('public/'.length)}` };
  if (rel.startsWith('config/') && rel.endsWith('.json')) return { kind: 'config', name: path.basename(rel, '.json') };
  const id = rel.startsWith('server/') ? rel.slice('server/'.length) : rel; // "server/" bleibt erlaubt
  if (/\.(js|mjs)$/.test(id)) return { kind: 'module', id };
  return { kind: 'ignored' };
}

/**
 * Wendet die gefundenen Dateien an (neue/geänderte genauso wie gelöschte).
 * @param {string[]} files  Pfade relativ zu updates/<channel>
 * @param {object} deps     { dir, hot, state, log, broadcast }
 */
export async function applyUpdate(files, { dir, hot, state, log = console.log, broadcast = () => {} } = {}) {
  const changed = { modules: [], statics: [], config: [], removed: [] };
  const errors = [];

  for (const rel of files) {
    const abs = path.join(dir, rel);
    const info = classify(rel);
    if (info.kind === 'ignored') continue;
    let exists = false;
    try {
      exists = fs.statSync(abs).isFile();
    } catch {
      exists = false;
    }
    try {
      if (info.kind === 'module') {
        if (exists) {
          hot.setOverride(info.id, abs);
          // nur Module neu laden, die die Instanz auch benutzt
          if (hot.modules.has(info.id)) await hot.reload(info.id);
          changed.modules.push(info.id);
        } else if (hot.overrides.get(info.id) === abs) {
          // Update zurückgenommen -> wieder das Original aus geotime/ benutzen
          hot.setOverride(info.id, null);
          if (hot.modules.has(info.id)) {
            if (fs.existsSync(hot.fileFor(info.id))) await hot.reload(info.id);
            else await hot.drop(info.id); // es gab nie ein Original
          }
          changed.removed.push(info.id);
        }
      } else if (info.kind === 'static') {
        if (exists) {
          state.staticOverrides.set(info.url, abs);
          changed.statics.push(info.url);
        } else if (state.staticOverrides.get(info.url) === abs) {
          state.staticOverrides.delete(info.url);
          changed.removed.push(info.url);
          changed.statics.push(info.url); // Clients müssen neu laden
        }
      } else if (info.kind === 'config') {
        if (exists) {
          state.config[info.name] = JSON.parse(fs.readFileSync(abs, 'utf8'));
          changed.config.push(info.name);
        } else if (info.name in state.config) {
          delete state.config[info.name];
          changed.removed.push(info.name);
        }
      }
    } catch (err) {
      errors.push({ file: rel, error: err.message });
      log(`Update fehlgeschlagen: ${rel} – ${err.message}`);
    }
  }

  const touched = changed.modules.length + changed.statics.length + changed.config.length + changed.removed.length;
  if (touched) {
    state.lastApplied = Date.now();
    state.applied += 1;
    state.files = files;
    state.lastError = errors.length ? errors : null;
    log(
      `Update übernommen: ${changed.modules.length} Module, ${changed.statics.length} Dateien, ` +
        `${changed.config.length} Configs` +
        (changed.removed.length ? `, ${changed.removed.length} zurückgenommen` : '') +
        (errors.length ? ` (${errors.length} Fehler)` : ''),
    );
    // Clients informieren – der Client entscheidet, wann er neu lädt
    broadcast({ t: 'update', at: state.lastApplied, reload: changed.statics.length > 0, modules: changed.modules });
  }
  return { changed, errors };
}

/**
 * Watcher starten und Updates automatisch anwenden.
 * @param {object} options { dir, hot, state, log, broadcast }
 * @returns {{ stop: () => void, watcher: import('./watcher.js').UpdateWatcher }}
 */
export function startHotUpdates({ dir, hot, state, log = console.log, broadcast = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const watcher = createWatcher({ dir });
  watcher.on('warn', (m) => log(m));
  watcher.on('changed', (files) => {
    applyUpdate(files, { dir, hot, state, log, broadcast }).catch((err) => {
      state.lastError = err.message;
      log(`Update-Fehler: ${err.message}`);
    });
  });
  hot.on('error', ({ id, error, phase }) => log(`Hot-Modul ${id}${phase ? ` (${phase})` : ''}: ${error.message}`));
  hot.on('reloaded', ({ id, version }) => log(`Modul neu geladen: ${id} (v${version})`));
  watcher.start();
  // beim Start einmal alles einlesen, was schon im Ordner liegt
  const existing = listFiles(dir);
  if (existing.length) applyUpdate(existing, { dir, hot, state, log, broadcast }).catch(() => {});
  return { watcher, stop: () => watcher.stop() };
}

export function listFiles(dir, rel = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'README.md') continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), relPath));
    else out.push(relPath);
  }
  return out;
}
