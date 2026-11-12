/**
 * GeoTime.lol – Ergebnisse und Bestenliste
 *
 * Nur angemeldete Spieler landen in der Liste. Wer ohne Konto spielt, spielt
 * ganz normal mit – es wird nur nichts gespeichert.
 */
import { getDb } from './db.js';

/** Ergebnis einer beendeten Partie merken */
export function recordResult(instanceId, { playerId, game, mode, points, rounds, bestKm }) {
  if (!playerId) return;
  try {
    getDb(instanceId)
      .prepare('INSERT INTO results (player_id, game, mode, points, rounds, best_km, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(playerId, game, mode || null, Math.round(points) || 0, rounds || 0, Number.isFinite(bestKm) ? bestKm : null, Date.now());
  } catch {
    /* die Bestenliste darf ein Spiel nie aufhalten */
  }
}

const RANGES = { '7d': 7, '30d': 30, all: 0 };

/**
 * Bestenliste.
 * @param {string} instanceId
 * @param {object} opts { game: 'classic'|'bingo'|'all', range: '7d'|'30d'|'all', limit }
 */
export function leaderboard(instanceId, { game = 'classic', range = 'all', limit = 50 } = {}) {
  const db = getDb(instanceId);
  const days = RANGES[range] ?? 0;
  const since = days ? Date.now() - days * 86400_000 : 0;
  const filters = ['r.created_at >= ?'];
  const args = [since];
  if (game === 'classic' || game === 'bingo') {
    filters.push('r.game = ?');
    args.push(game);
  }
  const rows = db
    .prepare(
      `SELECT p.username, p.name, p.avatar,
              SUM(r.points) AS points,
              COUNT(*)      AS games,
              MAX(r.points) AS best,
              MIN(r.best_km) AS best_km
         FROM results r JOIN players p ON p.id = r.player_id
        WHERE ${filters.join(' AND ')}
     GROUP BY p.id
     ORDER BY points DESC
        LIMIT ?`,
    )
    .all(...args, Math.min(200, Math.max(1, limit)));
  return rows.map((r, i) => ({
    rank: i + 1,
    username: r.username,
    name: r.name,
    avatar: r.avatar,
    points: r.points || 0,
    games: r.games || 0,
    best: r.best || 0,
    bestKm: r.best_km,
  }));
}

/** eigene Zahlen für das Profil im Kopf */
export function statsFor(instanceId, playerId) {
  const db = getDb(instanceId);
  const row = db
    .prepare('SELECT COUNT(*) AS games, COALESCE(SUM(points),0) AS points, COALESCE(MAX(points),0) AS best FROM results WHERE player_id = ?')
    .get(playerId);
  return { games: row?.games || 0, points: row?.points || 0, best: row?.best || 0 };
}
