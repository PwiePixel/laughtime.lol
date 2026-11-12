/**
 * GeoTime.lol – Spielregeln (HOT-MODUL)
 *
 * Hier stehen Punkte, Bingo-Begriffe und das Ampel-System. Alles davon lässt
 * sich über updates/<kanal>/game/rules.js ohne Neustart austauschen.
 *
 * Fünf Spielarten:
 *   classic    – wie GeoGuessr: hingucken, auf der Karte tippen, Punkte nach
 *                Entfernung. Allein oder zusammen im Raum.
 *   bingo      – Team-Bingo: Begriffe im Straßenbild finden und abhaken.
 *   hunt       – GeoHunt: ein Zielfoto, und ihr lauft durch die Straßenansicht
 *                dorthin. Wer zuerst da ist, bekommt die meisten Punkte.
 *   deathmatch – wie classic, aber nach jeder Runde fliegt der schlechteste
 *                Tipp raus. Übrig bleibt einer.
 *   star       – Geo Star: feste Zeit, so viele Orte wie möglich. Wer am Ende
 *                die meisten Punkte hat, ist der Geo Star.
 *
 * Ampel im Bingo (die Prüfung läuft auf dem Gerät, nicht auf dem Server):
 *   >= 0.80   sicher    -> zählt sofort
 *   0.30–0.79 unsicher  -> Tribunal: das andere Team stimmt am Rundenende ab
 *   < 0.30    zu wenig  -> der Client lässt den Snap gar nicht erst zu
 */
export const THRESHOLDS = { sure: 0.8, tribunal: 0.3 };

export const GAMES = ['classic', 'bingo', 'hunt', 'deathmatch', 'star'];
export const MODES = ['1v1', '2v2', '5v5'];

export const cleanGame = (game) => (GAMES.includes(game) ? game : 'classic');
export const cleanMode = (mode) => (MODES.includes(mode) ? mode : '1v1');

// --- klassischer Modus -------------------------------------------------------

/** halber Erdumfang-ish: so groß ist die Weltkarte für die Punkteformel */
const WORLD_KM = 14916;
export const MAX_POINTS = 5000;

/** Entfernung zweier Punkte in Kilometern (Haversine) */
export function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Punkte für einen Tipp: ganz nah = 5000, weit weg = fast 0.
 * Gleiche Kurve wie bei GeoGuessr, damit sich das vertraut anfühlt.
 */
export function pointsFor(distanceInKm) {
  if (!Number.isFinite(distanceInKm)) return 0;
  if (distanceInKm < 0.15) return MAX_POINTS; // Volltreffer
  return Math.round(MAX_POINTS * Math.exp((-10 * distanceInKm) / WORLD_KM));
}

/** Entfernung hübsch schreiben: 340 m / 12,4 km / 1.240 km */
export function formatDistance(km) {
  if (!Number.isFinite(km)) return '–';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km).toLocaleString('de-DE')} km`;
}

/** Einen Tipp auswerten (der Server kennt die echte Position, der Client nicht) */
export function judgeGuess(truth, guess) {
  if (!guess || !Number.isFinite(guess.lat) || !Number.isFinite(guess.lng)) {
    return { lat: null, lng: null, km: null, points: 0, skipped: true };
  }
  const km = distanceKm(truth, guess);
  return { lat: guess.lat, lng: guess.lng, km, points: pointsFor(km), skipped: false };
}

// --- GeoHunt ------------------------------------------------------------------

/** so nah muss man dran sein, damit das Ziel als gefunden gilt (Meter) */
export const HUNT_RADIUS_M = 150;

/** wie weit weg der Startpunkt vom Ziel liegt (Kilometer) */
export const HUNT_START_KM = { min: 0.8, max: 2.5 };

/**
 * Wie warm ist es? Der Server verrät nie die Entfernung selbst, nur die Stufe –
 * sonst könnte man das Ziel in zwei Messungen ausrechnen.
 */
export function heatFor(km) {
  if (km <= HUNT_RADIUS_M / 1000) return 'found';
  if (km < 0.3) return 'burning';
  if (km < 0.8) return 'hot';
  if (km < 2) return 'warm';
  if (km < 6) return 'cold';
  return 'freezing';
}

/** Richtung von a nach b in Grad (0 = Norden) – grob, reicht für den Pfeil */
export function bearing(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/**
 * Punkte fürs Ankommen: je schneller, desto mehr. Wer zuerst da ist, bekommt
 * zusätzlich einen Bonus.
 */
export function huntPoints({ secondsLeft, totalSeconds, rank }) {
  const share = Math.max(0, Math.min(1, secondsLeft / Math.max(1, totalSeconds)));
  const base = Math.round(500 + 2500 * share);
  const bonus = rank === 1 ? 1000 : rank === 2 ? 500 : rank === 3 ? 250 : 0;
  return base + bonus;
}

// --- Deathmatch ---------------------------------------------------------------

/**
 * Wer fliegt raus? Der schlechteste Tipp der Runde. Wer gar nicht getippt hat,
 * ist immer zuerst dran.
 * @param {Array} guesses  Ergebnisse dieser Runde (nur aktive Spieler)
 * @returns {string|null} playerId
 */
export function worstGuess(guesses) {
  if (!guesses.length) return null;
  const sorted = [...guesses].sort((a, b) => {
    if (a.skipped !== b.skipped) return a.skipped ? -1 : 1; // kein Tipp zuerst
    return (b.km ?? Infinity) - (a.km ?? Infinity);
  });
  return sorted[0]?.playerId ?? null;
}

// --- Bingo -------------------------------------------------------------------

/** Begriffe für das Bingo-Feld – bewusst hier, damit sie hot austauschbar sind */
export const TERMS = [
  'Ampel', 'Bushaltestelle', 'Briefkasten', 'Kirche', 'Tankstelle', 'Brücke',
  'Baustelle', 'Supermarkt', 'Fahrrad', 'Hydrant', 'Bahnübergang', 'Windrad',
  'Straßenbahn', 'Kreisverkehr', 'Denkmal', 'Solaranlage', 'Schule', 'Fluss',
  'Traktor', 'Parkbank', 'Leuchtturm', 'Fußgängerzone', 'Tunnel', 'Hotel', 'Wasserturm',
];

/** Feldgröße je Teamgröße: kleine Teams, kleines Feld */
export const BOARD_SIZE = { '1v1': 3, '2v2': 4, '5v5': 5 };

export const POINTS = { cell: 100, line: 500 };

/** Bingo-Feld mit zufälligen Begriffen (bei ungerader Größe ist die Mitte frei) */
export function makeBoard(mode = '1v1') {
  const size = BOARD_SIZE[cleanMode(mode)] || 3;
  const pool = [...TERMS].sort(() => Math.random() - 0.5);
  const cells = Array.from({ length: size * size }, (_, i) => ({
    i,
    term: pool[i % pool.length],
    team: null,
    status: 'open', // open | accepted | tribunal | rejected
    snap: null,
  }));
  if (size % 2 === 1) {
    const middle = Math.floor((size * size) / 2);
    cells[middle] = { i: middle, term: 'Freies Feld', team: null, status: 'free', snap: null };
  }
  return { size, mode: cleanMode(mode), cells };
}

/** zählt ein Feld für ein Team? */
const owns = (cell, team) => (cell.status === 'accepted' && cell.team === team) || cell.status === 'free';

/** volle Reihen, Spalten und Diagonalen eines Teams */
export function linesFor(board, team) {
  const n = board.size;
  const at = (x, y) => board.cells[y * n + x];
  let lines = 0;
  for (let y = 0; y < n; y++) if (Array.from({ length: n }, (_, x) => at(x, y)).every((c) => owns(c, team))) lines++;
  for (let x = 0; x < n; x++) if (Array.from({ length: n }, (_, y) => at(x, y)).every((c) => owns(c, team))) lines++;
  if (Array.from({ length: n }, (_, i) => at(i, i)).every((c) => owns(c, team))) lines++;
  if (Array.from({ length: n }, (_, i) => at(n - 1 - i, i)).every((c) => owns(c, team))) lines++;
  return lines;
}

/** Punktestand eines Bingo-Spiels */
export function bingoScores(board, teams = ['a', 'b']) {
  const out = {};
  for (const team of teams) {
    const cells = board.cells.filter((c) => c.status === 'accepted' && c.team === team).length;
    const lines = linesFor(board, team);
    out[team] = { cells, lines, points: cells * POINTS.cell + lines * POINTS.line };
  }
  return out;
}

/**
 * Snap bewerten. Es kommt KEIN Bild an – nur Position, Blickrichtung und die
 * Trefferwahrscheinlichkeit des Modells auf dem Gerät.
 */
export function judgeSnap(room, playerId, msg) {
  const cell = room.board?.cells?.[msg.cell];
  const player = room.players.get(playerId);
  if (!cell || !player) return { ok: false, reason: 'cell_taken' };
  if (cell.status === 'accepted' || cell.status === 'free') return { ok: false, reason: 'cell_taken' };
  const confidence = Number(msg.confidence) || 0;
  const snap = {
    id: `s${cell.i}-${Date.now().toString(36)}`,
    cell: cell.i,
    term: cell.term,
    playerId,
    playerName: player.name,
    team: player.team,
    lat: Number(msg.lat),
    lng: Number(msg.lng),
    heading: Number(msg.heading) || 0,
    pitch: Number(msg.pitch) || 0,
    zoom: Number(msg.zoom) || 0,
    imageId: msg.imageId ? String(msg.imageId).slice(0, 64) : null,
    confidence,
    at: Date.now(),
    votes: { real: [], fake: [] },
  };
  if (!Number.isFinite(snap.lat) || !Number.isFinite(snap.lng)) return { ok: false, reason: 'bad_request' };
  if (confidence < THRESHOLDS.tribunal) return { ok: false, reason: 'too_low', snap };
  cell.snap = snap;
  cell.team = player.team;
  cell.status = confidence >= THRESHOLDS.sure ? 'accepted' : 'tribunal';
  return { ok: true, cell: cell.i, status: cell.status, snap };
}

/** Tribunal auswerten: mehr "echt" als "fake" -> zählt */
export function settleTribunal(board) {
  const decided = [];
  for (const cell of board.cells) {
    if (cell.status !== 'tribunal' || !cell.snap) continue;
    const { real, fake } = cell.snap.votes;
    const ok = real.length >= fake.length && real.length > 0;
    cell.status = ok ? 'accepted' : 'rejected';
    if (!ok) cell.team = null;
    decided.push({ cell: cell.i, term: cell.term, accepted: ok, real: real.length, fake: fake.length });
  }
  return decided;
}
