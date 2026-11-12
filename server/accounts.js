import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { randomAvatar, sanitizeAvatar, sanitizeName } from '../lib/shared.js';
import { getConfig } from './config.js';
import { all, get, run, sha256, transaction } from './db.js';
import { removeUserUploads } from './uploads.js';
import { HttpError, parseCookies, serializeCookie } from './http.js';

const scrypt = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'lt_session';
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'laughtime', 'onyoursite', 'moderator', 'mod',
  'api', 'login', 'logout', 'register', 'account', 'settings', 'me', 'null', 'undefined', 'guest',
]);

// --- passwords ---------------------------------------------------------------

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, N, r, p, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// a real hash to compare against when the user does not exist (same timing)
let dummyHash = null;
export async function dummyVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
  return false;
}

// --- validation --------------------------------------------------------------

export function validateUsername(name) {
  const u = String(name ?? '').trim();
  if (!USERNAME_RE.test(u)) throw new HttpError(400, 'username_invalid');
  if (RESERVED.has(u.toLowerCase())) throw new HttpError(400, 'username_taken');
  return u;
}

export function validatePassword(pw) {
  const p = String(pw ?? '');
  if (p.length < 8) throw new HttpError(400, 'password_short');
  if (p.length > 200) throw new HttpError(400, 'password_long');
  return p;
}

export function cleanBio(bio) {
  return String(bio ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// --- users -------------------------------------------------------------------

const adminNames = () =>
  new Set(
    String(process.env.ADMIN_USERNAMES || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

export function isAdmin(user) {
  return Boolean(user && (user.is_admin || adminNames().has(user.username.toLowerCase())));
}

export const getUserById = (id) => get('SELECT * FROM users WHERE id = ?', id);
export const getUserByName = (name) => get('SELECT * FROM users WHERE username = ?', String(name ?? ''));
export const getUserByDiscord = (discordId) => get('SELECT * FROM users WHERE discord_id = ?', String(discordId));

export function usernameFree(name) {
  return !RESERVED.has(String(name).toLowerCase()) && !getUserByName(name);
}

/** Makes a valid, unused username out of any string (used for Discord sign-ups). */
export function suggestUsername(base) {
  let clean = String(base || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 16);
  if (clean.length < 3) clean = `player${clean}`;
  if (usernameFree(clean)) return clean;
  for (let i = 0; i < 50; i++) {
    const candidate = `${clean.slice(0, 15)}${crypto.randomInt(10, 99999)}`;
    if (usernameFree(candidate)) return candidate;
  }
  return `player${crypto.randomInt(100000, 999999)}`;
}

export function createUser({ username, displayName, passwordHash = null, discordId = null, discordName = null, avatar }) {
  const now = Date.now();
  const info = run(
    `INSERT INTO users (username, display_name, password_hash, discord_id, discord_name, avatar, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    username,
    sanitizeName(displayName) || username,
    passwordHash,
    discordId,
    discordName,
    sanitizeAvatar(avatar || randomAvatar()),
    now,
    now,
  );
  return getUserById(Number(info.lastInsertRowid));
}

export function updateUser(id, fields) {
  const allowed = ['display_name', 'avatar', 'bio', 'password_hash', 'discord_id', 'discord_name', 'last_seen', 'show_memes'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return getUserById(id);
  run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]), id);
  return getUserById(id);
}

export function deleteUser(id) {
  removeUserUploads(id);
  transaction(() => {
    // likes the user gave: keep counters correct
    for (const row of all('SELECT meme_id FROM meme_likes WHERE user_id = ?', id)) {
      run('UPDATE memes SET likes = MAX(0, likes - 1) WHERE id = ?', row.meme_id);
    }
    run('DELETE FROM users WHERE id = ?', id);
  });
}

/** What the browser is allowed to see about the logged-in user. */
export function privateUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar,
    bio: u.bio,
    hasPassword: Boolean(u.password_hash),
    discord: u.discord_id ? { name: u.discord_name } : null,
    isAdmin: isAdmin(u),
    showMemes: Boolean(u.show_memes),
    createdAt: u.created_at,
  };
}

/** What everybody may see. */
export function publicUser(u) {
  if (!u) return null;
  return { username: u.username, displayName: u.display_name, avatar: u.avatar };
}

// --- sessions ----------------------------------------------------------------

export function createSession(userId, days = SESSION_DAYS) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token),
    userId,
    now,
    now + days * 86400_000,
  );
  return token;
}

export function sessionCookie(token, secure) {
  return serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure });
}

export function clearSessionCookie(secure) {
  return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure });
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function destroyUserSessions(userId, exceptToken) {
  if (exceptToken) run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', userId, sha256(exceptToken));
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

const lastSeenWrites = new Map();

export const WS_AUTH_PREFIX = 'lt-auth.';

/**
 * Session token of a request: the cookie (website), an "Authorization: Bearer"
 * header or a WebSocket sub-protocol "lt-auth.<token>" (Discord Activity, where
 * third-party cookies are not reliable).
 */
export function sessionToken(req) {
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (cookie) return cookie;
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const proto = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((x) => x.trim())
    .find((x) => x.startsWith(WS_AUTH_PREFIX));
  return proto ? proto.slice(WS_AUTH_PREFIX.length) : '';
}

/** Returns { user, token } for the request's session, or { user: null }. */
export function userFromRequest(req) {
  const token = sessionToken(req);
  if (!token || token.length > 100) return { user: null, token: null };
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    sha256(token),
    Date.now(),
  );
  if (!row) return { user: null, token: null };
  const t = Date.now();
  if (t - (lastSeenWrites.get(row.id) || 0) > 5 * 60_000) {
    lastSeenWrites.set(row.id, t);
    run('UPDATE users SET last_seen = ? WHERE id = ?', t, row.id);
  }
  return { user: row, token };
}

export function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
}

// --- discord -----------------------------------------------------------------

export function discordConfig() {
  const cfg = getConfig();
  const clientId = process.env.DISCORD_CLIENT_ID || '';
  const clientSecret = process.env.DISCORD_CLIENT_SECRET || '';
  return {
    enabled: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    redirectUri: process.env.DISCORD_REDIRECT_URI || `${cfg.publicUrl.replace(/\/$/, '')}/api/auth/discord/callback`,
    authorizeUrl: process.env.DISCORD_AUTHORIZE_URL || 'https://discord.com/oauth2/authorize',
    apiUrl: (process.env.DISCORD_API_URL || 'https://discord.com/api').replace(/\/$/, ''),
  };
}
