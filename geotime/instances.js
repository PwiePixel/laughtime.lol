/**
 * GeoTime.lol – Instanzen im selben Prozess
 *
 * Es gibt KEINE zweite Startdatei: LaughTimes index.js startet alles. Eine
 * GeoTime-Instanz ist deshalb einfach ein weiterer Port im selben Node-Prozess:
 *
 *   prod    PORT_GEOTIME      data/geotime.db          updates/production
 *   beta-1  Port aus dem Pool data/geotime-beta-1.db   updates/beta
 *
 * Jede Instanz hat ihren eigenen WebSocket-Hub, ihre eigene Datenbank und ihren
 * eigenen Update-Kanal. Seiten kommen vom Next.js-Server von LaughTime (ein
 * Build, ein Prozess) – die Instanz reicht sie nur durch und markiert sie mit
 * einem Header, damit /geotime nur über diesen Port erreichbar ist.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { instanceConfig, instancesConfig, betaPortPool } from './config.js';
import { closeDatabase, openDatabase } from './db.js';
import { createRegistry } from './hot/registry.js';
import { createUpdateState, startHotUpdates } from './hot/apply.js';
import { handleApi } from './api.js';
import { serveNextAsset } from './nextassets.js';
import { MIME, OWN_ERROR, enforceDomain, errorPage, robotsTxt, serveAsset, sitemapXml } from './site.js';
import { Hub } from './ws.js';

/**
 * Pfade, die unverändert an Next weitergereicht werden: nur der Build selbst
 * und gemeinsame Schriften/Bilder. Icons, robots.txt und das OG-Bild gehören
 * BEWUSST nicht dazu – die liefert GeoTime aus geotime/assets/ selbst aus,
 * sonst hinge LaughTimes Logo an geotime.lol.
 */
const PASS_THROUGH = /^\/(_next|fonts|images)\//;

export class GeoInstances extends EventEmitter {
  /**
   * @param {object} options
   * @param {number} options.appPort  Port des Next.js-Servers von LaughTime
   * @param {Function} [options.log]
   */
  constructor({ appPort, log = console.log }) {
    super();
    this.appPort = appPort;
    this.log = log;
    /** @type {Map<string, {cfg:any, server:http.Server, hub:Hub, hotStop:Function|null, startedAt:number, by:string}>} */
    this.running = new Map();
  }

  /** Übersicht für die Betriebsansicht und die Konsolenbefehle (nie öffentlich) */
  list() {
    return [...this.running.values()].map(({ cfg, hub, hot, updates, startedAt, by }) => ({
      id: cfg.instanceId,
      channel: cfg.channel,
      port: cfg.port,
      players: hub.clients.size,
      startedAt,
      uptimeMs: Date.now() - startedAt,
      by,
      url: `http://localhost:${cfg.port}`,
      hot: {
        applied: updates?.applied || 0,
        lastApplied: updates?.lastApplied || null,
        lastError: updates?.lastError || null,
        modules: hot?.modules.size || 0,
      },
    }));
  }

  nextId(prefix = 'beta') {
    for (let n = 1; n <= 99; n++) if (!this.running.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
    return `${prefix}-${Date.now().toString(36)}`;
  }

  /** nächster freier Port aus dem erlaubten Pool */
  freePort() {
    const used = new Set([...this.running.values()].map((i) => i.cfg.port));
    return betaPortPool().find((p) => !used.has(p)) ?? null;
  }

  /**
   * Instanz starten (Produktion beim Serverstart, Beta über /beta oder CLI).
   * @param {object} options
   * @param {string} [options.id]
   * @param {string} [options.channel]
   * @param {number} [options.port]
   * @param {string} [options.by]
   */
  async start({ id, channel, port, by = 'system' } = {}) {
    const limits = instancesConfig();
    const instanceId = id || (channel === 'beta' ? this.nextId() : limits.production.id);
    if (this.running.has(instanceId)) throw new Error(`Instanz ${instanceId} läuft schon.`);
    const isBeta = (channel || (instanceId === limits.production.id ? 'production' : 'beta')) === 'beta';
    if (isBeta) {
      const betas = this.list().filter((i) => i.channel === 'beta').length;
      if (betas >= limits.beta.maxInstances) throw new Error(`Es laufen schon ${limits.beta.maxInstances} Beta-Instanzen.`);
    }
    const chosenPort = port || (isBeta ? this.freePort() : undefined);
    if (isBeta && !chosenPort) throw new Error('Kein freier Port (GEOTIME_BETA_PORTS in der .env erweitern).');

    const cfg = instanceConfig({ id: instanceId, channel: isBeta ? 'beta' : 'production', port: chosenPort });
    openDatabase(cfg.instanceId, cfg.dbFile);
    const log = (...m) => this.log(`\x1b[36m[geotime:${cfg.instanceId}]\x1b[0m`, ...m);
    // eigene Hot-Registry + eigener Update-Zustand: ein Beta-Update darf die
    // Produktion im selben Prozess niemals anfassen
    const hot = createRegistry({ id: cfg.instanceId });
    const updates = createUpdateState();
    const hub = new Hub({ cfg, hot, log });

    const startedAt = Date.now();
    const server = http.createServer((req, res) => this.handle(req, res, { cfg, hub, hot, updates, startedAt, log }));
    server.on('upgrade', (req, socket, head) => {
      if (new URL(req.url, 'http://x').pathname === '/geotime-ws') hub.handleUpgrade(req, socket, head);
      else socket.destroy();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(cfg.port, cfg.host, resolve);
    });

    // Hot-Updates dieses Kanals beobachten (Produktion und Beta getrennt)
    hot.context = { cfg, hub, log, updates, instances: this };
    const hotUpdates = cfg.hotReload
      ? startHotUpdates({ dir: cfg.updatesDir, hot, state: updates, log, broadcast: (msg) => hub.broadcast(msg) })
      : null;

    const entry = { cfg, server, hub, hot, updates, hotStop: hotUpdates?.stop ?? null, startedAt, by };
    this.running.set(cfg.instanceId, entry);
    log(`läuft auf Port ${cfg.port} (${cfg.channel}) · DB ${cfg.dbFile.split('/').pop()}`);

    // Beta-Instanzen laufen nicht ewig
    if (isBeta && limits.beta.ttlMinutes) {
      entry.ttl = setTimeout(() => this.stop(cfg.instanceId).catch(() => {}), limits.beta.ttlMinutes * 60_000);
      entry.ttl.unref?.();
    }
    this.emit('started', { id: cfg.instanceId, port: cfg.port, channel: cfg.channel });
    return { id: cfg.instanceId, port: cfg.port, channel: cfg.channel, url: `http://localhost:${cfg.port}` };
  }

  async stop(id) {
    const entry = this.running.get(id);
    if (!entry) throw new Error(`Instanz ${id} läuft nicht.`);
    clearTimeout(entry.ttl);
    entry.hotStop?.();
    entry.hub.close();
    await new Promise((resolve) => entry.server.close(resolve));
    closeDatabase(id);
    this.running.delete(id);
    this.log(`\x1b[36m[geotime:${id}]\x1b[0m gestoppt`);
    this.emit('stopped', { id });
    return { id };
  }

  async stopAll() {
    for (const id of [...this.running.keys()]) await this.stop(id).catch(() => {});
  }

  /** eine Anfrage auf einem GeoTime-Port bedienen */
  async handle(req, res, ctx) {
    const url = new URL(req.url, 'http://localhost');
    try {
      // 1. eigene Domain erzwingen (laughtime.lol landet nie auf GeoTime)
      if (enforceDomain(req, res, url, ctx.cfg)) return;
      // 2. eigene API (Status, Instanzen, Discord, Spiel)
      if (url.pathname.startsWith('/geotime-api/')) {
        const done = await handleApi(req, res, url, { ...ctx, instances: this });
        if (done) return;
      }
      // 3. Dateien aus updates/<channel>/public/ gehen vor (ohne Build, ohne Neustart)
      if (this.serveOverride(req, res, url, ctx)) return;
      // 4. eigene Dateien: Icon, Apple-Icon, OG-Bild
      if (serveAsset(req, res, url, ctx.cfg)) return;
      // 4b. Arbeiterdateien aus dem Build, deren Namen der Bundler nicht
      //     angepasst hat (sonst bleibt die Karte leer – siehe nextassets.js)
      if (serveNextAsset(req, res)) return;
      // 5. eigene robots.txt / sitemap.xml mit der eigenen Domain
      if (url.pathname === '/robots.txt') return this.text(res, robotsTxt(ctx.cfg), 'text/plain; charset=utf-8');
      if (url.pathname === '/sitemap.xml') return this.text(res, sitemapXml(ctx.cfg), 'application/xml; charset=utf-8');
      // alles andere rendert der Next.js-Server von LaughTime –
      // mit /geotime-Präfix und Kennzeichen, damit es nur hier erreichbar ist
      return this.proxy(req, res, url, ctx.cfg);
    } catch (err) {
      ctx.log('http', err.message);
      return this.fail(res, 502, ctx.cfg);
    }
  }

  /** kleine Textantwort (robots.txt, sitemap.xml) */
  text(res, body, type) {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
    res.end(body);
    return undefined;
  }

  /** eigene Fehlerseite – nie eine Seite von LaughTime auf einer GeoTime-Adresse */
  fail(res, status, cfg) {
    if (res.headersSent) return res.end();
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(errorPage(status, cfg));
  }

  /**
   * Datei aus updates/<channel>/public/ ausliefern, falls es eine gibt.
   * @returns {boolean} true = beantwortet
   */
  serveOverride(req, res, url, ctx) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const file = ctx.updates?.staticOverrides.get(url.pathname);
    if (!file) return false;
    let st;
    try {
      st = fs.statSync(file);
      if (!st.isFile()) return false;
    } catch {
      return false;
    }
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) return false; // unbekannte Dateitypen lieber gar nicht ausliefern
    // bewusst ohne Hinweis auf Kanal oder Instanz im Antwort-Header
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return (res.end(), true);
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return true;
  }

  /**
   * Anfrage an den Next.js-Server von LaughTime weiterreichen.
   *
   * Nach außen ist GeoTime eine eigene Seite: der Browser sieht nur
   * geotime.lol/…  Intern liegen die Seiten im gemeinsamen Build unter
   * /geotime – dieses Präfix wird hier davor gesetzt und aus Weiterleitungen
   * wieder herausgenommen, damit es nie in der Adresszeile landet.
   */
  proxy(req, res, url, cfg) {
    const target = PASS_THROUGH.test(url.pathname)
      ? url.pathname + url.search
      : `/geotime${url.pathname === '/' ? '' : url.pathname}${url.search}`;
    const proxied = http.request(
      {
        host: '127.0.0.1',
        port: this.appPort,
        method: req.method,
        path: target,
        headers: {
          ...req.headers,
          host: req.headers.host,
          // nur mit diesem Kennzeichen liefert Next die GeoTime-Seiten aus
          'x-geotime-instance': cfg.instanceId,
          'x-geotime-channel': cfg.channel,
        },
      },
      (upstream) => {
        const status = upstream.statusCode || 502;
        // Fehlerseiten kommen von GeoTime selbst – sonst stünde bei einem
        // Serverfehler die Seite von LaughTime auf geotime.lol.
        // Dateien (_next, Bilder, Schriften) bleiben davon unberührt, die
        // brauchen keine HTML-Seite.
        if (OWN_ERROR(status) && !PASS_THROUGH.test(url.pathname)) {
          upstream.resume();
          return this.fail(res, status, cfg);
        }
        const headers = { ...upstream.headers };
        // "/geotime/x" in Weiterleitungen -> "/x" (die Adresszeile bleibt sauber)
        if (headers.location) headers.location = stripPrefix(headers.location);
        res.writeHead(status, headers);
        return upstream.pipe(res);
      },
    );
    proxied.on('error', () => this.fail(res, 502, cfg));
    req.pipe(proxied);
    return undefined;
  }
}

/** "/geotime/play" -> "/play" (auch in absoluten URLs) */
function stripPrefix(location) {
  try {
    if (/^https?:\/\//i.test(location)) {
      const u = new URL(location);
      u.pathname = u.pathname.replace(/^\/geotime(?=\/|$)/, '') || '/';
      return u.toString();
    }
  } catch {
    return location;
  }
  return location.replace(/^\/geotime(?=\/|$)/, '') || '/';
}
