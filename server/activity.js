// Discord Activity (Embedded App SDK) – LaughTime inside a Discord voice call.
//
// Flow (see components/ActivityApp.jsx):
//   1. Discord loads https://<client-id>.discordsays.com/?frame_id=…&instance_id=…
//      (URL mapping "/" -> our domain) – server.js forwards that to /activity.
//   2. The page runs the SDK handshake and `authorize` -> gets a one-time `code`.
//   3. POST /api/activity/token   { code }         -> Discord access token + LaughTime session
//   4. POST /api/activity/room    { instanceId }   -> the room code of this call
//   5. The normal game WebSocket, authenticated with the session (sub-protocol, no cookies).
//
// Inside Discord everything goes through Discord's proxy, which hides the
// players' IP addresses. Requests from the activity are therefore keyed by
// account, never by IP.

import {
  createSession,
  createUser,
  discordConfig,
  getUserByDiscord,
  privateUser,
  suggestUsername,
  updateUser,
} from './accounts.js';
import { getConfig } from './config.js';
import { activityRoom } from './game.js';
import { HttpError, createLimiter, json, readJson } from './http.js';
import { sanitizeName } from '../lib/shared.js';

const ACTIVITY_SESSION_DAYS = 2;
const INSTANCE_RE = /^[A-Za-z0-9_-]{4,160}$/;
const SNOWFLAKE_RE = /^\d{5,25}$/;
// every request from Discord arrives from the proxy, so the token route has a
// global budget for activity requests and a per-IP one for everything else
const tokenLimiterActivity = createLimiter({ windowMs: 60_000, max: 240 });
const tokenLimiterIp = createLimiter({ windowMs: 10 * 60_000, max: 20 });
const roomLimiter = createLimiter({ windowMs: 60_000, max: 20 });

export function activityConfig() {
  const d = discordConfig();
  const enabled = d.enabled && process.env.ACTIVITY_ENABLED !== 'false';
  return {
    ...d,
    enabled,
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    proxyHost: d.clientId ? `${d.clientId}.discordsays.com` : '',
  };
}

const hostOf = (value) => {
  try {
    return new URL(String(value)).host.toLowerCase();
  } catch {
    return '';
  }
};

/** true for requests that come through Discord's activity proxy (our own activity frame) */
export function isActivityRequest(req) {
  const { proxyHost, enabled } = activityConfig();
  if (!enabled || !proxyHost) return false;
  if (req.headers['x-discord-proxy-payload']) return true;
  const origin = hostOf(req.headers.origin);
  if (origin) return origin === proxyHost;
  return hostOf(req.headers.referer) === proxyHost;
}

/** Origin header of our own activity iframe (allowed for POSTs and the WebSocket). */
export function isActivityOrigin(origin) {
  const { proxyHost, enabled } = activityConfig();
  return Boolean(enabled && proxyHost && hostOf(origin) === proxyHost);
}

async function discordFetch(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (res.status === 429) {
    // respect Discord's rate limit once
    const wait = Math.min(5, Number(res.headers.get('retry-after')) || 1);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  }
  return res;
}

// --- instance verification (optional, needs DISCORD_BOT_TOKEN) ------------------

const instanceCache = new Map(); // instanceId -> { at, users: Set }

async function instanceUsers(cfg, instanceId, fresh = false) {
  const hit = instanceCache.get(instanceId);
  if (hit && !fresh && Date.now() - hit.at < 30_000) return hit.users;
  const res = await discordFetch(`${cfg.apiUrl}/applications/${cfg.clientId}/activity-instances/${encodeURIComponent(instanceId)}`, {
    headers: { Authorization: `Bot ${cfg.botToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`activity-instances ${res.status}`);
  const data = await res.json();
  const users = new Set((data.users || []).map(String));
  instanceCache.set(instanceId, { at: Date.now(), users });
  if (instanceCache.size > 2000) instanceCache.delete(instanceCache.keys().next().value);
  return users;
}

async function verifyInstance(cfg, instanceId, discordId) {
  if (!cfg.botToken) return; // not configured: trust the (unguessable) instance id
  let users;
  try {
    users = await instanceUsers(cfg, instanceId);
    if (users && !users.has(discordId)) users = await instanceUsers(cfg, instanceId, true);
  } catch (err) {
    console.warn('[activity] instance check failed:', err.message);
    throw new HttpError(503, 'discord_unavailable');
  }
  if (!users) throw new HttpError(404, 'activity_not_found');
  if (!users.has(discordId)) throw new HttpError(403, 'not_in_activity');
}

// --- routes -----------------------------------------------------------------------

async function exchangeToken(req, res, ctx) {
  const cfg = activityConfig();
  if (!cfg.enabled) throw new HttpError(404, 'activity_disabled');
  const body = await readJson(req);
  const code = String(body.code || '');
  if (!code || code.length > 200) throw new HttpError(400, 'bad_request');
  const allowed = isActivityRequest(req) ? tokenLimiterActivity.hit('all') : tokenLimiterIp.hit(ctx.ip);
  if (!allowed) throw new HttpError(429, 'too_many_attempts');

  let tok;
  let profile;
  try {
    const tokenRes = await discordFetch(`${cfg.apiUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'authorization_code',
        code,
      }),
    });
    if (!tokenRes.ok) throw new HttpError(401, 'discord_failed');
    tok = await tokenRes.json();
    const meRes = await discordFetch(`${cfg.apiUrl}/users/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (!meRes.ok) throw new HttpError(401, 'discord_failed');
    profile = await meRes.json();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.warn('[activity] token exchange failed:', err.message);
    throw new HttpError(502, 'discord_failed');
  }
  if (!profile?.id || !SNOWFLAKE_RE.test(String(profile.id))) throw new HttpError(401, 'discord_failed');

  const discordId = String(profile.id);
  const discordName = sanitizeName(profile.global_name || profile.username || 'Discord') || 'Discord';
  let user = getUserByDiscord(discordId);
  let isNew = false;
  if (!user) {
    user = createUser({ username: suggestUsername(profile.username), displayName: discordName, discordId, discordName });
    isNew = true;
  } else if (user.discord_name !== discordName) {
    user = updateUser(user.id, { discord_name: discordName });
  }
  // short-lived: a new one is made every time the activity starts
  const session = createSession(user.id, ACTIVITY_SESSION_DAYS);
  json(res, 200, {
    accessToken: tok.access_token,
    scope: tok.scope || '',
    session,
    isNew,
    user: privateUser(user),
  });
}

async function joinRoom(req, res, ctx) {
  const cfg = activityConfig();
  if (!cfg.enabled) throw new HttpError(404, 'activity_disabled');
  const user = ctx.user;
  if (!user) throw new HttpError(401, 'login_required');
  if (!roomLimiter.hit(`u${user.id}`)) throw new HttpError(429, 'too_many_attempts');
  if (ctx.sanction?.type === 'ban') throw new HttpError(403, 'banned', { sanction: ctx.sanction });
  const body = await readJson(req);
  const instanceId = String(body.instanceId || '');
  if (!INSTANCE_RE.test(instanceId)) throw new HttpError(400, 'bad_request');
  const guildId = SNOWFLAKE_RE.test(String(body.guildId || '')) ? String(body.guildId) : null;
  const channelId = SNOWFLAKE_RE.test(String(body.channelId || '')) ? String(body.channelId) : null;
  if (!user.discord_id) throw new HttpError(403, 'not_in_activity');
  await verifyInstance(cfg, instanceId, String(user.discord_id));
  const room = activityRoom({ instanceId, guildId, channelId, userId: user.id });
  if (!room) throw new HttpError(503, 'server_full');
  json(res, 200, { code: room.code });
}

/** public settings the activity page needs before it can talk to Discord */
function activityInfo(res) {
  const cfg = activityConfig();
  json(res, 200, {
    enabled: cfg.enabled,
    clientId: cfg.enabled ? cfg.clientId : null,
    publicUrl: getConfig().publicUrl.replace(/\/$/, ''),
    verified: Boolean(cfg.botToken),
  });
}

/** Returns true when the request was handled (called from api.js with its context). */
export async function handleActivityApi(req, res, p, method, ctx) {
  if (p === '/api/activity/config' && method === 'GET') return (activityInfo(res), true);
  if (p === '/api/activity/token' && method === 'POST') return (await exchangeToken(req, res, ctx), true);
  if (p === '/api/activity/room' && method === 'POST') return (await joinRoom(req, res, ctx), true);
  return false;
}
