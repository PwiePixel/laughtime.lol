import http from 'node:http';
import next from 'next';
import { WebSocketServer } from 'ws';
import { ROOM_CODE_RE } from '../lib/shared.js';
import { isAdmin, purgeExpiredSessions, userFromRequest } from './accounts.js';
import { activityFramePolicy, isActivityRequest } from './activity.js';
import { handleApi } from './api.js';
import { requestChannel } from './channel.js';
import { ROOT, getConfig } from './config.js';
import { openDatabase } from './db.js';
import { attachGame, createRoom, handleRoomUpload, publicStats, roomInfo, stats } from './game.js';
import { readUpload, serveUpload, sweepRoomUploads } from './uploads.js';
import { HttpError, checkOrigin, clientIp, createLimiter, json, readJson } from './http.js';
import { queueSizes } from './matchmaking.js';
import { activeSanction, hashIp, purgeModeration, sampleMetrics } from './moderation.js';
import { packForGame } from './packs.js';
import { activeSourceNames, mediaStatus, pickMedia, startMediaPool } from './media/index.js';
import { performanceStatus } from './media/status.js';
import { handleMediaRequest, proxyUrl, sweepCache, warmMedia } from './proxy.js';
import { apiCache, compressJson, invalidateAfterWrite } from './lib/respond.js';

// One HTTP server for everything:
//   /ws                -> WebSocket game server
//   /api/media         -> media proxy (cached)
//   /api/rooms         -> create room (POST) / room info (GET /api/rooms/CODE)
//   /api/status        -> health + media source status
//   /api/auth/*, /api/me, /api/users/*, /api/leaderboard, /api/memes*  -> accounts & community (api.js)
//   everything else    -> Next.js

const roomLimiter = createLimiter({ windowMs: 60_000, max: 12 });

const roomUploadLimiter = createLimiter({ windowMs: 10 * 60_000, max: 40 });

export async function startServer({ dev = false, dir = ROOT } = {}) {
  const cfg = getConfig();
  await openDatabase();
  const app = next({ dev, dir, hostname: 'localhost', port: cfg.port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const nextUpgrade = dev ? app.getUpgradeHandler() : null;

  startMediaPool();
  sweepCache().catch(() => {});
  setInterval(() => sweepCache().catch(() => {}), 15 * 60 * 1000).unref();
  purgeExpiredSessions();
  sweepRoomUploads().catch(() => {});
  // numbers for the admin dashboard (one sample per minute)
  setInterval(() => {
    try {
      const s = stats();
      const q = queueSizes();
      sampleMetrics({ players: s.players, rooms: s.rooms, playing: s.playing, queue: Object.values(q).reduce((a, b) => a + b, 0) });
    } catch (err) {
      console.warn('[metrics]', err.message);
    }
  }, 60_000).unref();
  purgeModeration().catch(() => {});
  setInterval(() => purgeModeration().catch(() => {}), 6 * 60 * 60 * 1000).unref();
  setInterval(() => sweepRoomUploads().catch(() => {}), 60 * 60 * 1000).unref();
  setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000).unref();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;

      if (p === '/api/media' && (req.method === 'GET' || req.method === 'HEAD')) {
        return await handleMediaRequest(req, res, url.searchParams);
      }
      if (p.startsWith('/api/uploads/') && (req.method === 'GET' || req.method === 'HEAD')) {
        // evidence copies of reported uploads (and their preview pictures): admins only
        const evidence = p.startsWith('/api/uploads/reports/') || p.startsWith('/api/uploads/t/reports/');
        if (evidence && !isAdmin(userFromRequest(req).user)) return json(res, 404, { error: 'not_found' });
        return await serveUpload(req, res, p.slice('/api/uploads/'.length));
      }
      if (p.startsWith('/api/')) {
        // larger JSON answers are compressed; after a write the cached public answers are dropped
        compressJson(req, res);
        if (req.method !== 'GET' && req.method !== 'HEAD') res.once('finish', () => invalidateAfterWrite(p));
      }
      const roomUpload = /^\/api\/rooms\/([A-Z0-9]{5})\/upload$/.exec(p);
      if (roomUpload && req.method === 'POST') {
        try {
          checkOrigin(req);
          // inside Discord every player shares the proxy address: count per player instead
          const uploadKey = isActivityRequest(req) ? `p:${String(req.headers['x-player'] || '').slice(0, 40)}` : clientIp(req, cfg.trustProxy);
          if (!roomUploadLimiter.hit(uploadKey)) throw new HttpError(429, 'too_many_uploads');
          const file = await readUpload(req);
          const result = await handleRoomUpload(roomUpload[1], String(req.headers['x-player'] || ''), String(req.headers['x-secret'] || ''), file);
          return json(res, 200, result);
        } catch (err) {
          // rejected before the file was read: drain it, so the connection can be reused
          if (!req.complete) req.resume();
          if (err instanceof HttpError) return json(res, err.status, { error: err.code, ...err.extra });
          throw err;
        }
      }
      if (p === '/api/rooms' && req.method === 'POST') {
        let body = {};
        try {
          checkOrigin(req);
          if (String(req.headers['content-type'] || '').includes('application/json')) body = await readJson(req, 2048);
        } catch (err) {
          if (err instanceof HttpError) return json(res, err.status, { error: err.code });
          throw err;
        }
        if (!roomLimiter.hit(clientIp(req, cfg.trustProxy))) return json(res, 429, { error: 'too_many_rooms' });
        let creator = null;
        try {
          creator = userFromRequest(req).user;
        } catch {
          creator = null;
        }
        const sanction = activeSanction({ userId: creator?.id, ipHash: hashIp(clientIp(req, cfg.trustProxy)) });
        if (sanction?.type === 'ban') return json(res, 403, { error: 'banned', sanction });
        const room = createRoom({ game: body.game, channel: requestChannel(req) });
        if (!room) return json(res, 503, { error: 'server_full' });
        if (body.pack && room.settings.game === 'classic') {
          // "play this pack" from the studio / pack page
          let userId = null;
          try {
            userId = userFromRequest(req).user?.id ?? null;
          } catch {
            userId = null;
          }
          const info = packForGame(String(body.pack), userId);
          if (!info.error) room.settings = { ...room.settings, pack: info };
        }
        return json(res, 201, { code: room.code });
      }
      if (p.startsWith('/api/rooms/') && req.method === 'GET') {
        const code = p.slice('/api/rooms/'.length).toUpperCase();
        if (!ROOM_CODE_RE.test(code)) return json(res, 200, { exists: false });
        return json(res, 200, roomInfo(code));
      }
      if (p === '/api/status') {
        return json(res, 200, { ok: true, uptime: Math.round(process.uptime()), ...stats(), queues: queueSizes(), media: mediaStatus(), ...performanceStatus() });
      }
      if (p === '/api/public') {
        // polled by every open page: computed at most every 2 s, per release channel (never shared between them)
        const channel = requestChannel(req);
        return apiCache.send(req, res, `public:${channel}`, 2000, () => ({
          channel,
          classic: publicStats('classic'),
          hunt: publicStats('hunt'),
          queues: queueSizes(),
          huntSearches: cfg.huntSearches,
          matchMin: cfg.matchMin,
          matchMax: cfg.matchMax,
          uploadMaxMb: Math.round(cfg.uploadMaxBytes / 1048576),
        }), { cacheControl: 'private, no-cache' });
      }
      if (p === '/api/showcase') {
        // the same three examples for everybody for a few seconds
        return apiCache.send(req, res, 'showcase', 15_000, () => {
          const used = new Set();
          const items = ['image', 'video', 'image'].map((kind) => {
            const m = pickMedia(kind, used);
            used.add(m.id);
            warmMedia(m.url);
            return { kind: m.kind, src: proxyUrl(m.url), width: m.width, height: m.height, title: m.title };
          });
          return { items };
        });
      }
      if (p === '/api/sources') {
        return apiCache.send(req, res, 'sources', 30_000, () => ({ sources: activeSourceNames() }));
      }
      if (await handleApi(req, res, url)) return undefined;
      if (p.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
      // Discord Activity: "/?frame_id=…" (how Discord opens it) and /activity may be framed by Discord
      const framePolicy = activityFramePolicy(p, url.searchParams);
      if (framePolicy) res.setHeader('Content-Security-Policy', framePolicy);
      // installable web app: browsers must always get the newest worker and manifest
      if (p === '/sw.js' || p === '/manifest.json') res.setHeader('Cache-Control', 'no-cache');
      return await handle(req, res);
    } catch (err) {
      console.error('[http]', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error' }));
    }
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024,
    // Per-message compression stays off by default. Measured with 8 players: a state
    // message is 1.0–2.1 KB of JSON (0.4–0.7 KB deflated), a whole round adds up to
    // about 110 KB per player – compression would save ~70 KB per round, less than a
    // single meme picture. The price would be a zlib stream per socket and message
    // (every tiny client message has to be inflated as well) and the memory
    // fragmentation zlib is known for under many connections. Not a clear win.
    // WS_COMPRESSION=true switches it on for hosts with expensive traffic, in the
    // memory-safe form: no shared context between messages, small messages left alone.
    perMessageDeflate: cfg.wsCompression
      ? {
          threshold: 1024,
          serverNoContextTakeover: true,
          clientNoContextTakeover: true,
          zlibDeflateOptions: { level: 4, memLevel: 7 },
          concurrencyLimit: 8,
        }
      : false,
    // the activity sends ["laughtime", "lt-auth.<session>"] – answer with the plain name only
    handleProtocols: (protocols) => (protocols.has('laughtime') ? 'laughtime' : false),
  });
  attachGame(wss);

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/ws') {
      const origin = req.headers.origin;
      if (origin) {
        try {
          checkOrigin(req);
        } catch {
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
      }
      const activity = isActivityRequest(req);
      let user = null;
      try {
        user = userFromRequest(req).user;
      } catch (err) {
        console.warn('[ws] session lookup failed', err.message);
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.account = user ? { id: user.id, username: user.username, displayName: user.display_name, avatar: user.avatar } : null;
        ws.activity = activity;
        ws.channel = requestChannel(req);
        ws.ipHash = activity ? null : hashIp(clientIp(req, cfg.trustProxy));
        wss.emit('connection', ws, req);
      });
    } else if (nextUpgrade) {
      nextUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, resolve);
  });
  console.log(`\x1b[35m[laughtime]\x1b[0m ready on http://${cfg.host}:${cfg.port} (${dev ? 'development' : 'production'})`);

  const shutdown = (sig) => {
    console.log(`[laughtime] ${sig} received, shutting down…`);
    for (const ws of wss.clients) ws.close(1012, 'server restart');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}
