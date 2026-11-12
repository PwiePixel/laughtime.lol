// Beta channel: the JSON API behind the /beta page and the hand-over that lets
// the Discord login work on the beta host. Channel rules live in channel.js.
//
//   GET  /api/beta            what the beta is right now + what this visitor may do
//   POST /api/beta { on }     join / leave the beta (opt-in cookie)
//   GET  /api/beta/status     live numbers for the beta page (feature "liveStatus")
//   GET  /api/beta/live       rooms and players per channel (admins)
import crypto from 'node:crypto';
import { BETA_COOKIE, BETA_COOKIE_MAX_AGE, betaFeatures, feedbackUrlFromEnv } from '../lib/features.js';
import { GAME_MODES } from '../lib/shared.js';
import { APP_RELEASE, APP_VERSION } from '../lib/version.js';
import { isAdmin } from './accounts.js';
import { featureFlags, requestBeta, requestHasFeature, requestHostName } from './channel.js';
import { getConfig } from './config.js';
import { channelStats, stats } from './game.js';
import { HttpError, createLimiter, json, readJson, redirect, serializeCookie } from './http.js';
import { queueSizes } from './matchmaking.js';
import { mediaStatus } from './media/index.js';

export { loginReturn } from './channel.js';

const switchLimiter = createLimiter({ windowMs: 60_000, max: 20 }); // joins/leaves per IP
const statusLimiter = createLimiter({ windowMs: 60_000, max: 60 }); // status polls per IP

/** What the /beta page shows. `state` comes from requestBeta (channel.js). */
export function betaView(state) {
  const inBeta = state.channel === 'beta';
  return {
    channel: state.channel,
    enabled: state.enabled,
    access: state.access,
    // may this visitor use the beta channel?
    mayJoin: state.enabled && !state.activity && state.allowed,
    optedIn: state.optedIn,
    // on a beta host the beta is always on – leaving means opening the main page
    onBetaHost: state.onBetaHost,
    release: APP_RELEASE,
    version: APP_VERSION,
    features: state.enabled ? betaFeatures(featureFlags()).map((key) => ({ key, enabled: inBeta })) : [],
    modes: state.enabled ? GAME_MODES.filter((g) => g.beta).map((g) => ({ id: g.id, icon: g.icon, color: g.color, enabled: inBeta })) : [],
    feedbackUrl: feedbackUrlFromEnv(process.env),
    mainUrl: getConfig().publicUrl.replace(/\/$/, ''),
  };
}

// The cookie is only ever read by the server (the layout gets the channel from
// it), so scripts do not need it: HttpOnly. Host-only like the session cookie.
const betaCookie = (on, secure) => serializeCookie(BETA_COOKIE, on ? '1' : '', { maxAge: on ? BETA_COOKIE_MAX_AGE : 0, secure });

async function switchBeta(req, res, ctx) {
  // inside Discord every player shares the proxy address
  if (!switchLimiter.hit(ctx.activity ? 'activity' : ctx.ip)) throw new HttpError(429, 'too_many_attempts');
  const body = await readJson(req, 1024);
  if (typeof body.on !== 'boolean') throw new HttpError(400, 'bad_request');
  const state = requestBeta(req, ctx.user);
  if (body.on) {
    if (!state.enabled) throw new HttpError(409, 'beta_disabled');
    // the Discord Activity always stays on the stable channel
    if (state.activity) throw new HttpError(409, 'beta_unavailable');
    if (!state.allowed) {
      if (state.access === 'accounts' || !ctx.user) throw new HttpError(401, 'login_required');
      throw new HttpError(403, 'beta_restricted');
    }
  }
  // leaving always works, also after the beta was closed
  const next = requestBeta(req, ctx.user, { optedIn: body.on });
  json(res, 200, betaView(next), { 'Set-Cookie': betaCookie(body.on, ctx.secure) });
}

// one line per media source ("imgflip", "klipy", …) instead of one per feed
function sourceSummary() {
  const bySource = new Map();
  for (const [key, s] of Object.entries(mediaStatus().sources)) {
    if (s.status === 'off') continue; // not configured: nothing to report
    const name = key.split('-')[0];
    const entry = bySource.get(name) || { name, items: 0, states: new Set() };
    entry.items += s.count;
    entry.states.add(s.status);
    bySource.set(name, entry);
  }
  return [...bySource.values()].map(({ name, items, states }) => ({
    name,
    items,
    status: states.has('ok') ? (states.has('error') ? 'partial' : 'ok') : states.has('loading') ? 'loading' : 'error',
  }));
}

function liveStatus() {
  const s = stats();
  return {
    players: s.players,
    rooms: s.rooms,
    playing: s.playing,
    queued: Object.values(queueSizes()).reduce((a, b) => a + b, 0),
    sources: sourceSummary(),
    uptime: Math.round(process.uptime()),
    at: Date.now(),
  };
}

/** Returns true when the request was handled (called from handleApi in api.js). */
export async function handleBetaApi(req, res, ctx, p, method) {
  if (p === '/api/beta' && method === 'GET') {
    json(res, 200, betaView(requestBeta(req, ctx.user)));
    return true;
  }
  if (p === '/api/beta' && method === 'POST') {
    await switchBeta(req, res, ctx);
    return true;
  }
  if (p === '/api/beta/status' && method === 'GET') {
    // a real beta feature: only there while "liveStatus" is on for this visitor
    if (!requestHasFeature(req, 'liveStatus')) throw new HttpError(404, 'not_found');
    if (!statusLimiter.hit(ctx.activity ? 'activity' : ctx.ip)) throw new HttpError(429, 'too_many_attempts');
    json(res, 200, liveStatus());
    return true;
  }
  if (p === '/api/beta/live' && method === 'GET') {
    if (!ctx.user) throw new HttpError(401, 'login_required');
    if (!isAdmin(ctx.user)) throw new HttpError(403, 'forbidden');
    const state = requestBeta(req, ctx.user);
    json(res, 200, { enabled: state.enabled, access: state.access, ...channelStats() });
    return true;
  }
  return false;
}

// --- Discord login on the beta host ---------------------------------------------
// Discord returns every login to the redirect URI on the main host, but session
// cookies are host-only. A login that was started on the beta host is therefore
// finished there: the callback parks the result under a one-time code and sends
// the browser back to /api/auth/handover on the host it came from. That host
// only accepts the code together with the state cookie it set when the login
// started, so a code is useless in any other browser.

const HANDOVER_TTL = 60_000;
const HANDOVER_MAX = 2000;
const handovers = new Map(); // code -> { expires, host, state, identity }

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Sends a finished Discord login back to the host that started it.
 *   back      { host, origin } from loginReturn() – one of our own hosts
 *   state     the OAuth state of this login (the starting host has it as a cookie)
 *   identity  what the callback learned (plain data, kept in memory for a minute)
 */
export function loginHandover(res, back, state, identity) {
  const now = Date.now();
  for (const [k, v] of handovers) if (v.expires < now) handovers.delete(k);
  // bounded: drop the oldest entries first (a Map keeps insertion order)
  for (const k of handovers.keys()) {
    if (handovers.size < HANDOVER_MAX) break;
    handovers.delete(k);
  }
  const code = crypto.randomBytes(32).toString('base64url');
  handovers.set(code, { expires: now + HANDOVER_TTL, host: back.host, state, identity });
  redirect(res, `${back.origin}/api/auth/handover?code=${code}`, { 'Referrer-Policy': 'no-referrer' });
}

/**
 * Takes a hand-over code back: the identity, or null when the code is unknown,
 * used, expired, meant for another host or presented by another browser.
 * A code works once, whatever the outcome.
 */
export function redeemLoginHandover(req, code, cookieState) {
  const key = String(code || '');
  const entry = handovers.get(key);
  handovers.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  if (requestHostName(req) !== entry.host) return null;
  if (!safeEqual(cookieState, entry.state)) return null;
  return entry.identity;
}
