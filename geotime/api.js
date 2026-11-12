/**
 * GeoTime.lol – eigene HTTP-API
 *
 * Alle Routen liegen unter /geotime-api/, damit sie sich nie mit der API von
 * LaughTime beißen. Sie sind nur über die GeoTime-Ports erreichbar.
 *
 *   GET  /geotime-api/status                nur "läuft" – mit Token auch Details
 *   GET  /geotime-api/config                was der Client wissen muss
 *   GET  /geotime-api/instances             laufende Instanzen (nur mit Token)
 *   POST /geotime-api/instances             Beta starten  { action: "start" | "stop", id }
 *   POST /geotime-api/discord/interactions  Slash-Command /beta
 *   POST /geotime-api/auth/register         eigenes Konto anlegen
 *   POST /geotime-api/auth/login            anmelden
 *   POST /geotime-api/auth/logout           abmelden
 *   GET  /geotime-api/auth/me               wer bin ich + meine Zahlen
 *   POST /geotime-api/auth/lang             Sprache merken
 *   GET  /geotime-api/leaderboard           Bestenliste
 *
 * Wichtig: Instanz, Port und Update-Stand sind Betriebsdaten. Öffentlich gibt
 * die API davon nichts heraus – dafür braucht es GEOTIME_ADMIN_TOKEN.
 *
 * Die Spiel-Routen kommen aus einem Hot-Modul (geotime/api/routes.js), damit
 * sie ohne Neustart erweitert werden können.
 */
import {
  createAccount,
  createSession,
  dropSession,
  login as loginPlayer,
  playerFor,
  publicPlayer,
  sessionCookie,
  sessionToken,
  setLang,
} from './accounts.js';
import { handleInteraction, verifySignature } from './discord.js';
import { leaderboard, statsFor } from './stats.js';

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
};

const readBody = (req, limit = 256 * 1024) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

/** Schutz für das Starten/Stoppen über HTTP (Token aus der .env) */
const adminOk = (req) => {
  const token = process.env.GEOTIME_ADMIN_TOKEN;
  if (!token) return false;
  return req.headers.authorization === `Bearer ${token}`;
};

/** einfache Bremse gegen Passwort-Raten: je Adresse ein paar Versuche */
const attempts = new Map();
function tooMany(key, max = 10, windowMs = 10 * 60_000) {
  const at = Date.now();
  const entry = attempts.get(key);
  if (!entry || at - entry.at > windowMs) {
    attempts.set(key, { at, n: 1 });
    if (attempts.size > 5000) attempts.clear();
    return false;
  }
  entry.n += 1;
  return entry.n > max;
}

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unbekannt';

const isSecure = (req) => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

/** @returns {Promise<boolean>} true = beantwortet */
export async function handleApi(req, res, url, { cfg, hub, hot, updates, startedAt, instances }) {
  const p = url.pathname.replace('/geotime-api', '');
  const id = cfg.instanceId;

  // --- Konto --------------------------------------------------------------
  if (p === '/auth/me' && req.method === 'GET') {
    const me = playerFor(req, id);
    return json(res, 200, me ? { player: publicPlayer(me), stats: statsFor(id, me.id) } : { player: null });
  }

  if ((p === '/auth/register' || p === '/auth/login') && req.method === 'POST') {
    if (tooMany(`auth:${clientIp(req)}`)) return json(res, 429, { error: 'too_many' });
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      return json(res, 400, { error: 'bad_request' });
    }
    const db = (await import('./db.js')).getDb(id);
    let player;
    if (p === '/auth/register') {
      try {
        player = createAccount(db, {
          username: String(body.username || '').trim(),
          password: String(body.password || ''),
          name: String(body.name || body.username || '').trim(),
        });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    } else {
      player = loginPlayer(db, { username: String(body.username || '').trim(), password: String(body.password || '') });
      if (!player) return json(res, 401, { error: 'wrong_login' });
    }
    const token = createSession(db, player.id);
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: isSecure(req) }));
    return json(res, p === '/auth/register' ? 201 : 200, { player: publicPlayer(player), stats: statsFor(id, player.id) });
  }

  if (p === '/auth/logout' && req.method === 'POST') {
    const db = (await import('./db.js')).getDb(id);
    dropSession(db, sessionToken(req));
    res.setHeader('Set-Cookie', sessionCookie('', { secure: isSecure(req) }));
    return json(res, 200, { ok: true });
  }

  if (p === '/auth/lang' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const lang = body.lang === 'en' ? 'en' : 'de';
    const me = playerFor(req, id);
    if (me) setLang((await import('./db.js')).getDb(id), me.id, lang);
    res.setHeader('Set-Cookie', `gt_lang=${lang}; Path=/; Max-Age=${365 * 86400}; SameSite=Lax`);
    return json(res, 200, { lang });
  }

  // --- Bestenliste ---------------------------------------------------------
  if (p === '/leaderboard' && req.method === 'GET') {
    return json(res, 200, {
      game: url.searchParams.get('game') || 'classic',
      range: url.searchParams.get('range') || 'all',
      entries: leaderboard(id, {
        game: url.searchParams.get('game') || 'classic',
        range: url.searchParams.get('range') || 'all',
      }),
    });
  }

  if (p === '/status' && req.method === 'GET') {
    // öffentlich nur "der Server läuft" – sonst stünde die Instanz im Netz
    if (!adminOk(req)) return json(res, 200, { ok: true });
    return json(res, 200, {
      ok: true,
      instance: cfg.instanceId,
      channel: cfg.channel,
      port: cfg.port,
      players: hub.clients.size,
      uptime: Math.round((Date.now() - (startedAt || Date.now())) / 1000),
      hot: {
        applied: updates.applied,
        lastApplied: updates.lastApplied,
        lastError: updates.lastError,
        files: updates.files.slice(-20),
        modules: hot.list(),
      },
    });
  }

  if (p === '/config' && req.method === 'GET') {
    // nur, was der Spieler-Client wirklich braucht – keine Betriebsdaten.
    // Der Mapillary-Token ist ein Client-Token: der Viewer im Browser braucht
    // ihn, genau dafür ist er gedacht.
    return json(res, 200, {
      games: ['classic', 'bingo', 'hunt', 'deathmatch', 'star'],
      modes: cfg.game.teamSizes,
      classicRounds: cfg.game.classicRounds,
      classicSeconds: cfg.game.classicSeconds,
      bingoSeconds: cfg.game.bingoSeconds,
      huntSeconds: cfg.game.huntSeconds,
      starSeconds: cfg.game.starSeconds,
      huntRadius: 150,
      pano: {
        provider: cfg.pano.provider,
        token: cfg.pano.provider === 'mapillary' ? cfg.pano.token || null : null,
        ready:
          cfg.pano.provider === 'demo' ||
          cfg.pano.provider === 'panoramax' ||
          Boolean(cfg.pano.token),
      },
      map: { style: cfg.map.style },
      discordClientId: cfg.discord.clientId || null,
    });
  }

  // --- Straßenbilder von Panoramax -----------------------------------------
  // Läuft bewusst über den Server: so bekommt der Browser Bild und
  // Blickrichtung, aber nie die Koordinaten der laufenden Runde. Zum
  // Weiterlaufen gibt es Nachbarbilder mit *relativer* Richtung.
  // Auch erreichbar, wenn eigentlich Mapillary eingestellt ist: fällt eine
  // Runde auf Panoramax zurück, braucht der Browser die Bilddaten trotzdem.
  if (p.startsWith('/pano/') && req.method === 'GET') {
    if (cfg.pano.provider === 'demo') return json(res, 404, { error: 'not_found' });
    const id = decodeURIComponent(p.slice('/pano/'.length)).replace(/\/.*$/, '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return json(res, 400, { error: 'bad_id' });
    const pano = await import('./pano.js');
    let shot;
    try {
      shot = await pano.picture(cfg, id);
    } catch (err) {
      return json(res, 502, { error: 'pano_unreachable', detail: err.message });
    }
    if (!shot) return json(res, 404, { error: 'not_found' });
    const steps = await pano.moves(cfg, shot).catch(() => []);
    res.setHeader('Cache-Control', 'public, max-age=600');
    return json(res, 200, { ...pano.publicPicture(shot), steps });
  }

  if (p === '/instances' && req.method === 'GET') {
    if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, { instances: instances.list() });
  }

  if (p === '/instances' && req.method === 'POST') {
    if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' });
    const body = JSON.parse((await readBody(req)) || '{}');
    try {
      if (body.action === 'stop') return json(res, 200, await instances.stop(String(body.id)));
      return json(res, 201, await instances.start({ id: body.id, channel: 'beta', by: body.by || 'api' }));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (p === '/discord/interactions' && req.method === 'POST') {
    const body = await readBody(req);
    const valid = verifySignature({
      publicKey: cfg.discord.publicKey,
      signature: req.headers['x-signature-ed25519'],
      timestamp: req.headers['x-signature-timestamp'],
      body,
    });
    if (!valid) return json(res, 401, { error: 'bad signature' });
    return json(res, 200, await handleInteraction(JSON.parse(body), { cfg, instances }));
  }

  // erweiterbar ohne Neustart
  const routes = await hot.load('api/routes.js').catch(() => null);
  if (routes?.handle) return Boolean(await routes.handle(req, res, url, { cfg, hub, hot, updates, instances }));
  return false;
}
