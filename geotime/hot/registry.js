/**
 * GeoTime.lol – Hot-Module-Registry
 *
 * Idee: Der Kern (HTTP-Server, WebSocket-Hub, Datenbank) bleibt immer geladen.
 * Alles, was sich oft ändert (Spielregeln, Bingo-Begriffe, API-Routen), liegt in
 * austauschbaren Modulen und wird NUR über diese Registry benutzt:
 *
 *     const rules = await ctx.hot.load('game/rules.js');
 *     rules.checkBingo(...)
 *
 * Beim Neuladen bekommt der Import eine neue Versionsnummer (?v=…), dadurch
 * umgeht er den ESM-Cache von Node. Offene WebSockets bleiben bestehen, weil
 * der Hub im Kern lebt und nur die Funktionen ausgetauscht werden.
 *
 * WICHTIG: Jede Instanz (prod, beta-1, …) bekommt ihre EIGENE Registry
 * (createRegistry()). Nur so kann ein Update im Beta-Kanal die Produktion nicht
 * anfassen – beide laufen im selben Node-Prozess.
 *
 * Module dürfen optional zwei Lebenszyklus-Funktionen exportieren:
 *   export async function onLoad(ctx)     – nach dem Laden (Zustand übernehmen)
 *   export async function onUnload(ctx)   – vor dem Austausch (Timer aufräumen)
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { GEOTIME_DIR } from '../paths.js';

let counter = 0;

export class HotRegistry extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} [options.id]      Name der Instanz (nur für Logs/Import-URL)
   * @param {string} [options.baseDir] Basisordner der austauschbaren Module
   * @param {object} [options.context] wird den Modulen in onLoad/onUnload gegeben
   */
  constructor({ id, baseDir = GEOTIME_DIR, context = {} } = {}) {
    super();
    this.id = id || `r${++counter}`;
    this.baseDir = baseDir;
    this.context = context;
    /** @type {Map<string, {module: any, version: number, file: string, loadedAt: number}>} */
    this.modules = new Map();
    this.overrides = new Map(); // Modulpfad -> Datei aus updates/ (hat Vorrang)
  }

  /** Datei, die aktuell für einen Modulpfad gilt (updates/ gewinnt über geotime/) */
  fileFor(id) {
    return this.overrides.get(id) || path.join(this.baseDir, id);
  }

  /** Eine Datei aus updates/ vor die Standarddatei schieben (oder wieder entfernen) */
  setOverride(id, file) {
    if (file) this.overrides.set(id, file);
    else this.overrides.delete(id);
  }

  /** Modul laden (aus dem Cache, wenn schon geladen) */
  async load(id) {
    const entry = this.modules.get(id);
    if (entry) return entry.module;
    return this.reload(id);
  }

  /** Modul neu laden und den ESM-Cache umgehen */
  async reload(id) {
    const file = this.fileFor(id);
    if (!fs.existsSync(file)) throw new Error(`hot: ${id} nicht gefunden (${file})`);
    const previous = this.modules.get(id);
    const version = (previous?.version ?? 0) + 1;
    // die Instanz-Kennung sorgt dafür, dass prod und beta NIE dasselbe
    // Modulobjekt (und damit denselben Spielzustand) benutzen
    const url = `${pathToFileURL(file).href}?i=${encodeURIComponent(this.id)}&v=${version}-${Date.now()}`;
    let next;
    try {
      next = await import(url);
    } catch (err) {
      // defekte Updates dürfen die laufende Instanz nicht mitreißen
      this.emit('error', { id, file, error: err });
      if (previous) return previous.module;
      throw err;
    }
    if (previous?.module?.onUnload) {
      try {
        await previous.module.onUnload(this.context);
      } catch (err) {
        this.emit('error', { id, file, error: err, phase: 'onUnload' });
      }
    }
    if (next.onLoad) {
      try {
        await next.onLoad({ ...this.context, hot: this, previous: previous?.module ?? null });
      } catch (err) {
        this.emit('error', { id, file, error: err, phase: 'onLoad' });
        if (previous) return previous.module; // altes Modul weiterbenutzen
      }
    }
    this.modules.set(id, { module: next, version, file, loadedAt: Date.now() });
    this.emit('reloaded', { id, file, version });
    return next;
  }

  /** Modul vergessen (z. B. wenn ein Update gelöscht wurde und es kein Original gibt) */
  async drop(id) {
    const entry = this.modules.get(id);
    if (!entry) return false;
    this.modules.delete(id);
    if (entry.module?.onUnload) {
      try {
        await entry.module.onUnload(this.context);
      } catch (err) {
        this.emit('error', { id, file: entry.file, error: err, phase: 'onUnload' });
      }
    }
    return true;
  }

  /** Alle geladenen Module neu laden (z. B. nach einem größeren Update-Paket) */
  async reloadAll() {
    const ids = [...this.modules.keys()];
    for (const id of ids) await this.reload(id);
    return ids;
  }

  /** Überblick für /geotime-api/status und den Instanz-Manager */
  list() {
    return [...this.modules.entries()].map(([id, e]) => ({
      id,
      version: e.version,
      file: path.relative(GEOTIME_DIR, e.file),
      loadedAt: e.loadedAt,
      override: this.overrides.has(id),
    }));
  }
}

/** Jede Instanz bekommt ihre eigene Registry – niemals eine gemeinsame. */
export const createRegistry = (options) => new HotRegistry(options);
