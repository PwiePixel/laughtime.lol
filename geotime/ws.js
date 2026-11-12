/**
 * GeoTime.lol – WebSocket-Hub (eine Instanz = ein Hub)
 *
 * Der Hub überlebt jedes Hot-Update: Verbindungen bleiben offen, nur die
 * Spiellogik dahinter (geotime/game/*.js) wird ausgetauscht. Deshalb hält der
 * Hub selbst keine Regeln, sondern fragt immer die Hot-Registry SEINER Instanz
 * (prod und beta haben getrennte Registries – ein Beta-Update ändert nie die
 * Produktion).
 *
 * Der Pfad ist /geotime-ws, damit er sich nie mit dem /ws von LaughTime beißt.
 */
import { WebSocketServer } from 'ws';
import { playerFor } from './accounts.js';

export class Hub {
  /**
   * @param {object} options
   * @param {object} options.cfg  Instanz-Konfiguration
   * @param {import('./hot/registry.js').HotRegistry} options.hot  Registry dieser Instanz
   */
  constructor({ cfg, hot, log = console.log } = {}) {
    this.cfg = cfg;
    this.hot = hot;
    this.log = log;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
    this.clients = new Set();
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.heartbeat = setInterval(() => this.sweep(), 30_000);
    this.heartbeat.unref?.();
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  }

  async onConnection(ws, req) {
    ws.isAlive = true;
    ws.cfg = this.cfg;
    // wer angemeldet ist, bekommt seine Ergebnisse in der Bestenliste gutgeschrieben
    ws.account = playerFor(req, this.cfg.instanceId);
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    this.clients.add(ws);
    ws.on('close', async () => {
      this.clients.delete(ws);
      const game = await this.hot.load('game/rooms.js').catch(() => null);
      game?.onClose?.(ws, { hub: this, hot: this.hot, cfg: this.cfg });
    });
    ws.on('message', async (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      try {
        const game = await this.hot.load('game/rooms.js');
        await game.handleMessage?.(ws, msg, { hub: this, hot: this.hot, req, cfg: this.cfg });
      } catch (err) {
        this.log(`ws ${msg.t}: ${err.message}`);
        this.send(ws, { t: 'error', code: 'server_error' });
      }
    });
    const game = await this.hot.load('game/rooms.js').catch(() => null);
    game?.onConnect?.(ws, { hub: this, hot: this.hot, req, cfg: this.cfg });
  }

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const text = JSON.stringify(msg);
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(text);
  }

  sweep() {
    for (const ws of this.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        this.clients.delete(ws);
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  close(code = 1012, reason = 'instance stopped') {
    clearInterval(this.heartbeat);
    for (const ws of this.clients) ws.close(code, reason);
    this.clients.clear();
  }
}
