import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

// ---------------------------------------------------------------------------
// Persistent storage (accounts, sessions, game results, meme gallery).
// Uses the SQLite engine that is built into Node.js (node:sqlite) – no native
// npm package, nothing to compile on Pterodactyl. File: data/laughtime.db
// ---------------------------------------------------------------------------

let db = null;
const stmtCache = new Map();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT,
  discord_id    TEXT UNIQUE,
  discord_name  TEXT,
  avatar        TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS game_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points      INTEGER NOT NULL,
  won         INTEGER NOT NULL,
  rounds      INTEGER NOT NULL,
  round_wins  INTEGER NOT NULL,
  memes       INTEGER NOT NULL,
  votes       INTEGER NOT NULL,
  players     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS results_user ON game_results(user_id);
CREATE INDEX IF NOT EXISTS results_time ON game_results(created_at);

CREATE TABLE IF NOT EXISTS memes (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media       TEXT NOT NULL,
  captions    TEXT NOT NULL,
  points      INTEGER NOT NULL,
  avg         REAL NOT NULL,
  votes       INTEGER NOT NULL,
  players     INTEGER NOT NULL,
  likes       INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memes_time ON memes(created_at);
CREATE INDEX IF NOT EXISTS memes_user ON memes(user_id);

CREATE TABLE IF NOT EXISTS meme_likes (
  meme_id     TEXT NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (meme_id, user_id)
);
CREATE INDEX IF NOT EXISTS likes_user ON meme_likes(user_id);

CREATE TABLE IF NOT EXISTS packs (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  public      INTEGER NOT NULL DEFAULT 1,
  plays       INTEGER NOT NULL DEFAULT 0,
  item_count  INTEGER NOT NULL DEFAULT 0,
  cover       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS packs_user ON packs(user_id);
CREATE INDEX IF NOT EXISTS packs_public ON packs(public, item_count, plays);

CREATE TABLE IF NOT EXISTS pack_items (
  pack_id     TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  media_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  media       TEXT NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (pack_id, media_id)
);

CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  animated    INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL DEFAULT '',
  approved    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS uploads_user ON uploads(user_id);

CREATE TABLE IF NOT EXISTS sanctions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  pid         TEXT,
  ip_hash     TEXT,
  target_name TEXT NOT NULL DEFAULT '',
  reason      TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_by  INTEGER,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,
  lifted_at   INTEGER,
  lifted_by   INTEGER
);
CREATE INDEX IF NOT EXISTS sanctions_user ON sanctions(user_id);
CREATE INDEX IF NOT EXISTS sanctions_pid ON sanctions(pid);
CREATE INDEX IF NOT EXISTS sanctions_ip ON sanctions(ip_hash);

CREATE TABLE IF NOT EXISTS reports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  target_key       TEXT NOT NULL,
  target_user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  target_pid       TEXT,
  target_ip_hash   TEXT,
  target_name      TEXT NOT NULL DEFAULT '',
  target_avatar    TEXT NOT NULL DEFAULT '',
  reporter_user_id INTEGER,
  reporter_pid     TEXT,
  reporter_ip_hash TEXT,
  reporter_name    TEXT NOT NULL DEFAULT '',
  reason           TEXT NOT NULL,
  comment          TEXT NOT NULL DEFAULT '',
  room_code        TEXT,
  context          TEXT,
  status           TEXT NOT NULL DEFAULT 'open',
  resolution       TEXT,
  handled_by       INTEGER,
  handled_at       INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS reports_target ON reports(target_key);

CREATE TABLE IF NOT EXISTS admin_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER,
  admin_name  TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT '',
  details     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_log_time ON admin_log(created_at);

CREATE TABLE IF NOT EXISTS metrics (
  ts       INTEGER PRIMARY KEY,
  players  INTEGER NOT NULL,
  rooms    INTEGER NOT NULL,
  playing  INTEGER NOT NULL,
  queue    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  bucket  INTEGER NOT NULL,
  key     TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key)
);
`;

// columns added in later versions (existing databases are upgraded on start)
const MIGRATIONS = [
  ['users', 'show_memes', 'INTEGER NOT NULL DEFAULT 0'],
  ['packs', 'review', "TEXT NOT NULL DEFAULT 'none'"],
  ['packs', 'review_note', "TEXT NOT NULL DEFAULT ''"],
  ['packs', 'upload_count', 'INTEGER NOT NULL DEFAULT 0'],
];

function migrate(d) {
  for (const [table, column, ddl] of MIGRATIONS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export async function openDatabase(file = path.join(ROOT, 'data', 'laughtime.db')) {
  if (db) return db;
  // node:sqlite prints an "experimental" warning on some Node versions – hide just that one
  const emit = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    if (String(warning?.message || warning).includes('SQLite')) return;
    emit.call(process, warning, ...rest);
  };
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new Error(
      'This Node.js version has no built-in SQLite (node:sqlite). Please use Node.js 22.13 or newer (Pterodactyl: Docker image "Node 22" or "Node 24").',
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function getDb() {
  if (!db) throw new Error('database not opened');
  return db;
}

function q(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

export const run = (sql, ...params) => q(sql).run(...params);
export const get = (sql, ...params) => q(sql).get(...params);
export const all = (sql, ...params) => q(sql).all(...params);

export function transaction(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
