import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { MOD_REASONS, REPORT_REASONS, SANCTION_DURATIONS, SANCTION_TYPES, sanitizeName } from '../lib/shared.js';
import { getUserById, isAdmin, publicUser } from './accounts.js';
import { ROOT } from './config.js';
import { all, get, run, transaction } from './db.js';
import { HttpError } from './http.js';
import { UPLOAD_DIR } from './uploads.js';
import { notifyModerators } from './webhook.js';

// ---------------------------------------------------------------------------
// Moderation: reports from players, bans / restrictions, admin log and the
// numbers for the admin dashboard.
//
//   ban      -> locked out completely (no playing, no account features)
//   restrict -> only private rooms (no quick play, uploads, profile/name
//               changes, no memes in the public gallery)
//
// Targets are accounts (user id) or guests (browser id "pid" + hashed IP).
// IP addresses are never stored in plain text.
// ---------------------------------------------------------------------------

const DAY = 86400_000;
const REPORT_KEEP_MS = 90 * DAY;
const METRICS_KEEP_MS = 35 * DAY;

// live actions are provided by the game server (avoids circular imports)
let hooks = {
  applySanction: () => 0,
  forceRename: () => 0,
  kick: () => 0,
  findOnline: () => [],
  playerInfo: () => null,
};
export function setLiveHooks(h) {
  hooks = { ...hooks, ...h };
}

// --- hashing ---------------------------------------------------------------------

let salt = null;
function getSalt() {
  if (salt) return salt;
  if (process.env.MODERATION_SALT) {
    salt = process.env.MODERATION_SALT;
    return salt;
  }
  const file = path.join(ROOT, 'data', '.moderation-salt');
  try {
    salt = fs.readFileSync(file, 'utf8').trim();
  } catch {
    salt = '';
  }
  if (!salt) {
    salt = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, salt, { mode: 0o600 });
  }
  return salt;
}

export const hashIp = (ip) => (ip ? crypto.createHmac('sha256', getSalt()).update(String(ip)).digest('hex').slice(0, 32) : null);

const ch = (n) => String.fromCharCode(n);
const CTRL = new RegExp(`[${ch(0)}-${ch(31)}${ch(127)}<>]`, 'g');
const cleanText = (v, max) =>
  String(v ?? '')
    .replace(CTRL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const PID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

export function parseKey(key) {
  const m = /^(u|g):(.+)$/.exec(String(key || ''));
  if (!m) return null;
  if (m[1] === 'u') {
    const id = Number(m[2]);
    return Number.isInteger(id) && id > 0 ? { userId: id } : null;
  }
  return PID_RE.test(m[2]) ? { pid: m[2] } : null;
}
export const keyOf = ({ userId, pid }) => (userId ? `u:${userId}` : `g:${pid}`);

// --- admin log ---------------------------------------------------------------------

export function logAction(admin, action, target = '', details = '') {
  run(
    'INSERT INTO admin_log (admin_id, admin_name, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    admin?.id ?? null,
    admin?.username ?? 'system',
    action,
    String(target).slice(0, 200),
    typeof details === 'string' ? details.slice(0, 500) : JSON.stringify(details).slice(0, 500),
    Date.now(),
  );
}

export function listLog({ limit = 100, before = null } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 100));
  const rows = before
    ? all('SELECT * FROM admin_log WHERE id < ? ORDER BY id DESC LIMIT ?', Number(before), lim)
    : all('SELECT * FROM admin_log ORDER BY id DESC LIMIT ?', lim);
  return rows.map((r) => ({
    id: r.id,
    admin: r.admin_name,
    action: r.action,
    target: r.target,
    details: r.details,
    createdAt: r.created_at,
  }));
}

// --- sanctions -----------------------------------------------------------------------

const ACTIVE = '(lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?))';

function sanctionJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    reason: row.reason,
    note: row.note,
    until: row.expires_at,
    createdAt: row.created_at,
  };
}

/** the strongest active sanction for an account / guest (ban wins over restrict) */
export function activeSanction({ userId = null, pid = null, ipHash = null } = {}) {
  const conds = [];
  const params = [Date.now()];
  if (userId) {
    conds.push('user_id = ?');
    params.push(userId);
  }
  if (pid) {
    conds.push('pid = ?');
    params.push(pid);
  }
  // IP blocks only apply to guests (and sign-ups), so shared networks don't lock out existing accounts
  if (ipHash && !userId) {
    conds.push('ip_hash = ?');
    params.push(ipHash);
  }
  if (!conds.length) return null;
  const row = get(
    `SELECT * FROM sanctions WHERE ${ACTIVE} AND (${conds.join(' OR ')})
     ORDER BY (type = 'ban') DESC, (expires_at IS NULL) DESC, expires_at DESC LIMIT 1`,
    ...params,
  );
  return sanctionJson(row);
}

export const isBanned = (who) => activeSanction(who)?.type === 'ban';

function resolveTarget(target) {
  // { key } | { userId } | { pid }
  const t = target?.key ? parseKey(target.key) : target;
  if (!t || (!t.userId && !t.pid)) throw new HttpError(400, 'bad_target');
  if (t.userId) {
    const user = getUserById(t.userId);
    if (!user) throw new HttpError(404, 'user_not_found');
    return { userId: user.id, user, name: user.display_name, key: keyOf({ userId: user.id }) };
  }
  const live = hooks.playerInfo({ pid: t.pid });
  const last = get('SELECT target_name, target_ip_hash FROM reports WHERE target_pid = ? ORDER BY id DESC LIMIT 1', t.pid);
  return {
    pid: t.pid,
    ipHash: live?.ipHash || last?.target_ip_hash || null,
    name: live?.name || last?.target_name || 'Guest',
    key: keyOf({ pid: t.pid }),
  };
}

function resolveReportsFor(key, admin, resolution) {
  run(
    "UPDATE reports SET status = 'resolved', resolution = ?, handled_by = ?, handled_at = ? WHERE target_key = ? AND status = 'open'",
    resolution,
    admin?.id ?? null,
    Date.now(),
    key,
  );
}

export function createSanction(admin, { target, type, duration, reason, note = '', withIp = false }) {
  if (!SANCTION_TYPES.includes(type)) throw new HttpError(400, 'bad_type');
  if (!(duration in SANCTION_DURATIONS)) throw new HttpError(400, 'bad_duration');
  if (!MOD_REASONS.includes(reason)) throw new HttpError(400, 'bad_reason');
  const cleanNote = cleanText(note, 300);
  if (reason === 'other' && !cleanNote) throw new HttpError(400, 'note_required');
  const t = resolveTarget(target);
  if (t.user && isAdmin(t.user)) throw new HttpError(400, 'cannot_sanction_admin');
  if (t.userId && t.userId === admin.id) throw new HttpError(400, 'cannot_sanction_admin');
  const ms = SANCTION_DURATIONS[duration];
  const now = Date.now();
  // guests are always identified by browser id; the IP only if the admin wants it
  const ipHash = withIp || (!t.userId && !t.pid) ? t.ipHash || null : null;
  const id = Number(
    run(
      `INSERT INTO sanctions (type, user_id, pid, ip_hash, target_name, reason, note, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      type,
      t.userId || null,
      t.pid || null,
      ipHash,
      t.name || '',
      reason,
      cleanNote,
      admin.id,
      now,
      ms === null ? null : now + ms,
    ).lastInsertRowid,
  );
  resolveReportsFor(t.key, admin, `${type}:${duration}:${reason}`);
  logAction(admin, type, `${t.key} (${t.name})`, { duration, reason, note: cleanNote, ip: Boolean(ipHash) });
  const sanction = sanctionJson(get('SELECT * FROM sanctions WHERE id = ?', id));
  const affected = hooks.applySanction({ userId: t.userId, pid: t.pid, ipHash }, sanction);
  return { sanction, affected };
}

export function liftSanction(admin, id) {
  const row = get('SELECT * FROM sanctions WHERE id = ?', Number(id));
  if (!row) throw new HttpError(404, 'not_found');
  if (row.lifted_at) return { ok: true };
  run('UPDATE sanctions SET lifted_at = ?, lifted_by = ? WHERE id = ?', Date.now(), admin.id, row.id);
  logAction(admin, `lift_${row.type}`, `${row.user_id ? `u:${row.user_id}` : `g:${row.pid}`} (${row.target_name})`, `#${row.id}`);
  return { ok: true };
}

export function listSanctions({ active = true, limit = 100 } = {}) {
  const now = Date.now();
  const rows = active
    ? all(`SELECT * FROM sanctions WHERE ${ACTIVE} ORDER BY created_at DESC LIMIT ?`, now, limit)
    : all('SELECT * FROM sanctions ORDER BY created_at DESC LIMIT ?', limit);
  const admins = new Map();
  const adminName = (id) => {
    if (!id) return 'system';
    if (!admins.has(id)) admins.set(id, getUserById(id)?.username || '?');
    return admins.get(id);
  };
  return rows.map((r) => {
    const user = r.user_id ? getUserById(r.user_id) : null;
    return {
      ...sanctionJson(r),
      key: r.user_id ? `u:${r.user_id}` : `g:${r.pid}`,
      target: user ? publicUser(user) : null,
      name: user?.display_name || r.target_name,
      guest: !r.user_id,
      withIp: Boolean(r.ip_hash),
      by: adminName(r.created_by),
      active: !r.lifted_at && (r.expires_at === null || r.expires_at > now),
      liftedAt: r.lifted_at,
    };
  });
}

// --- name resets & kicks -----------------------------------------------------------------

const randomPlayerName = () => `Player ${crypto.randomInt(1000, 10000)}`;

export function resetName(admin, target) {
  const t = resolveTarget(target);
  const name = randomPlayerName();
  if (t.userId) run("UPDATE users SET display_name = ?, bio = '' WHERE id = ?", name, t.userId);
  const affected = hooks.forceRename({ userId: t.userId, pid: t.pid }, name);
  resolveReportsFor(t.key, admin, 'name_reset');
  logAction(admin, 'reset_name', `${t.key} (${t.name})`, `→ ${name}`);
  return { name, affected };
}

export function resetUsername(admin, userId) {
  const user = getUserById(Number(userId));
  if (!user) throw new HttpError(404, 'user_not_found');
  let username;
  for (let i = 0; i < 20; i++) {
    username = `player_${crypto.randomInt(100000, 1000000)}`;
    if (!get('SELECT 1 AS x FROM users WHERE username = ?', username)) break;
  }
  const display = randomPlayerName();
  run("UPDATE users SET username = ?, display_name = ?, bio = '' WHERE id = ?", username, display, user.id);
  hooks.forceRename({ userId: user.id }, display);
  resolveReportsFor(`u:${user.id}`, admin, 'username_reset');
  logAction(admin, 'reset_username', `u:${user.id} (${user.username})`, `→ ${username}`);
  return { username, displayName: display };
}

export function kickTarget(admin, target) {
  const t = resolveTarget(target);
  const affected = hooks.kick({ userId: t.userId, pid: t.pid });
  logAction(admin, 'kick', `${t.key} (${t.name})`, `${affected} room(s)`);
  return { affected };
}

// --- reports ------------------------------------------------------------------------------

const reportHits = new Map(); // reporter -> [times]

function rateOk(reporterKey) {
  const t = Date.now();
  const list = (reportHits.get(reporterKey) || []).filter((x) => t - x < 10 * 60_000);
  if (list.length >= 8) return false;
  list.push(t);
  reportHits.set(reporterKey, list);
  if (reportHits.size > 5000) reportHits.clear();
  return true;
}

async function keepEvidence(context) {
  // room uploads are deleted after the game -> keep a copy for the admins
  const src = context?.media?.src;
  const m = /^\/api\/uploads\/rooms\/([A-Za-z0-9_-]{16,40}\.(png|jpg|gif|webp))$/.exec(src || '');
  if (!m) return context;
  try {
    const dir = path.join(UPLOAD_DIR, 'reports');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.copyFile(path.join(UPLOAD_DIR, 'rooms', m[1]), path.join(dir, m[1]));
    return { ...context, media: { ...context.media, src: `/api/uploads/reports/${m[1]}` } };
  } catch {
    return context;
  }
}

/**
 * reporter: { userId, pid, ipHash, name }
 * target:   { userId, pid, ipHash, name, avatar }
 */
export async function createReport({ reporter, target, reason, comment = '', roomCode = null, context = null }) {
  if (!REPORT_REASONS.includes(reason)) throw new HttpError(400, 'bad_reason');
  if (!target || (!target.userId && !target.pid)) throw new HttpError(400, 'bad_target');
  const rKey = reporter.userId ? `u:${reporter.userId}` : `g:${reporter.pid || reporter.ipHash}`;
  const tKey = keyOf(target);
  if (rKey === tKey) throw new HttpError(400, 'cannot_report_self');
  if (!rateOk(rKey)) throw new HttpError(429, 'too_many_reports');
  // the same report twice within 30 minutes is ignored
  const dup = get(
    `SELECT id FROM reports WHERE target_key = ? AND reason = ? AND created_at > ?
     AND ((reporter_user_id IS NOT NULL AND reporter_user_id = ?) OR (reporter_pid IS NOT NULL AND reporter_pid = ?))`,
    tKey,
    reason,
    Date.now() - 30 * 60_000,
    reporter.userId ?? -1,
    reporter.pid ?? '',
  );
  if (dup) return { ok: true, duplicate: true };
  const ctx = context ? await keepEvidence(context) : null;
  run(
    `INSERT INTO reports (target_key, target_user_id, target_pid, target_ip_hash, target_name, target_avatar,
       reporter_user_id, reporter_pid, reporter_ip_hash, reporter_name, reason, comment, room_code, context, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    tKey,
    target.userId || null,
    target.userId ? null : target.pid,
    target.ipHash || null,
    sanitizeName(target.name) || '?',
    String(target.avatar || ''),
    reporter.userId || null,
    reporter.pid || null,
    reporter.ipHash || null,
    sanitizeName(reporter.name) || '',
    reason,
    cleanText(comment, 300),
    roomCode,
    ctx ? JSON.stringify(ctx) : null,
    Date.now(),
  );
  // optional heads-up in the moderators' Discord channel (category only, coalesced)
  notifyModerators('report', reason);
  return { ok: true };
}

export function listReports({ status = 'open' } = {}) {
  const st = ['open', 'resolved', 'dismissed'].includes(status) ? status : 'open';
  const rows = all(`SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT 500`, st);
  const groups = new Map();
  for (const r of rows) {
    let g = groups.get(r.target_key);
    if (!g) {
      const user = r.target_user_id ? getUserById(r.target_user_id) : null;
      const who = r.target_user_id ? { userId: r.target_user_id } : { pid: r.target_pid };
      g = {
        key: r.target_key,
        guest: !r.target_user_id,
        user: user ? { ...publicUser(user), id: user.id, isAdmin: isAdmin(user) } : null,
        name: user?.display_name || r.target_name,
        avatar: user?.avatar || r.target_avatar,
        reportedName: r.target_name,
        online: hooks.findOnline(who),
        sanction: activeSanction(who),
        previous: get(
          'SELECT COUNT(*) AS n FROM sanctions WHERE ' + (r.target_user_id ? 'user_id = ?' : 'pid = ?'),
          r.target_user_id || r.target_pid,
        ).n,
        reasons: {},
        latest: r.created_at,
        reports: [],
      };
      groups.set(r.target_key, g);
    }
    g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
    g.reports.push({
      id: r.id,
      reason: r.reason,
      comment: r.comment,
      reportedName: r.target_name,
      reporter: r.reporter_name || (r.reporter_user_id ? `#${r.reporter_user_id}` : 'Guest'),
      reporterAccount: Boolean(r.reporter_user_id),
      room: r.room_code,
      context: r.context ? JSON.parse(r.context) : null,
      resolution: r.resolution,
      createdAt: r.created_at,
    });
  }
  // targets with many open reports first
  return [...groups.values()].sort((a, b) => b.reports.length - a.reports.length || b.latest - a.latest);
}

export function dismissReports(admin, key) {
  if (!parseKey(key)) throw new HttpError(400, 'bad_target');
  const n = run(
    "UPDATE reports SET status = 'dismissed', resolution = 'dismissed', handled_by = ?, handled_at = ? WHERE target_key = ? AND status = 'open'",
    admin.id,
    Date.now(),
    key,
  ).changes;
  logAction(admin, 'dismiss_reports', key, `${n} report(s)`);
  return { dismissed: Number(n) };
}

export const openReportCount = () => get("SELECT COUNT(DISTINCT target_key) AS n FROM reports WHERE status = 'open'")?.n ?? 0;

// --- users (admin) ----------------------------------------------------------------------------

export function searchUsers(q = '', limit = 50) {
  const term = cleanText(q, 40).replace(/[%_]/g, '');
  const like = `%${term}%`;
  const rows = all(
    `SELECT u.*, (SELECT COUNT(*) FROM game_results g WHERE g.user_id = u.id) AS games,
            (SELECT COUNT(*) FROM reports r WHERE r.target_user_id = u.id) AS reports
     FROM users u WHERE u.username LIKE ? OR u.display_name LIKE ?
     ORDER BY ${term ? 'u.last_seen' : 'u.created_at'} DESC LIMIT ?`,
    like,
    like,
    Math.min(100, Number(limit) || 50),
  );
  return rows.map((u) => ({
    id: u.id,
    ...publicUser(u),
    isAdmin: isAdmin(u),
    discord: Boolean(u.discord_id),
    createdAt: u.created_at,
    lastSeen: u.last_seen,
    games: Number(u.games),
    reports: Number(u.reports),
    sanction: activeSanction({ userId: u.id }),
    online: hooks.findOnline({ userId: u.id }).length > 0,
  }));
}

export function userDetails(id) {
  const u = getUserById(Number(id));
  if (!u) throw new HttpError(404, 'user_not_found');
  const g = get('SELECT COUNT(*) AS games, COALESCE(SUM(points),0) AS points, COALESCE(SUM(won),0) AS wins FROM game_results WHERE user_id = ?', u.id);
  return {
    id: u.id,
    ...publicUser(u),
    bio: u.bio,
    isAdmin: isAdmin(u),
    discord: u.discord_id ? u.discord_name : null,
    hasPassword: Boolean(u.password_hash),
    showMemes: Boolean(u.show_memes),
    createdAt: u.created_at,
    lastSeen: u.last_seen,
    stats: { games: Number(g.games), points: Number(g.points), wins: Number(g.wins) },
    memes: get('SELECT COUNT(*) AS n FROM memes WHERE user_id = ?', u.id).n,
    packs: get('SELECT COUNT(*) AS n FROM packs WHERE user_id = ?', u.id).n,
    uploads: get('SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?', u.id).n,
    online: hooks.findOnline({ userId: u.id }),
    sanction: activeSanction({ userId: u.id }),
    sanctions: listSanctions({ active: false, limit: 500 }).filter((s) => s.key === `u:${u.id}`).slice(0, 20),
    reports: all('SELECT reason, comment, reporter_name, room_code, created_at, status FROM reports WHERE target_user_id = ? ORDER BY id DESC LIMIT 30', u.id).map(
      (r) => ({ reason: r.reason, comment: r.comment, reporter: r.reporter_name, room: r.room_code, createdAt: r.created_at, status: r.status }),
    ),
  };
}

// --- activity & metrics ----------------------------------------------------------------------

const HOUR = 3600_000;

export function recordActivity(key, n = 1) {
  const bucket = Math.floor(Date.now() / HOUR) * HOUR;
  run(
    'INSERT INTO activity (bucket, key, count) VALUES (?, ?, ?) ON CONFLICT(bucket, key) DO UPDATE SET count = count + excluded.count',
    bucket,
    String(key).slice(0, 40),
    n,
  );
}

export function sampleMetrics({ players, rooms, playing, queue }) {
  const ts = Math.floor(Date.now() / 60_000) * 60_000;
  run('INSERT OR REPLACE INTO metrics (ts, players, rooms, playing, queue) VALUES (?, ?, ?, ?, ?)', ts, players, rooms, playing, queue);
}

const RANGES = {
  '24h': { span: DAY, step: HOUR, sample: 10 * 60_000 },
  '7d': { span: 7 * DAY, step: 6 * HOUR, sample: HOUR },
  '30d': { span: 30 * DAY, step: DAY, sample: 4 * HOUR },
};

export function dashboardStats(range = '24h', live = {}) {
  const r = RANGES[range] || RANGES['24h'];
  const now = Date.now();
  const end = Math.ceil(now / r.step) * r.step;
  const start = end - r.span;
  const steps = Math.round(r.span / r.step);
  const bucketOf = (t) => Math.floor((t - start) / r.step);

  // players online / rooms (averaged + peak per sample window)
  const sSteps = Math.round(r.span / r.sample);
  const sStart = Math.floor(now / r.sample) * r.sample - (sSteps - 1) * r.sample;
  const online = Array.from({ length: sSteps }, (_, i) => ({ t: sStart + i * r.sample, players: 0, peak: 0, playing: 0, rooms: 0, n: 0 }));
  for (const m of all('SELECT * FROM metrics WHERE ts >= ?', sStart)) {
    const b = online[Math.floor((m.ts - sStart) / r.sample)];
    if (!b) continue;
    b.players += m.players;
    b.playing += m.playing;
    b.rooms += m.rooms;
    b.peak = Math.max(b.peak, m.players);
    b.n += 1;
  }
  const onlineSeries = online.map((b) =>
    b.n
      ? { t: b.t, players: Math.round((b.players / b.n) * 10) / 10, peak: b.peak, playing: Math.round((b.playing / b.n) * 10) / 10, rooms: Math.round((b.rooms / b.n) * 10) / 10 }
      : { t: b.t, players: null, peak: null, playing: null, rooms: null },
  );

  // rounds & games per bucket, by mode
  const rounds = Array.from({ length: steps }, (_, i) => ({ t: start + i * r.step, classic: 0, hunt: 0, swap: 0 }));
  const modes = { classic: { rounds: 0, games: 0 }, hunt: { rounds: 0, games: 0 }, swap: { rounds: 0, games: 0 } };
  let matches = 0;
  let uploads = 0;
  let discord = 0;
  for (const a of all('SELECT * FROM activity WHERE bucket >= ?', start - HOUR)) {
    if (a.bucket < start) continue;
    const [kind, mode] = a.key.split(':');
    if (kind === 'round' && mode in modes) {
      const b = rounds[bucketOf(a.bucket)];
      if (b) b[mode] += a.count;
      modes[mode].rounds += a.count;
    } else if (kind === 'game' && mode in modes) modes[mode].games += a.count;
    else if (kind === 'match') matches += a.count;
    else if (kind === 'upload') uploads += a.count;
    else if (kind === 'discord') discord += a.count;
  }

  // signups & reports per bucket
  const perBucket = (sql) => {
    const out = Array.from({ length: steps }, (_, i) => ({ t: start + i * r.step, n: 0 }));
    for (const row of all(sql, start)) {
      const b = out[bucketOf(row.created_at)];
      if (b) b.n += 1;
    }
    return out;
  };
  const signups = perBucket('SELECT created_at FROM users WHERE created_at >= ?');
  const reports = perBucket('SELECT created_at FROM reports WHERE created_at >= ?');

  const peakRow = get('SELECT MAX(players) AS p FROM metrics WHERE ts >= ?', now - r.span);
  return {
    range,
    step: r.step,
    live: {
      ...live,
      openReports: openReportCount(),
      activeSanctions: get(`SELECT COUNT(*) AS n FROM sanctions WHERE ${ACTIVE}`, now).n,
      pendingPacks: get("SELECT COUNT(*) AS n FROM packs WHERE review = 'pending'").n,
      users: get('SELECT COUNT(*) AS n FROM users').n,
    },
    totals: {
      rounds: Object.values(modes).reduce((s, m) => s + m.rounds, 0),
      games: Object.values(modes).reduce((s, m) => s + m.games, 0),
      matches,
      uploads,
      discord,
      signups: signups.reduce((s, b) => s + b.n, 0),
      reports: reports.reduce((s, b) => s + b.n, 0),
      peakPlayers: peakRow?.p ?? 0,
    },
    online: onlineSeries,
    rounds,
    modes,
    signups,
    reports,
  };
}

// --- housekeeping ------------------------------------------------------------------------------

export async function purgeModeration() {
  const now = Date.now();
  run('DELETE FROM metrics WHERE ts < ?', now - METRICS_KEEP_MS);
  run('DELETE FROM activity WHERE bucket < ?', now - 400 * DAY);
  // ended sanctions do not need the network hash any more
  run(
    `UPDATE sanctions SET ip_hash = NULL
      WHERE ip_hash IS NOT NULL
        AND ((lifted_at IS NOT NULL AND lifted_at < ?) OR (expires_at IS NOT NULL AND expires_at < ?))`,
    now - REPORT_KEEP_MS,
    now - REPORT_KEEP_MS,
  );
  const old = all("SELECT context FROM reports WHERE status != 'open' AND created_at < ?", now - REPORT_KEEP_MS);
  transaction(() => {
    run("DELETE FROM reports WHERE status != 'open' AND created_at < ?", now - REPORT_KEEP_MS);
  });
  // evidence files that are no longer referenced
  const used = new Set(
    all("SELECT context FROM reports WHERE context LIKE '%/api/uploads/reports/%'").map((r) => {
      try {
        return JSON.parse(r.context).media.src.split('/').pop();
      } catch {
        return '';
      }
    }),
  );
  if (!old.length) return;
  try {
    for (const f of await fsp.readdir(path.join(UPLOAD_DIR, 'reports'))) {
      if (!used.has(f)) await fsp.rm(path.join(UPLOAD_DIR, 'reports', f), { force: true });
    }
  } catch {
    /* folder missing */
  }
}
