/**
 * GeoTime.lol – eigene Datenbank
 *
 * Liegt im selben data/-Ordner wie LaughTime, ist aber eine eigene Datei:
 *   data/geotime.db          Produktion
 *   data/geotime-beta-1.db   Beta-Instanz
 *
 * Die LaughTime-Datenbank (data/laughtime.db) wird nie geöffnet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Konten von GeoTime: eigener Login, eigene Tabelle, eigene Datei.
-- Mit LaughTime-Konten hat das nichts zu tun.
CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT UNIQUE,
  username    TEXT UNIQUE,
  pass_hash   TEXT,
  pass_salt   TEXT,
  name        TEXT NOT NULL,
  avatar      TEXT,
  lang        TEXT NOT NULL DEFAULT 'en',
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

-- Anmeldungen (Cookie gt_session)
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions(player_id);

-- Ergebnis einer beendeten Partie je Spieler – Grundlage der Bestenliste
CREATE TABLE IF NOT EXISTS results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game        TEXT NOT NULL,          -- classic | bingo
  mode        TEXT,
  points      INTEGER NOT NULL,
  rounds      INTEGER NOT NULL,
  best_km     REAL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS results_player ON results(player_id);
CREATE INDEX IF NOT EXISTS results_time ON results(created_at);

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE NOT NULL,
  mode        TEXT NOT NULL DEFAULT '1v1',
  instance_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  ended_at    INTEGER
);

-- Ein Fund: KEIN Bild, nur Position + Blickrichtung (Street View als Beweis)
CREATE TABLE IF NOT EXISTS snaps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id   INTEGER REFERENCES players(id) ON DELETE SET NULL,
  team        TEXT NOT NULL,
  cell        INTEGER NOT NULL,
  term        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  heading     REAL NOT NULL,
  pitch       REAL NOT NULL,
  zoom        REAL,
  pano_id     TEXT,
  confidence  REAL NOT NULL,
  status      TEXT NOT NULL,        -- accepted | tribunal | rejected
  votes_real  INTEGER NOT NULL DEFAULT 0,
  votes_fake  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS snaps_game ON snaps(game_id);
`;

/** eine Datenbank je Instanz */
const open = new Map();

/** Spalten, die später dazugekommen sind (ältere Dateien nachziehen) */
const EXTRA_COLUMNS = [
  ['players', 'username', 'TEXT'],
  ['players', 'pass_hash', 'TEXT'],
  ['players', 'pass_salt', 'TEXT'],
  ['players', 'lang', "TEXT NOT NULL DEFAULT 'en'"],
];

export function openDatabase(instanceId, file) {
  if (open.has(instanceId)) return open.get(instanceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  for (const [table, column, type] of EXTRA_COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS players_username ON players(username) WHERE username IS NOT NULL');
  open.set(instanceId, db);
  return db;
}

export function getDb(instanceId) {
  const db = open.get(instanceId);
  if (!db) throw new Error(`GeoTime: Datenbank von ${instanceId} ist nicht offen.`);
  return db;
}

export function closeDatabase(instanceId) {
  open.get(instanceId)?.close();
  open.delete(instanceId);
}

export const closeAll = () => {
  for (const id of [...open.keys()]) closeDatabase(id);
};
