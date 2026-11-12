import http from 'node:http';
import next from 'next';
import { WebSocketServer } from 'ws';
import { ROOM_CODE_RE } from '../lib/shared.js';
import { isAdmin, purgeExpiredSessions, userFromRequest } from './accounts.js';
import { isActivityRequest } from './activity.js';
import { handleApi } from './api.js';
import { ROOT, getConfig } from './config.js';
import { openDatabase } from './db.js';
import { attachGame, createRoom, handleRoomUpload, publicStats, roomInfo, stats } from './game.js';
import { readUpload, serveUpload, sweepRoomUploads } from './uploads.js';
import { HttpError, checkOrigin, clientIp, createLimiter, json, readJson } from './http.js';
import { queueSizes } from './matchmaking.js';
import { activeSanction, hashIp, purgeModeration, sampleMetrics } from './moderation.js';
import { packForGame } from './packs.js';
import { activeSourceNames, mediaStatus, pickMedia, startMediaPool } from './media/index.js';
import { handleMediaRequest, proxyUrl, sweepCache, warmMedia } from './proxy.js';

// One HTTP server for everything:
//   /ws                -> WebSocket game server
//   /api/media         -> media proxy (cached)
//   /api/rooms         -> create room (POST) / room info (GET /api/rooms/CODE)
//   /api/status        -> health + media source status
//   /api/auth/*, /api/me, /api/users/*, /api/leaderboard, /api/memes*  -> accounts & community (api.js)
//   everything else    -> Next.js

const roomLimiter = createLimiter({ windowMs: 60_000, max: 12 });

// who may show /activity in a frame: Discord (web, desktop, mobile) and its proxy
const ACTIVITY_FRAME_ANCESTORS = [
  "'self'",
  'https://discord.com',
  'https://*.discord.com',
  'https://discordapp.com',
  'https://*.discordapp.com',
  'https://*.discordsays.com',
  // local test harness (the SDK accepts http://localhost:3333 as a Discord origin)
  ...(process.env.ACTIVITY_DEV_FRAME ? [process.env.ACTIVITY_DEV_FRAME] : []),
].join(' ');
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
        // evidence copies of reported uploads: admins only
        if (p.startsWith('/api/uploads/reports/') && !isAdmin(userFromRequest(req).user)) return json(res, 404, { error: 'not_found' });
        return await serveUpload(req, res, p.slice('/api/uploads/'.length));
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
        const room = createRoom({ game: body.game });
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
        return json(res, 200, { ok: true, uptime: Math.round(process.uptime()), ...stats(), queues: queueSizes(), media: mediaStatus() });
      }
      if (p === '/api/public') {
        return json(res, 200, {
          classic: publicStats('classic'),
          hunt: publicStats('hunt'),
          queues: queueSizes(),
          huntSearches: cfg.huntSearches,
          matchMin: cfg.matchMin,
          matchMax: cfg.matchMax,
          uploadMaxMb: Math.round(cfg.uploadMaxBytes / 1048576),
        });
      }
      if (p === '/api/showcase') {
        const used = new Set();
        const items = ['image', 'video', 'image'].map((kind) => {
          const m = pickMedia(kind, used);
          used.add(m.id);
          warmMedia(m.url);
          return { kind: m.kind, src: proxyUrl(m.url), width: m.width, height: m.height, title: m.title };
        });
        return json(res, 200, { items });
      }
      if (p === '/api/sources') {
        return json(res, 200, { sources: activeSourceNames() });
      }
      if (await handleApi(req, res, url)) return undefined;
      if (p.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
      // Discord Activity: "/?frame_id=…" (how Discord opens it) and /activity may be framed by Discord
      if (p === '/activity' || p.startsWith('/activity/') || (p === '/' && url.searchParams.has('frame_id'))) {
        res.setHeader('Content-Security-Policy', `frame-ancestors ${ACTIVITY_FRAME_ANCESTORS}`);
      }
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
    perMessageDeflate: false,
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
