/**
 * GeoTime.lol – Datei-Watcher für den updates/-Ordner
 *
 * Ablauf eines Updates (ohne Neustart):
 *   1. Neue Dateien nach  updates/production/  bzw.  updates/beta/  kopieren
 *      - updates/<channel>/server/**      -> Server-Module (werden hot geladen)
 *      - updates/<channel>/public/**      -> statische Dateien (überschreiben /public)
 *      - updates/<channel>/config/*.json  -> Konfiguration (Bingo-Begriffe etc.)
 *   2. Der Watcher sammelt Änderungen, wartet kurz (Debounce, damit halb
 *      kopierte Dateien nicht zu früh geladen werden) und ruft applyUpdate() auf.
 *   3. applyUpdate tauscht die Module aus und sagt allen Spielern Bescheid.
 *
 * Bewusst ohne zusätzliche Abhängigkeit: node:fs.watch kann seit Node 20
 * rekursiv, und das Image von Pterodactyl bringt Node 22/24 mit. Wer lieber
 * chokidar nutzt, kann `createWatcher` austauschen – die Schnittstelle bleibt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const DEFAULT_DEBOUNCE = 400;
const IGNORED = /(^|[\\/])(\.|node_modules|~|.*\.(swp|tmp|part|crdownload)$)/;

export class UpdateWatcher extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.dir        updates/<channel>
   * @param {number} [options.debounce] Wartezeit, bis eine Kopie als fertig gilt
   */
  constructor({ dir, debounce = DEFAULT_DEBOUNCE }) {
    super();
    this.dir = dir;
    this.debounce = debounce;
    this.pending = new Set();
    this.timer = null;
    this.watcher = null;
    this.stableTries = 0;
  }

  start() {
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      this.watcher = fs.watch(this.dir, { recursive: true, persistent: false }, (_event, file) => {
        if (!file || IGNORED.test(file)) return;
        this.pending.add(file.split(path.sep).join('/'));
        this.schedule();
      });
    } catch (err) {
      // z. B. wenn das Dateisystem kein recursive kann: alle 5 s nachsehen
      this.emit('warn', `fs.watch nicht verfügbar (${err.message}) – Fallback auf Polling`);
      this.poll = setInterval(() => this.scanOnce(), 5000);
      this.poll.unref?.();
    }
    this.emit('started', this.dir);
    return this;
  }

  /** Einmal durchsehen (Polling-Fallback): neue, geänderte und gelöschte Dateien */
  scanOnce() {
    const since = this.lastScan || 0;
    this.lastScan = Date.now();
    const seen = new Set();
    const walk = (dir, rel = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (IGNORED.test(entry.name)) continue;
        if (entry.isDirectory()) walk(abs, relPath);
        else {
          seen.add(relPath);
          if (fs.statSync(abs).mtimeMs > since) this.pending.add(relPath);
        }
      }
    };
    try {
      walk(this.dir);
    } catch {
      /* Ordner wurde gerade ersetzt */
      return;
    }
    // was beim letzten Lauf noch da war und jetzt fehlt, wurde gelöscht
    for (const old of this.known || []) if (!seen.has(old)) this.pending.add(old);
    this.known = seen;
    if (this.pending.size) this.schedule();
  }

  /** Änderungen sammeln und erst feuern, wenn eine Weile nichts mehr passiert */
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounce);
    this.timer.unref?.();
  }

  async flush() {
    // gelöschte Dateien bleiben bewusst in der Liste: applyUpdate nimmt das
    // Update dann wieder zurück (safeSize liefert -1, gilt also als "stabil")
    const files = [...this.pending];
    this.pending.clear();
    if (!files.length) return;
    // zweite Sicherung: Dateigrößen müssen zwei Messungen lang gleich bleiben
    const sizes = files.map((f) => safeSize(path.join(this.dir, f)));
    await new Promise((r) => setTimeout(r, 150));
    const stable = files.every((f, i) => safeSize(path.join(this.dir, f)) === sizes[i]);
    if (!stable) {
      files.forEach((f) => this.pending.add(f));
      this.schedule();
      return;
    }
    this.emit('changed', files);
  }

  stop() {
    clearTimeout(this.timer);
    clearInterval(this.poll);
    this.watcher?.close();
    this.watcher = null;
    this.emit('stopped');
  }
}

function safeSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}

export const createWatcher = (options) => new UpdateWatcher(options);
