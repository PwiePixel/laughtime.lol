// Test harness for the game server: fake sockets through attachGame, mocked
// timers, a temporary database and no network. Used by test/game-*.test.js.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import { restoreHand } from '../lib/shared.js';

export const START = 1_800_000_000_000;

let ready = null;
let seq = 0;

/** one browser tab */
export class Client {
  constructor(env, { name, pid, account = null } = {}) {
    seq += 1;
    this.env = env;
    this.pid = pid || `player-${String(seq).padStart(4, '0')}`;
    this.secret = `secret-${this.pid}-0123456789`;
    this.name = name || `P${seq}`;
    this.account = account;
    this.state = null;
    this.wire = null;
    this.bytes = 0;
    this.msgs = [];
    this.ws = null;
  }

  /** opens a socket (no hello yet) */
  open() {
    const ws = new EventEmitter();
    ws.readyState = 1;
    // like the browser: the tray comes once per connection and is put back into later states
    let tray = null;
    ws.send = (data) => {
      const msg = JSON.parse(data);
      this.msgs.push(msg);
      this.bytes += data.length;
      if (msg.t !== 'state') return;
      this.wire = JSON.parse(data).state; // exactly what was sent
      tray = restoreHand(msg.state, tray);
      this.state = msg.state;
    };
    ws.ping = () => {};
    ws.terminate = () => {};
    ws.close = () => {};
    if (this.account) ws.account = this.account;
    this.ws = ws;
    this.env.clients.add(this);
    this.env.wss.clients.add(ws);
    this.env.wss.emit('connection', ws);
    return this;
  }

  join(code) {
    this.open();
    this.send({ t: 'hello', code, pid: this.pid, secret: this.secret, name: this.name, avatar: 'cat|1' });
    return this;
  }

  send(msg) {
    this.ws.bucket = 30; // the rate limit is not what these tests are about
    this.ws.emit('message', Buffer.from(JSON.stringify(msg)), false);
    return this;
  }

  /** connection lost (tab closed, phone locked) */
  drop() {
    this.ws.readyState = 3;
    this.env.wss.clients.delete(this.ws);
    this.ws.emit('close');
    return this;
  }

  /** messages of one type since the last call */
  take(type) {
    const hits = this.msgs.filter((m) => m.t === type);
    this.msgs = this.msgs.filter((m) => m.t !== type);
    return hits;
  }

  errors() {
    return this.take('error').map((m) => m.code);
  }

  me() {
    return this.state.players.find((p) => p.id === this.pid);
  }
}

export const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

/** boots the game module once per test file */
export function setupGame(env = {}) {
  if (ready) return ready;
  ready = (async () => {
    Object.assign(
      process.env,
      {
        IMGFLIP_ENABLED: 'false',
        REDDIT_ENABLED: 'false',
        GIPHY_API_KEY: '',
        KLIPY_API_KEY: '',
        MIN_PLAYERS: '2',
        HUNT_SEARCHES: '2',
        MATCH_MIN_PLAYERS: '2',
        MATCH_MAX_PLAYERS: '8',
        MATCH_WAIT_SECONDS: '1',
      },
      env,
    );
    // nothing in these tests may reach the network
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-game-'));
    const db = await import('../server/db.js');
    await db.openDatabase(path.join(dir, 'test.db'));
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
    const game = await import('../server/game.js');
    const wss = new EventEmitter();
    wss.clients = new Set();
    game.attachGame(wss);
    const ctx = {
      game,
      db,
      wss,
      dir,
      clients: new Set(),
      uploads: [],
      now: () => Date.now(),
      /** let the clock run and give promises a chance to settle */
      async advance(ms) {
        // millisecond steps: a timer that fires sees its own time, so timers started by timers stay exact
        for (let i = 0; i < ms; i++) mock.timers.tick(1);
        await flush();
      },
      client: (opts) => new Client(ctx, opts),
      /** an account in the database, usable as ws.account */
      account(username) {
        const t = Date.now();
        db.run('INSERT INTO users (username, display_name, avatar, created_at, last_seen) VALUES (?, ?, ?, ?, ?)', username, username, 'cat|1', t, t);
        const row = db.get('SELECT id FROM users WHERE username = ?', username);
        return { id: row.id, username, displayName: username, avatar: 'cat|1' };
      },
      /** a private room with `n` joined players (the first one is the host) */
      async room(n, { game: mode = 'classic', channel = 'stable', settings = null, names = [] } = {}) {
        const room = game.createRoom({ game: mode, channel });
        const players = [];
        for (let i = 0; i < n; i++) {
          players.push(ctx.client({ name: names[i] }).join(room.code));
          await ctx.advance(5); // distinct join times
        }
        if (settings) players[0].send({ t: 'settings', settings: { ...players[0].state.settings, ...settings } });
        return { room, code: room.code, players, host: players[0] };
      },
      async start(host) {
        host.send({ t: 'start' });
        await flush();
      },
      /**
       * Replaces the media search. `answers`: { term: items } or a function (q, opts) => items.
       * Returns the list of calls that reached the "provider".
       */
      search(answers = (q) => hits(q)) {
        const calls = [];
        game._test.setSearch(async (q, opts) => {
          calls.push(q);
          return typeof answers === 'function' ? answers(q, opts) : answers[q] || [];
        });
        return calls;
      },
      /** uploads a picture in the bring phase of a swap round, like the HTTP route does */
      async upload(client, code) {
        const { sniffImage, UPLOAD_DIR } = await import('../server/uploads.js');
        const res = await game.handleRoomUpload(code, client.pid, client.secret, { buf: PNG, info: sniffImage(PNG), name: `secret name of ${client.name}` });
        ctx.uploads.push(path.join(UPLOAD_DIR, client.state.upload.mine.media.src.replace('/api/uploads/', '')));
        return res;
      },
      /** everybody leaves; empty rooms are closed and their uploaded files deleted */
      async shutdown() {
        for (const c of ctx.clients) if (c.ws.readyState === 1) c.drop();
        mock.timers.tick(11 * 60 * 1000);
        await ctx.until(() => ctx.uploads.every((file) => !fs.existsSync(file)), 'uploaded files to be deleted');
      },
      /** waits for real I/O (files, database) */
      async until(check, what = 'condition') {
        for (let i = 0; i < 5000; i++) {
          if (check()) return;
          await new Promise((r) => setImmediate(r));
        }
        throw new Error(`timeout waiting for ${what}`);
      },
    };
    return ctx;
  })();
  return ready;
}

/** search hits as a provider would return them: `hits('cats', 20)` */
export function hits(q, n = 20, kind = 'video') {
  return Array.from({ length: n }, (_, i) => ({
    id: `test:${q}:${i}`,
    kind,
    url: `https://media.test/${encodeURIComponent(q)}/${i}.${kind === 'video' ? 'mp4' : 'jpg'}`,
    thumb: `https://media.test/${encodeURIComponent(q)}/${i}-small.jpg`,
    width: 480,
    height: 270,
    title: `${q} ${i}`,
    source: 'giphy',
    link: `https://media.test/view/${i}`,
  }));
}

/** the smallest picture the upload code accepts (1x1 PNG) */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** id of the original media behind a proxied address */
export const originalUrl = (media) => new URL(media.src, 'http://x').searchParams.get('u');

export const caption = (text) => [{ text, x: 50, y: 12, w: 92, size: 8, color: '#FFFFFF', upper: true }];
