import crypto from 'node:crypto';
import { sanitizeAvatar, sanitizeName } from '../lib/shared.js';
import {
  clearSessionCookie,
  cleanBio,
  createSession,
  createUser,
  deleteUser,
  destroySession,
  destroyUserSessions,
  discordConfig,
  dummyVerify,
  getUserByDiscord,
  getUserByName,
  hashPassword,
  privateUser,
  publicUser,
  sessionCookie,
  suggestUsername,
  updateUser,
  userFromRequest,
  usernameFree,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './accounts.js';
import { getConfig } from './config.js';
import { isAdmin as isAdminUser } from './accounts.js';
import { handleActivityApi, isActivityRequest } from './activity.js';
import { exchangeCode, fetchUser } from './discord.js';
import { HttpError, checkOrigin, clientIp, createLimiter, isHttps, json, parseCookies, readJson, redirect, serializeCookie } from './http.js';
import { apiCache } from './lib/respond.js';
import { browseMedia, cleanQuery, isBlocked, searchMedia } from './media/search.js';
import { addPackItem, addPackUpload, createPack, deletePack, getPack, listPacks, listReviews, removePackItem, reviewPack, updatePack } from './packs.js';
import { readUpload } from './uploads.js';
import { stats as gameStats } from './game.js';
import { queueSizes } from './matchmaking.js';
import {
  activeSanction,
  createReport,
  createSanction,
  dashboardStats,
  dismissReports,
  hashIp,
  kickTarget,
  liftSanction,
  listLog,
  listReports,
  listSanctions,
  logAction,
  resetName,
  resetUsername,
  searchUsers,
  userDetails,
} from './moderation.js';
import { getMeme as getMemeRow } from './stats.js';
import { isAllowedUrl, proxyUrl, warmMedia } from './proxy.js';
import { deleteMeme, getMeme, leaderboard, listMemes, siteStats, toggleLike, userStats } from './stats.js';

// ---------------------------------------------------------------------------
// REST API for accounts, profiles, leaderboards and the meme gallery.
// Handled by the custom server before Next.js sees the request.
// ---------------------------------------------------------------------------

const authLimiter = createLimiter({ windowMs: 10 * 60_000, max: 20 }); // per IP
const userFailLimiter = createLimiter({ windowMs: 15 * 60_000, max: 8 }); // failed logins per username
const registerLimiter = createLimiter({ windowMs: 60 * 60_000, max: 6 }); // new accounts per IP
const writeLimiter = createLimiter({ windowMs: 60_000, max: 60 }); // likes, profile edits
const searchLimiter = createLimiter({ windowMs: 60_000, max: 40 }); // studio searches per user
const packLimiter = createLimiter({ windowMs: 60_000, max: 120 }); // pack edits per user
const uploadLimiter = createLimiter({ windowMs: 60 * 60_000, max: 60 }); // own uploads per user
const oauthStates = new Map(); // state -> { expires, linkUserId }
const OAUTH_COOKIE = 'lt_oauth';

function requireUser(user) {
  if (!user) throw new HttpError(401, 'login_required');
  return user;
}

function requireAdmin(ctx) {
  const user = requireUser(ctx.user);
  if (!isAdminUser(user)) throw new HttpError(403, 'forbidden');
  return user;
}

/** restricted players may not change their public profile, upload or publish */
function requireUnrestricted(ctx) {
  if (ctx.sanction) throw new HttpError(403, ctx.sanction.type === 'ban' ? 'banned' : 'restricted', { sanction: ctx.sanction });
}

const reportLimiter = createLimiter({ windowMs: 10 * 60_000, max: 10 });

async function discordLoginStart(req, res, ctx) {
  const d = discordConfig();
  if (!d.enabled) throw new HttpError(404, 'discord_disabled');
  const state = crypto.randomBytes(18).toString('base64url');
  const link = new URL(req.url, 'http://x').searchParams.get('link') === '1' && ctx.user ? ctx.user.id : null;
  oauthStates.set(state, { expires: Date.now() + 10 * 60_000, linkUserId: link });
  for (const [k, v] of oauthStates) if (v.expires < Date.now()) oauthStates.delete(k);
  const url = new URL(d.authorizeUrl);
  url.searchParams.set('client_id', d.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', d.redirectUri);
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'none');
  redirect(res, url.toString(), {
    'Set-Cookie': serializeCookie(OAUTH_COOKIE, state, { maxAge: 600, secure: ctx.secure }),
  });
}

async function discordCallback(req, res, ctx) {
  const d = discordConfig();
  const fail = (code) =>
    redirect(res, `/login?error=${code}`, { 'Set-Cookie': serializeCookie(OAUTH_COOKIE, '', { maxAge: 0, secure: ctx.secure }) });
  if (!d.enabled) return fail('discord_disabled');
  const params = new URL(req.url, 'http://x').searchParams;
  const state = params.get('state') || '';
  const cookieState = parseCookies(req.headers.cookie)[OAUTH_COOKIE] || '';
  const saved = oauthStates.get(state);
  oauthStates.delete(state);
  if (!state || state !== cookieState || !saved || saved.expires < Date.now()) return fail('discord_state');
  if (params.get('error') || !params.get('code')) return fail('discord_cancelled');

  let profile;
  try {
    // one queued request each (server/discord.js): the code is never sent twice
    const tok = await exchangeCode({ clientId: d.clientId, clientSecret: d.clientSecret, code: params.get('code'), redirectUri: d.redirectUri });
    profile = await fetchUser(tok.access_token);
  } catch (err) {
    console.warn('[auth] discord login failed:', err.message);
    return fail('discord_failed');
  }
  if (!profile?.id) return fail('discord_failed');
  const discordId = String(profile.id);
  const discordName = sanitizeName(profile.global_name || profile.username || 'Discord') || 'Discord';

  let user = getUserByDiscord(discordId);
  if (saved.linkUserId) {
    // connect Discord to the account that started the flow
    if (user && user.id !== saved.linkUserId) return redirect(res, '/account?error=discord_in_use');
    updateUser(saved.linkUserId, { discord_id: discordId, discord_name: discordName });
    return redirect(res, '/account?linked=discord', {
      'Set-Cookie': serializeCookie(OAUTH_COOKIE, '', { maxAge: 0, secure: ctx.secure }),
    });
  }
  let isNew = false;
  if (!user) {
    user = createUser({
      username: suggestUsername(profile.username),
      displayName: discordName,
      discordId,
      discordName,
    });
    isNew = true;
  } else if (user.discord_name !== discordName) {
    user = updateUser(user.id, { discord_name: discordName });
  }
  const token = createSession(user.id);
  res.writeHead(302, {
    Location: isNew ? '/account?welcome=1' : '/',
    'Cache-Control': 'no-store',
    'Set-Cookie': [sessionCookie(token, ctx.secure), serializeCookie(OAUTH_COOKIE, '', { maxAge: 0, secure: ctx.secure })],
  });
  res.end();
}

async function register(req, res, ctx) {
  if (!registerLimiter.hit(ctx.ip)) throw new HttpError(429, 'too_many_attempts');
  const body = await readJson(req);
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);
  if (!usernameFree(username)) throw new HttpError(409, 'username_taken');
  const user = createUser({
    username,
    displayName: sanitizeName(body.displayName) || username,
    passwordHash: await hashPassword(password),
    avatar: body.avatar,
  });
  const token = createSession(user.id);
  json(res, 201, { user: privateUser(user) }, { 'Set-Cookie': sessionCookie(token, ctx.secure) });
}

async function login(req, res, ctx) {
  if (!authLimiter.hit(ctx.ip)) throw new HttpError(429, 'too_many_attempts');
  const body = await readJson(req);
  const name = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!name || !password) throw new HttpError(400, 'login_failed');
  if (userFailLimiter.count(name) >= 8) throw new HttpError(429, 'too_many_attempts');
  const user = getUserByName(name);
  const ok = user?.password_hash ? await verifyPassword(password, user.password_hash) : await dummyVerify(password);
  if (!ok) {
    userFailLimiter.hit(name);
    throw new HttpError(401, 'login_failed');
  }
  userFailLimiter.reset(name);
  const token = createSession(user.id);
  json(res, 200, { user: privateUser(user) }, { 'Set-Cookie': sessionCookie(token, ctx.secure) });
}

async function updateMe(req, res, ctx) {
  const user = requireUser(ctx.user);
  if (!writeLimiter.hit(`u${user.id}`)) throw new HttpError(429, 'too_many_attempts');
  const body = await readJson(req);
  const fields = {};
  if (ctx.sanction && (body.displayName !== undefined || body.avatar !== undefined || body.bio !== undefined)) requireUnrestricted(ctx);
  if (body.displayName !== undefined) {
    const n = sanitizeName(body.displayName);
    if (!n) throw new HttpError(400, 'name_required');
    fields.display_name = n;
  }
  if (body.avatar !== undefined) fields.avatar = sanitizeAvatar(body.avatar);
  if (body.bio !== undefined) fields.bio = cleanBio(body.bio);
  if (body.showMemes !== undefined) fields.show_memes = body.showMemes ? 1 : 0;
  json(res, 200, { user: privateUser(updateUser(user.id, fields)) });
}

async function changePassword(req, res, ctx) {
  const user = requireUser(ctx.user);
  if (!authLimiter.hit(ctx.ip)) throw new HttpError(429, 'too_many_attempts');
  const body = await readJson(req);
  if (user.password_hash && !(await verifyPassword(String(body.current ?? ''), user.password_hash))) {
    throw new HttpError(401, 'wrong_password');
  }
  const next = validatePassword(body.password);
  updateUser(user.id, { password_hash: await hashPassword(next) });
  destroyUserSessions(user.id, ctx.token); // log out other devices
  json(res, 200, { ok: true });
}

async function unlinkDiscord(req, res, ctx) {
  const user = requireUser(ctx.user);
  await readJson(req);
  if (!user.password_hash) throw new HttpError(400, 'set_password_first');
  json(res, 200, { user: privateUser(updateUser(user.id, { discord_id: null, discord_name: null })) });
}

async function deleteMe(req, res, ctx) {
  const user = requireUser(ctx.user);
  if (!authLimiter.hit(ctx.ip)) throw new HttpError(429, 'too_many_attempts');
  const body = await readJson(req);
  if (user.password_hash) {
    if (!(await verifyPassword(String(body.password ?? ''), user.password_hash))) throw new HttpError(401, 'wrong_password');
  } else if (String(body.confirm ?? '').toLowerCase() !== user.username.toLowerCase()) {
    throw new HttpError(400, 'confirm_username');
  }
  deleteUser(user.id);
  json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(ctx.secure) });
}

const studioItem = (m) => ({
  id: m.id,
  kind: m.kind,
  src: proxyUrl(m.url),
  thumb: m.thumb && isAllowedUrl(m.thumb) ? proxyUrl(m.thumb) : null,
  width: m.width,
  height: m.height,
  title: m.title,
  source: m.source,
});

async function studioSearch(res, ctx, q) {
  const user = requireUser(ctx.user);
  if (!searchLimiter.hit(`u${user.id}`)) throw new HttpError(429, 'too_many_attempts');
  const kind = ['image', 'video'].includes(q.get('kind')) ? q.get('kind') : 'any';
  const query = cleanQuery(q.get('q'));
  if (query && isBlocked(query)) return json(res, 200, { items: [], blocked: true });
  const items = query.length >= 2 ? (await searchMedia(query, { kind })).slice(0, 60) : browseMedia(kind, 40);
  for (const m of items.slice(0, 12)) warmMedia(m.url);
  return json(res, 200, { query, items: items.map(studioItem) });
}

async function packRoutes(req, res, ctx, p, method, q) {
  if (p === '/api/packs' && method === 'GET') {
    const scope = q.get('scope') === 'mine' ? 'mine' : 'public';
    const list = () => listPacks({ scope, viewer: ctx.user, q: q.get('q') || '', limit: q.get('limit'), offset: q.get('offset') });
    // the public list looks the same for every guest: cached for a moment (never for accounts)
    if (scope === 'public' && !ctx.user) {
      apiCache.send(req, res, `packs:${q.get('q') || ''}:${q.get('limit')}:${q.get('offset')}`, 10_000, list, { cacheControl: 'private, no-cache' });
    } else json(res, 200, list());
    return true;
  }
  if (p === '/api/packs' && method === 'POST') {
    const user = requireUser(ctx.user);
    if (!packLimiter.hit(`u${user.id}`)) throw new HttpError(429, 'too_many_attempts');
    json(res, 201, { pack: createPack(user, await readJson(req)) });
    return true;
  }
  const up = /^\/api\/packs\/([A-Za-z0-9_-]{6,20})\/upload$/.exec(p);
  if (up && method === 'POST') {
    const user = requireUser(ctx.user);
    requireUnrestricted(ctx);
    if (!uploadLimiter.hit(`u${user.id}`)) throw new HttpError(429, 'too_many_uploads');
    const file = await readUpload(req);
    json(res, 200, { pack: await addPackUpload(up[1], user, file) });
    return true;
  }
  const m = /^\/api\/packs\/([A-Za-z0-9_-]{6,20})(?:\/items(?:\/([^/]{1,120}))?)?$/.exec(p);
  if (!m) return false;
  const [, id, itemId] = m;
  const isItems = p.includes('/items');
  if (!isItems && method === 'GET') {
    json(res, 200, { pack: getPack(id, ctx.user) });
    return true;
  }
  const user = requireUser(ctx.user);
  if (!packLimiter.hit(`u${user.id}`)) throw new HttpError(429, 'too_many_attempts');
  if (!isItems && method === 'PATCH') {
    const body = await readJson(req);
    if (body.public) requireUnrestricted(ctx);
    return (json(res, 200, { pack: updatePack(id, user, body) }), true);
  }
  if (!isItems && method === 'DELETE') return (json(res, 200, deletePack(id, user)), true);
  if (isItems && !itemId && method === 'POST') {
    const body = await readJson(req);
    return (json(res, 200, { pack: addPackItem(id, user, body.id) }), true);
  }
  if (isItems && itemId && method === 'DELETE') {
    let mediaId = itemId;
    try {
      mediaId = decodeURIComponent(itemId);
    } catch {
      throw new HttpError(400, 'bad_request');
    }
    return (json(res, 200, { pack: removePackItem(id, user, mediaId) }), true);
  }
  return false;
}

// reports from profile pages and the gallery (in-game reports go through the WebSocket)
async function publicReport(req, res, ctx) {
  const body = await readJson(req);
  const reporterKey = ctx.user ? `u${ctx.user.id}` : `ip${ctx.ipHash}`;
  if (!reportLimiter.hit(reporterKey)) throw new HttpError(429, 'too_many_reports');
  let target;
  let context = null;
  if (body.memeId) {
    const meme = getMemeRow(String(body.memeId), ctx.user);
    const owner = getUserByName(meme.author?.username || '');
    if (!owner) throw new HttpError(404, 'meme_not_found');
    target = { userId: owner.id, name: owner.display_name, avatar: owner.avatar };
    context = { media: meme.media, captions: meme.captions, memeId: meme.id };
  } else {
    const user = getUserByName(String(body.username || ''));
    if (!user) throw new HttpError(404, 'user_not_found');
    target = { userId: user.id, name: user.display_name, avatar: user.avatar };
  }
  const pid = /^[a-zA-Z0-9_-]{8,40}$/.test(String(body.pid || '')) ? String(body.pid) : null;
  json(
    res,
    200,
    await createReport({
      reporter: { userId: ctx.user?.id, pid: ctx.user ? null : pid, ipHash: ctx.ipHash, name: ctx.user?.display_name || '' },
      target,
      reason: String(body.reason || ''),
      comment: body.comment,
      context,
    }),
  );
}

async function adminRoutes(req, res, ctx, p, method, q) {
  if (p === '/api/admin/reviews' || /^\/api\/admin\/packs\//.test(p)) return false; // handled below
  const admin = requireAdmin(ctx);
  const body = method === 'GET' ? {} : await readJson(req);
  const out = (data) => (json(res, 200, data), true);
  switch (`${method} ${p}`) {
    case 'GET /api/admin/summary': {
      const s = gameStats();
      return out({
        openReports: listReports({ status: 'open' }).length,
        pendingPacks: listReviews(admin).length,
        live: s,
      });
    }
    case 'GET /api/admin/stats': {
      const s = gameStats();
      const queues = queueSizes();
      return out(dashboardStats(q.get('range') || '24h', { ...s, queue: Object.values(queues).reduce((a, b) => a + b, 0), queues }));
    }
    case 'GET /api/admin/reports':
      return out({ groups: listReports({ status: q.get('status') || 'open' }) });
    case 'POST /api/admin/reports/dismiss':
      return out(dismissReports(admin, body.key));
    case 'POST /api/admin/sanctions':
      return out(
        createSanction(admin, {
          target: body.target,
          type: body.type,
          duration: body.duration,
          reason: body.reason,
          note: body.note,
          withIp: Boolean(body.withIp),
        }),
      );
    case 'GET /api/admin/sanctions':
      return out({ sanctions: listSanctions({ active: q.get('all') !== '1', limit: 200 }) });
    case 'POST /api/admin/reset-name':
      return out(resetName(admin, body.target));
    case 'POST /api/admin/reset-username':
      return out(resetUsername(admin, body.userId));
    case 'POST /api/admin/kick':
      return out(kickTarget(admin, body.target));
    case 'GET /api/admin/users':
      return out({ users: searchUsers(q.get('q') || '') });
    case 'GET /api/admin/log':
      return out({ entries: listLog({ before: q.get('before') }) });
    default:
      break;
  }
  const lift = /^\/api\/admin\/sanctions\/(\d+)\/lift$/.exec(p);
  if (lift && method === 'POST') return out(liftSanction(admin, lift[1]));
  const user = /^\/api\/admin\/users\/(\d+)$/.exec(p);
  if (user && method === 'GET') return out({ user: userDetails(user[1]) });
  if (user && method === 'DELETE') {
    const target = userDetails(user[1]);
    if (target.isAdmin) throw new HttpError(400, 'cannot_sanction_admin');
    deleteUser(target.id);
    logAction(admin, 'delete_account', `u:${target.id} (${target.username})`);
    return out({ ok: true });
  }
  throw new HttpError(404, 'not_found');
}

function publicProfile(res, ctx, username) {
  const user = getUserByName(username);
  if (!user) throw new HttpError(404, 'user_not_found');
  json(res, 200, {
    user: { ...publicUser(user), bio: user.bio, createdAt: user.created_at, isMe: ctx.user?.id === user.id },
    stats: userStats(user.id),
    memes: listMemes({ sort: 'top', username: user.username, viewer: ctx.user, limit: 12 }).items,
  });
}

/**
 * Returns true when the request was handled.
 */
export async function handleApi(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/')) return false;
  const cfg = getConfig();
  const method = req.method;
  const ctx = {
    ip: clientIp(req, cfg.trustProxy),
    secure: isHttps(req, cfg.trustProxy) || process.env.COOKIE_SECURE === 'true',
    ...userFromRequest(req),
  };
  const q = url.searchParams;
  // Discord Activity: the proxy hides the player's IP – never use it for bans
  ctx.activity = isActivityRequest(req);
  ctx.ipHash = ctx.activity ? null : hashIp(ctx.ip);
  const guestPid = /^[a-zA-Z0-9_-]{8,40}$/.test(q.get('pid') || '') ? q.get('pid') : null;
  ctx.sanction = activeSanction({ userId: ctx.user?.id, pid: ctx.user ? null : guestPid, ipHash: ctx.ipHash });
  try {
    if (method !== 'GET' && method !== 'HEAD') checkOrigin(req);
    // banned: nothing but reading and logging out
    if (ctx.sanction?.type === 'ban' && method !== 'GET' && method !== 'HEAD' && p !== '/api/auth/logout') {
      throw new HttpError(403, 'banned', { sanction: ctx.sanction });
    }

    // --- Discord Activity ---
    if (p.startsWith('/api/activity/') && (await handleActivityApi(req, res, p, method, ctx))) return true;

    // --- auth ---
    if (p === '/api/me' && method === 'GET') {
      json(res, 200, {
        user: privateUser(ctx.user),
        stats: ctx.user ? userStats(ctx.user.id) : null,
        discord: discordConfig().enabled,
        sanction: ctx.sanction,
      });
      return true;
    }
    if (p === '/api/me' && method === 'PATCH') return (await updateMe(req, res, ctx), true);
    if (p === '/api/me' && method === 'DELETE') return (await deleteMe(req, res, ctx), true);
    if (p === '/api/me/password' && method === 'POST') return (await changePassword(req, res, ctx), true);
    if (p === '/api/me/discord' && method === 'DELETE') return (await unlinkDiscord(req, res, ctx), true);
    if (p === '/api/auth/register' && method === 'POST') return (await register(req, res, ctx), true);
    if (p === '/api/auth/login' && method === 'POST') return (await login(req, res, ctx), true);
    if (p === '/api/auth/logout' && method === 'POST') {
      destroySession(ctx.token);
      json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(ctx.secure) });
      return true;
    }
    if (p === '/api/auth/username' && method === 'GET') {
      const name = String(q.get('name') || '');
      let free = false;
      try {
        validateUsername(name);
        free = usernameFree(name);
      } catch {
        free = false;
      }
      json(res, 200, { free });
      return true;
    }
    if (p === '/api/auth/discord' && method === 'GET') return (await discordLoginStart(req, res, ctx), true);
    if (p === '/api/auth/discord/callback' && method === 'GET') return (await discordCallback(req, res, ctx), true);

    // --- public data ---
    if (p === '/api/leaderboard' && method === 'GET') {
      const metric = q.get('metric') || 'points';
      const period = q.get('period') || 'all';
      const limit = Math.min(100, Number(q.get('limit')) || 50);
      // the same for everybody: computed at most every 15 s (and again after new results)
      apiCache.send(req, res, `leaderboard:${metric}:${period}:${limit}`, 15_000, () => ({
        metric,
        period,
        rows: leaderboard(metric, period, limit),
      }));
      return true;
    }
    if (p === '/api/memes' && method === 'GET') {
      const list = () =>
        listMemes({
          sort: q.get('sort') || 'top',
          period: q.get('period') || 'all',
          username: q.get('user') || null,
          viewer: ctx.user,
          limit: q.get('limit'),
          offset: q.get('offset'),
        });
      // guests all see the same list; with an account it contains "liked by me" and is never cached
      if (!ctx.user) {
        const key = `memes:${q.get('sort')}:${q.get('period')}:${q.get('user')}:${q.get('limit')}:${q.get('offset')}`;
        apiCache.send(req, res, key, 10_000, list, { cacheControl: 'private, no-cache' });
      } else json(res, 200, list());
      return true;
    }
    const memeMatch = /^\/api\/memes\/([A-Za-z0-9_-]{6,20})(\/like)?$/.exec(p);
    if (memeMatch) {
      const [, id, like] = memeMatch;
      if (!like && method === 'GET') return (json(res, 200, { meme: getMeme(id, ctx.user) }), true);
      if (like && method === 'POST') {
        const user = requireUser(ctx.user);
        if (!writeLimiter.hit(`u${user.id}`)) throw new HttpError(429, 'too_many_attempts');
        return (json(res, 200, toggleLike(id, user)), true);
      }
      if (!like && method === 'DELETE') return (json(res, 200, deleteMeme(id, requireUser(ctx.user))), true);
    }
    const userMatch = /^\/api\/users\/([a-zA-Z0-9_.-]{3,20})$/.exec(p);
    if (userMatch && method === 'GET') return (publicProfile(res, ctx, userMatch[1]), true);
    if (p === '/api/studio/search' && method === 'GET') return (await studioSearch(res, ctx, q), true);
    if (p === '/api/reports' && method === 'POST') return (await publicReport(req, res, ctx), true);
    if (p.startsWith('/api/admin/') && (await adminRoutes(req, res, ctx, p, method, q))) return true;
    if (p === '/api/admin/reviews' && method === 'GET') return (json(res, 200, { packs: listReviews(requireUser(ctx.user)) }), true);
    const reviewMatch = /^\/api\/admin\/packs\/([A-Za-z0-9_-]{6,20})\/review$/.exec(p);
    if (reviewMatch && method === 'POST') {
      const body = await readJson(req);
      const admin = requireAdmin(ctx);
      const pack = reviewPack(reviewMatch[1], admin, { approve: Boolean(body.approve), note: body.note });
      logAction(admin, body.approve ? 'approve_pack' : 'reject_pack', `pack:${pack.id} (${pack.name})`, body.note || '');
      return (json(res, 200, { pack }), true);
    }
    if (p.startsWith('/api/packs') && (await packRoutes(req, res, ctx, p, method, q))) return true;
    if (p === '/api/community' && method === 'GET') {
      // shown on the start page: the parts that are the same for everybody are computed at most every 15 s
      const shared = () =>
        apiCache.value('community', 15_000, () => ({
          stats: siteStats(),
          topPlayers: leaderboard('points', 'week', 5),
          topMemes: listMemes({ sort: 'top', period: 'week', viewer: null, limit: 4 }).items,
        }));
      // with an account the memes carry "liked by me": always fresh, never from the cache
      if (ctx.user) json(res, 200, { ...shared(), topMemes: listMemes({ sort: 'top', period: 'week', viewer: ctx.user, limit: 4 }).items });
      else apiCache.send(req, res, 'community:guest', 15_000, shared, { cacheControl: 'private, no-cache' });
      return true;
    }
    return false;
  } catch (err) {
    if (!req.complete) req.resume(); // unread request body (early rejection)
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.code, ...err.extra });
      return true;
    }
    throw err;
  }
}
