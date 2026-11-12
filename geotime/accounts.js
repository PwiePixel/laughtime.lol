/**
 * GeoTime.lol – eigener Login
 *
 * Eigene Konten in der eigenen Datenbank (data/geotime.db). Mit den Konten von
 * LaughTime hat das nichts zu tun – die Projekte bleiben getrennt, auch hier.
 *
 * Passwörter liegen als scrypt-Hash mit eigenem Salz. Die Anmeldung läuft über
 * ein Cookie (gt_session), das nur für GeoTime gilt.
 */
import crypto from 'node:crypto';
import { getDb } from './db.js';

const SESSION_DAYS = 30;
const COOKIE = 'gt_session';
const NAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;

const now = () => Date.now();

// --- Passwörter --------------------------------------------------------------

const hash = (password, salt) => crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');

function verify(password, player) {
  if (!player?.pass_hash || !player?.pass_salt) return false;
  const a = Buffer.from(hash(password, player.pass_salt), 'hex');
  const b = Buffer.from(player.pass_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Konten ------------------------------------------------------------------

export const publicPlayer = (p) =>
  p && { id: p.id, username: p.username, name: p.name, avatar: p.avatar, lang: p.lang || 'en' };

export function findByName(db, username) {
  return db.prepare('SELECT * FROM players WHERE username = ? COLLATE NOCASE').get(username) || null;
}

export function createAccount(db, { username, password, name }) {
  if (!NAME_RE.test(username)) throw new Error('bad_username');
  if (typeof password !== 'string' || password.length < 8) throw new Error('weak_password');
  if (findByName(db, username)) throw new Error('name_taken');
  const salt = crypto.randomBytes(16).toString('hex');
  const at = now();
  const info = db
    .prepare(
      'INSERT INTO players (username, pass_hash, pass_salt, name, lang, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(username, hash(password, salt), salt, String(name || username).slice(0, 24), 'en', at, at);
  return db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid);
}

export function login(db, { username, password }) {
  const player = findByName(db, String(username || ''));
  if (!player || !verify(String(password || ''), player)) return null;
  db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now(), player.id);
  return player;
}

export function setLang(db, playerId, lang) {
  db.prepare('UPDATE players SET lang = ? WHERE id = ?').run(lang === 'en' ? 'en' : 'de', playerId);
}

// --- Anmeldungen -------------------------------------------------------------

export function createSession(db, playerId) {
  const token = crypto.randomBytes(24).toString('base64url');
  const at = now();
  db.prepare('INSERT INTO sessions (token, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    playerId,
    at,
    at + SESSION_DAYS * 86400_000,
  );
  return token;
}

export function playerForToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare('SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ? AND s.expires_at > ?')
    .get(token, now());
  return row || null;
}

export const dropSession = (db, token) => token && db.prepare('DELETE FROM sessions WHERE token = ?').run(token);

// --- Cookies -----------------------------------------------------------------

export function cookieValue(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export const sessionToken = (req) => cookieValue(req, COOKIE);

export function sessionCookie(token, { secure, days = SESSION_DAYS } = {}) {
  const bits = [
    `${COOKIE}=${token || ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${token ? days * 86400 : 0}`,
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/** Wer ist das? (für HTTP-Anfragen und für den WebSocket beim Upgrade) */
export function playerFor(req, instanceId) {
  try {
    return playerForToken(getDb(instanceId), sessionToken(req));
  } catch {
    return null;
  }
}

export { COOKIE as SESSION_COOKIE, NAME_RE };
