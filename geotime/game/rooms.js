/**
 * GeoTime.lol – Räume, Runden, Punkte (HOT-MODUL)
 *
 * Diese Datei darf jederzeit über updates/<kanal>/game/rooms.js ersetzt werden.
 * Der WebSocket-Hub bleibt bestehen, nur diese Funktionen werden ausgetauscht.
 * Damit das im laufenden Spiel klappt:
 *   - der Zustand liegt in `state` und wird in onLoad vom Vorgänger übernommen
 *   - laufende Uhren werden in onUnload gestoppt und in onLoad neu gestellt
 *     (sie hängen an `endsAt`, laufen also genau da weiter, wo sie waren)
 *
 * Fünf Spiele, ein Raum-Gerüst:
 *   classic    – hingucken, auf der Karte tippen, Punkte nach Entfernung
 *   bingo      – Begriffe im Bild finden, Ampel, am Rundenende das Tribunal
 *   hunt       – GeoHunt: Zielfoto ansehen, hinlaufen, "Hier!" drücken
 *   deathmatch – wie classic, der schlechteste Tipp fliegt jede Runde raus
 *   star       – Geo Star: feste Zeit, ein Ort nach dem anderen, meiste Punkte
 *
 * Die echten Koordinaten einer Runde bleiben auf dem Server (`round.truth`)
 * und gehen erst bei der Auswertung raus.
 */
import { nearbyLocation, nextLocation } from './locations.js';
import { recordResult } from '../stats.js';

/** überlebt Hot-Updates (pro Instanz eigener Zustand) */
export let state = { rooms: new Map(), timers: new Map() };

let ctxRef = null;

export async function onLoad(ctx) {
  ctxRef = ctx || null;
  if (ctx?.previous?.state) state = ctx.previous.state;
  if (!state.timers) state.timers = new Map();
  // Uhren nach einem Update neu stellen – die Spieler merken nichts davon
  for (const room of state.rooms.values()) if (room.endsAt) arm(room);
}

export async function onUnload() {
  for (const timer of state.timers.values()) clearTimeout(timer);
  state.timers.clear();
}

// --- kleine Helfer ----------------------------------------------------------

/** So lange bleibt ein leerer Raum stehen, damit man zurückkommen kann */
const GRACE_MS = 90_000;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const send = (ws, msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cfgOf = (room) => room.cfg || ctxRef?.cfg || {};

/** Standard-Rundenzahl je Spielart */
function defaultRounds(game, cfg) {
  const g = cfg.game || {};
  if (game === 'bingo') return 1; // eine lange Runde plus Tribunal
  if (game === 'star') return 1; // eine Uhr fürs ganze Spiel
  return g.classicRounds || 5;
}

/** Standardzeit je Spielart (Sekunden) */
function defaultSeconds(game, cfg) {
  const g = cfg.game || {};
  if (game === 'bingo') return g.bingoSeconds || 600;
  if (game === 'hunt') return g.huntSeconds || 240;
  if (game === 'star') return g.starSeconds || 300;
  return g.classicSeconds || 120;
}

function broadcast(room, msg) {
  const text = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.ws?.readyState === 1) p.ws.send(text);
}

/** was jeder sehen darf – niemals die echte Position der laufenden Runde */
function publicRoom(room) {
  return {
    code: room.solo ? null : room.code,
    game: room.game,
    mode: room.mode,
    phase: room.phase,
    solo: room.solo,
    hostId: room.hostId,
    round: room.roundNo,
    rounds: room.rounds,
    endsAt: room.endsAt || null,
    board: room.board ? publicBoard(room.board) : null,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      team: p.team,
      points: p.points,
      ready: Boolean(p.guess) || p.done === true || Boolean(p.found),
      out: Boolean(p.out),
      found: Boolean(p.found),
      online: p.ws?.readyState === 1,
    })),
  };
}

/** Bingo-Feld ohne die Snap-Koordinaten (die kommen erst im Tribunal) */
function publicBoard(board) {
  return {
    size: board.size,
    mode: board.mode,
    cells: board.cells.map((c) => ({ i: c.i, term: c.term, team: c.team, status: c.status })),
  };
}

// --- Uhren ------------------------------------------------------------------

function arm(room) {
  clearTimeout(state.timers.get(room.code));
  if (!room.endsAt) return;
  const wait = Math.max(0, room.endsAt - Date.now());
  const timer = setTimeout(() => {
    state.timers.delete(room.code);
    timeUp(room).catch((err) => broadcast(room, { t: 'error', code: 'server_error', detail: err.message }));
  }, wait);
  timer.unref?.();
  state.timers.set(room.code, timer);
}

function stopClock(room) {
  clearTimeout(state.timers.get(room.code));
  state.timers.delete(room.code);
  room.endsAt = null;
}

async function timeUp(room) {
  if (room.phase === 'playing') {
    if (room.game === 'bingo') return startTribunal(room);
    if (room.game === 'star') return endStar(room);
    return endRound(room);
  }
  if (room.phase === 'tribunal') return endRound(room);
  return undefined;
}

/** Geo Star: Zeit um – wer die meisten Punkte hat, ist der Geo Star */
async function endStar(room) {
  stopClock(room);
  room.phase = 'final';
  const scores = [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, team: p.team, points: p.points, spots: Math.max(0, (p.spotNo || 1) - 1) }))
    .sort((a, b) => b.points - a.points);
  saveResults(room);
  broadcast(room, { t: 'final', scores, star: scores[0] || null, rounds: [] });
  broadcast(room, { t: 'room', room: publicRoom(room) });
}

// --- Raum anlegen und betreten ----------------------------------------------

function makeRoom({ game, mode, rounds, seconds, solo, cfg }) {
  return {
    code: newCode(),
    game, // schon über rules.cleanGame geprüft
    mode,
    solo: Boolean(solo),
    phase: 'lobby',
    players: new Map(),
    hostId: null,
    roundNo: 0,
    rounds,
    seconds,
    round: null, // { truth, image, guesses }
    board: null,
    endsAt: null,
    history: [],
    createdAt: Date.now(),
    cfg,
  };
}

function join(ws, room, player = {}) {
  const id = `p${Math.random().toString(36).slice(2, 9)}`;
  const teamCount = { a: 0, b: 0 };
  for (const p of room.players.values()) teamCount[p.team] = (teamCount[p.team] || 0) + 1;
  const entry = {
    id,
    // Kennwort für die Rückkehr nach einem Verbindungsabriss
    token: `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    // angemeldet? dann zählt das Ergebnis am Ende für die Bestenliste
    accountId: ws.account?.id || null,
    name: clean(player.name, 24) || ws.account?.name || 'Spieler',
    avatar: typeof player.avatar === 'string' ? player.avatar.slice(0, 300) : null,
    team: teamCount.a <= teamCount.b ? 'a' : 'b',
    points: 0,
    guess: null,
    done: false,
    out: false,        // Deathmatch: rausgeflogen
    found: null,       // GeoHunt: angekommen
    spot: null,        // Geo Star: eigener Ort
    spotNo: 0,
    seen: [],
    ws,
  };
  room.players.set(id, entry);
  ws.room = room.code;
  ws.playerId = id;
  if (!room.hostId) room.hostId = id;
  return entry;
}

// --- Runden -----------------------------------------------------------------

async function startRound(room) {
  const cfg = cfgOf(room);
  let location;
  try {
    location = await nextLocation(cfg, { exclude: room.history.map((h) => h.image?.id).filter(Boolean) });
  } catch (err) {
    broadcast(room, { t: 'error', code: 'no_location', detail: err.message });
    room.phase = 'lobby';
    broadcast(room, { t: 'room', room: publicRoom(room) });
    return;
  }
  const rules = await ctxRef.hot.load('game/rules.js');
  room.roundNo += 1;
  room.phase = 'playing';
  room.round = {
    truth: { lat: location.lat, lng: location.lng },
    area: location.area,
    land: location.land,
    // `source` sagt dem Browser, welcher Viewer gebraucht wird – bei einem
    // Ausfall kann eine Mapillary-Runde auch mal ein Panoramax-Bild sein
    image: { id: location.id, pano: location.pano, demo: Boolean(location.demo), source: location.source || null },
    guesses: new Map(),
    found: [],
  };
  for (const p of room.players.values()) {
    p.guess = null;
    p.done = false;
    p.found = null;
    p.at = null;
  }

  if (room.game === 'bingo') room.board = rules.makeBoard(room.mode);

  // GeoHunt: das Ziel bleibt geheim, gestartet wird ein Stück daneben
  if (room.game === 'hunt') {
    const start = await nearbyLocation(cfg, room.round.truth, rules.HUNT_START_KM);
    if (!start) {
      broadcast(room, { t: 'error', code: 'no_location', detail: 'Kein Startpunkt in der Nähe gefunden.' });
      room.phase = 'lobby';
      broadcast(room, { t: 'room', room: publicRoom(room) });
      return;
    }
    room.round.start = { id: start.id, pano: start.pano, demo: Boolean(start.demo), source: start.source || null };
  }

  room.endsAt = Date.now() + room.seconds * 1000;
  arm(room);
  broadcast(room, {
    t: 'round',
    round: {
      n: room.roundNo,
      total: room.rounds,
      endsAt: room.endsAt,
      // nur Bild-IDs, nie Koordinaten
      image: room.game === 'hunt' ? room.round.start : room.round.image,
      target: room.game === 'hunt' ? room.round.image : null,
      board: room.board ? publicBoard(room.board) : null,
    },
  });
  broadcast(room, { t: 'room', room: publicRoom(room) });
}

/**
 * Geo Star: jeder Spieler bekommt seinen eigenen Ort, sofort nach dem Tipp den
 * nächsten. Gespielt wird gegen die Uhr, nicht gegen Runden.
 */
async function nextSpot(room, player) {
  const cfg = cfgOf(room);
  let location;
  try {
    location = await nextLocation(cfg, { exclude: player.seen || [] });
  } catch (err) {
    send(player.ws, { t: 'error', code: 'no_location', detail: err.message });
    return;
  }
  player.seen = [...(player.seen || []), location.id].slice(-30);
  player.spot = {
    truth: { lat: location.lat, lng: location.lng },
    area: location.area,
    land: location.land,
    // das Bild merken, damit es nach einer Rückkehr wieder geschickt werden kann
    image: { id: location.id, pano: location.pano, demo: Boolean(location.demo), source: location.source || null },
  };
  player.guess = null;
  player.spotNo = (player.spotNo || 0) + 1;
  send(player.ws, {
    t: 'spot',
    spot: { n: player.spotNo, endsAt: room.endsAt, image: player.spot.image },
  });
}

async function startTribunal(room) {
  const open = room.board?.cells.filter((c) => c.status === 'tribunal') || [];
  if (!open.length) return endRound(room);
  room.phase = 'tribunal';
  const cfg = cfgOf(room);
  room.endsAt = Date.now() + (cfg.game?.tribunalSeconds || 45) * 1000;
  arm(room);
  broadcast(room, {
    t: 'tribunal',
    endsAt: room.endsAt,
    // im Tribunal sind die Koordinaten der Fund­stelle erlaubt – darum geht es ja
    items: open.map((c) => ({
      id: c.snap.id,
      cell: c.i,
      term: c.term,
      team: c.team,
      by: c.snap.playerName,
      lat: c.snap.lat,
      lng: c.snap.lng,
      heading: c.snap.heading,
      pitch: c.snap.pitch,
      zoom: c.snap.zoom,
      imageId: c.snap.imageId,
      confidence: c.snap.confidence,
    })),
  });
  broadcast(room, { t: 'room', room: publicRoom(room) });
}

async function endRound(room) {
  stopClock(room);
  const rules = await ctxRef.hot.load('game/rules.js');
  room.phase = 'result';
  let result;

  if (room.game === 'bingo') {
    const decided = rules.settleTribunal(room.board);
    const scores = rules.bingoScores(room.board);
    for (const p of room.players.values()) p.points = scores[p.team]?.points || 0;
    result = {
      game: 'bingo',
      n: room.roundNo,
      total: room.rounds,
      truth: room.round.truth,
      area: room.round.area,
      decided,
      board: publicBoard(room.board),
      scores,
    };
  } else if (room.game === 'hunt') {
    // wer angekommen ist, hat seine Punkte schon – hier nur noch die Übersicht
    const rows = [...room.players.values()].map((p) => ({
      playerId: p.id,
      name: p.name,
      found: Boolean(p.found),
      seconds: p.found?.seconds ?? null,
      km: p.found ? 0 : p.at ? rules.distanceKm(room.round.truth, p.at) : null,
      points: p.found?.points || 0,
      total: p.points,
    }));
    rows.sort((a, b) => b.points - a.points);
    result = {
      game: 'hunt',
      n: room.roundNo,
      total: room.rounds,
      truth: room.round.truth,
      area: room.round.area,
      land: room.round.land,
      guesses: rows.map((r) => ({ ...r, lat: null, lng: null, skipped: !r.found })),
      rows,
    };
  } else {
    const guesses = [...room.players.values()].map((p) => {
      const judged = rules.judgeGuess(room.round.truth, p.guess);
      p.points += judged.points;
      if (Number.isFinite(judged.km)) p.bestKm = Math.min(p.bestKm ?? Infinity, judged.km);
      return { playerId: p.id, name: p.name, team: p.team, ...judged, total: p.points };
    });
    guesses.sort((a, b) => b.points - a.points);
    result = {
      game: room.game,
      n: room.roundNo,
      total: room.rounds,
      truth: room.round.truth,
      area: room.round.area,
      land: room.round.land,
      guesses,
    };

    // Deathmatch: der schlechteste Tipp dieser Runde ist raus
    if (room.game === 'deathmatch') {
      const alive = [...room.players.values()].filter((p) => !p.out);
      if (alive.length > 1) {
        const inRound = guesses.filter((g) => alive.some((p) => p.id === g.playerId));
        const loserId = rules.worstGuess(inRound);
        const loser = loserId && room.players.get(loserId);
        if (loser) {
          loser.out = true;
          result.eliminated = { playerId: loser.id, name: loser.name };
        }
      }
      result.alive = [...room.players.values()].filter((p) => !p.out).map((p) => p.id);
    }
  }

  room.history.push({ n: room.roundNo, image: room.round.image, truth: room.round.truth, area: room.round.area });
  broadcast(room, { t: 'result', result });
  broadcast(room, { t: 'room', room: publicRoom(room) });

  const alive = [...room.players.values()].filter((p) => !p.out);
  const over =
    room.game === 'deathmatch' ? alive.length <= 1 || room.roundNo >= room.rounds : room.roundNo >= room.rounds;
  if (over) {
    room.phase = 'final';
    const scores = [...room.players.values()]
      .map((p) => ({ id: p.id, name: p.name, team: p.team, points: p.points }))
      .sort((a, b) => b.points - a.points);
    saveResults(room);
    broadcast(room, { t: 'final', scores, rounds: room.history });
    broadcast(room, { t: 'room', room: publicRoom(room) });
  }
}

/** Geo Star: eine Uhr für alle, jeder bekommt eigene Orte */
async function startStar(room) {
  room.phase = 'playing';
  room.roundNo = 1;
  room.endsAt = Date.now() + room.seconds * 1000;
  arm(room);
  for (const p of room.players.values()) {
    p.points = 0;
    p.spotNo = 0;
    p.seen = [];
  }
  broadcast(room, { t: 'room', room: publicRoom(room) });
  for (const p of room.players.values()) {
    if (p.ws?.readyState === 1) await nextSpot(room, p);
  }
}

/** Ergebnisse merken – nur für angemeldete Spieler */
function saveResults(room) {
  const instanceId = cfgOf(room).instanceId;
  for (const p of room.players.values()) {
    if (!p.accountId) continue;
    recordResult(instanceId, {
      playerId: p.accountId,
      game: room.game,
      mode: room.mode,
      points: p.points,
      rounds: room.game === 'star' ? Math.max(0, (p.spotNo || 1) - 1) : room.rounds,
      bestKm: p.bestKm,
    });
  }
}


/**
 * Alles schicken, was gerade läuft – nach dem Beitreten mitten in der Runde
 * und nach einer Rückkehr.
 */
function sendCurrent(ws, room, player) {
  if (room.phase === 'playing' && room.round) {
    if (room.game === 'star') {
      if (player.spot) {
        send(ws, {
          t: 'spot',
          spot: { n: player.spotNo, image: player.spot.image, endsAt: room.endsAt },
        });
      }
    } else {
      send(ws, {
        t: 'round',
        round: {
          n: room.roundNo,
          total: room.rounds,
          endsAt: room.endsAt,
          image: room.game === 'hunt' ? room.round.start : room.round.image,
          target: room.game === 'hunt' ? room.round.image : null,
          board: room.board ? publicBoard(room.board) : null,
        },
      });
    }
  }
  if (room.phase === 'tribunal' && room.board) {
    send(ws, { t: 'board', board: publicBoard(room.board) });
  }
}

/**
 * Wo steht der Spieler gerade?
 *
 * Bei Mapillary weiß der Viewer im Browser die Koordinaten und schickt sie mit.
 * Bei Panoramax bekommt der Browser sie absichtlich nie – dann kommt nur die
 * Bild-ID, und der Server schlägt die Position selbst nach.
 */
async function whereIs(cfg, msg) {
  const lat = Number(msg.lat);
  const lng = Number(msg.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  // Panoramax-Bilder kennt der Server; eine Mapillary-ID steht dort nicht drin
  // und kommt hier gar nicht erst an (dort schickt der Viewer Koordinaten).
  const id = typeof msg.imageId === 'string' ? msg.imageId : null;
  if (!id) return null;
  try {
    const pano = await import('../pano.js');
    return await pano.coordsOf(cfg, id);
  } catch {
    return null;
  }
}

/** alle fertig? dann nicht auf die Uhr warten */
function maybeFinishEarly(room) {
  const active = [...room.players.values()].filter((p) => p.ws?.readyState === 1);
  if (!active.length) return false;
  if (room.phase === 'playing' && (room.game === 'classic' || room.game === 'deathmatch')) {
    const inGame = active.filter((p) => !p.out);
    if (inGame.length && inGame.every((p) => p.guess)) return (endRound(room), true);
  }
  if (room.phase === 'playing' && room.game === 'hunt') {
    if (active.every((p) => p.found || p.done)) return (endRound(room), true);
  }
  if (room.phase === 'playing' && room.game === 'bingo') {
    if (active.every((p) => p.done)) return (startTribunal(room), true);
  }
  if (room.phase === 'tribunal') {
    const open = room.board.cells.filter((c) => c.status === 'tribunal');
    const voters = active.filter((p) => open.some((c) => c.team !== p.team));
    if (voters.length && voters.every((p) => p.done)) return (endRound(room), true);
  }
  return false;
}

// --- Nachrichten ------------------------------------------------------------

export function onConnect(ws) {
  send(ws, { t: 'hello', server: 'geotime', version: 2 });
}

export function onClose(ws) {
  const room = ws.room && state.rooms.get(ws.room);
  if (!room) return;
  const player = room.players.get(ws.playerId);
  if (player) player.ws = null;
  const anyone = [...room.players.values()].some((p) => p.ws?.readyState === 1);
  if (!anyone) {
    // Nicht sofort wegwerfen: ein kurzer Verbindungsabriss (Tunnel, WLAN-
    // Wechsel, Neuladen) soll die Runde nicht beenden. Erst wenn nach einer
    // Schonfrist niemand zurück ist, ist der Raum wirklich zu Ende.
    stopClock(room);
    room.emptyAt = Date.now();
    clearTimeout(room.reaper);
    room.reaper = setTimeout(() => {
      const back = [...room.players.values()].some((p) => p.ws?.readyState === 1);
      if (!back) state.rooms.delete(room.code);
    }, GRACE_MS);
    room.reaper.unref?.();
    return;
  }
  if (player && room.hostId === player.id) {
    const next = [...room.players.values()].find((p) => p.ws?.readyState === 1);
    if (next) room.hostId = next.id;
  }
  broadcast(room, { t: 'room', room: publicRoom(room) });
}

export async function handleMessage(ws, msg, { hot, cfg }) {
  ctxRef = { hot, cfg };
  const rules = await hot.load('game/rules.js');
  const room = ws.room ? state.rooms.get(ws.room) : null;
  const me = room?.players.get(ws.playerId);

  switch (msg.t) {
    case 'create':
    case 'solo': {
      if (room) return send(ws, { t: 'error', code: 'already_in_room' });
      const solo = msg.t === 'solo';
      const game = rules.cleanGame(msg.game);
      const limit = cfg.game?.maxRooms || 200;
      if (state.rooms.size >= limit) return send(ws, { t: 'error', code: 'server_full' });
      const fresh = makeRoom({
        game,
        mode: rules.cleanMode(msg.mode),
        rounds: Math.min(10, Math.max(1, Number(msg.rounds) || cfg.game?.classicRounds || 5)),
        seconds: Math.min(1800, Math.max(30, Number(msg.seconds) || defaultSeconds(game, cfg))),
        solo,
        cfg,
      });
      state.rooms.set(fresh.code, fresh);
      const you = join(ws, fresh, msg.player);
      send(ws, {
        t: 'joined',
        you: { id: you.id, name: you.name, team: you.team, token: you.token },
        // nur für die Rückkehr nach einem Abriss – steht nicht im Raum selbst,
        // damit ein Solo-Raum nach außen weiter ohne Code auskommt
        seat: { code: fresh.code, id: you.id, token: you.token },
        room: publicRoom(fresh),
      });
      // allein? dann sofort los – Geo Star hat einen eigenen Start (eine Uhr,
      // eigene Orte je Spieler), alle anderen eine normale Runde
      if (solo) await (game === 'star' ? startStar(fresh) : startRound(fresh));
      return undefined;
    }

    case 'sync': {
      // „Ich stehe hier ohne Bild" – Stand noch einmal schicken. Kann
      // passieren, wenn eine Nachricht unterwegs verloren geht.
      if (!room || !me) return send(ws, { t: 'error', code: 'room_not_found' });
      send(ws, { t: 'room', room: publicRoom(room) });
      sendCurrent(ws, room, me);
      return undefined;
    }

    case 'rejoin': {
      // Nach einem Verbindungsabriss wieder in den eigenen Raum, mit allem,
      // was gerade läuft. Ohne das steht man nach einem Wackler vor einer
      // Runde ohne Bild.
      if (room) return send(ws, { t: 'error', code: 'already_in_room' });
      const target = state.rooms.get(clean(msg.code, 8).toUpperCase());
      const back = target?.players.get(String(msg.id || ''));
      if (!target || !back || back.token !== msg.token) return send(ws, { t: 'error', code: 'rejoin_failed' });
      clearTimeout(target.reaper);
      target.reaper = null;
      target.emptyAt = null;
      back.ws = ws;
      ws.room = target.code;
      ws.playerId = back.id;
      if (![...target.players.values()].some((p) => p.ws?.readyState === 1 && p.id !== back.id)) {
        target.hostId = target.hostId && target.players.has(target.hostId) ? target.hostId : back.id;
      }
      // lief die Uhr? dann wieder anwerfen
      if ((target.phase === 'playing' || target.phase === 'tribunal') && target.endsAt > Date.now()) arm(target);
      send(ws, {
        t: 'joined',
        you: { id: back.id, name: back.name, team: back.team, token: back.token },
        seat: { code: target.code, id: back.id, token: back.token },
        room: publicRoom(target),
      });
      sendCurrent(ws, target, back);
      broadcast(target, { t: 'room', room: publicRoom(target) });
      return undefined;
    }

    case 'join': {
      if (room) return send(ws, { t: 'error', code: 'already_in_room' });
      const target = state.rooms.get(clean(msg.code, 8).toUpperCase());
      if (!target || target.solo) return send(ws, { t: 'error', code: 'room_not_found' });
      if (target.players.size >= 20) return send(ws, { t: 'error', code: 'room_full' });
      const you = join(ws, target, msg.player);
      send(ws, {
        t: 'joined',
        you: { id: you.id, name: you.name, team: you.team, token: you.token },
        seat: { code: target.code, id: you.id, token: you.token },
        room: publicRoom(target),
      });
      // mitten in der Runde dazugekommen? Dann gleich Bild und Feld nachreichen
      if (target.phase === 'playing' && target.round) {
        send(ws, {
          t: 'round',
          round: {
            n: target.roundNo,
            total: target.rounds,
            endsAt: target.endsAt,
            image: target.round.image,
            board: target.board ? publicBoard(target.board) : null,
          },
        });
      }
      broadcast(target, { t: 'room', room: publicRoom(target) });
      return undefined;
    }

    case 'settings': {
      // Der Host stellt in der Lobby ein, was gespielt wird. Rundenzahl und
      // Uhr richten sich danach automatisch neu aus.
      if (!room || !me || room.phase !== 'lobby') return send(ws, { t: 'error', code: 'not_now' });
      if (room.hostId !== me.id) return send(ws, { t: 'error', code: 'not_host' });
      const cfg = cfgOf(room);
      if (typeof msg.game === 'string') {
        const next = rules.cleanGame(msg.game);
        if (next !== room.game) {
          room.game = next;
          room.rounds = defaultRounds(next, cfg);
          room.seconds = defaultSeconds(next, cfg);
          room.board = null;
        }
      }
      if (typeof msg.mode === 'string' && cfg.game.teamSizes.includes(msg.mode)) room.mode = msg.mode;
      if (Number.isFinite(Number(msg.rounds))) {
        room.rounds = Math.min(20, Math.max(1, Math.round(Number(msg.rounds))));
      }
      return broadcast(room, { t: 'room', room: publicRoom(room) });
    }

    case 'team': {
      if (!room || !me || room.phase !== 'lobby') return send(ws, { t: 'error', code: 'not_now' });
      me.team = msg.team === 'b' ? 'b' : 'a';
      return broadcast(room, { t: 'room', room: publicRoom(room) });
    }

    case 'start': {
      if (!room || !me) return send(ws, { t: 'error', code: 'room_not_found' });
      if (room.hostId !== me.id) return send(ws, { t: 'error', code: 'not_host' });
      if (room.phase === 'playing' || room.phase === 'tribunal') return send(ws, { t: 'error', code: 'not_now' });
      if (room.phase === 'final' || room.phase === 'result') {
        if (room.roundNo >= room.rounds) {
          room.roundNo = 0;
          room.history = [];
          for (const p of room.players.values()) p.points = 0;
        }
      }
      if (room.game === 'deathmatch') {
        // gespielt wird, bis einer übrig ist
        for (const p of room.players.values()) p.out = false;
        room.rounds = Math.max(1, room.players.size - 1);
      }
      if (room.game === 'star') return startStar(room);
      await startRound(room);
      return undefined;
    }

    case 'guess': {
      if (!room || !me) return send(ws, { t: 'error', code: 'not_now' });

      // Geo Star: jeder Tipp zählt sofort, danach kommt der nächste Ort
      if (room.game === 'star') {
        if (room.phase !== 'playing' || !me.spot) return send(ws, { t: 'error', code: 'not_now' });
        const judged = rules.judgeGuess(me.spot.truth, { lat: Number(msg.lat), lng: Number(msg.lng) });
        me.points += judged.points;
        if (Number.isFinite(judged.km)) me.bestKm = Math.min(me.bestKm ?? Infinity, judged.km);
        send(ws, {
          t: 'spotResult',
          result: { ...judged, truth: me.spot.truth, area: me.spot.area, total: me.points, n: me.spotNo },
        });
        broadcast(room, { t: 'room', room: publicRoom(room) });
        await nextSpot(room, me);
        return undefined;
      }

      if (room.phase !== 'playing' || (room.game !== 'classic' && room.game !== 'deathmatch')) {
        return send(ws, { t: 'error', code: 'not_now' });
      }
      if (me.out) return send(ws, { t: 'error', code: 'eliminated' });
      const lat = Number(msg.lat);
      const lng = Number(msg.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return send(ws, { t: 'error', code: 'bad_request' });
      }
      me.guess = { lat, lng };
      send(ws, { t: 'guessed', ok: true });
      broadcast(room, { t: 'room', room: publicRoom(room) });
      maybeFinishEarly(room);
      return undefined;
    }

    case 'claim': {
      if (!room || !me || room.phase !== 'playing' || room.game !== 'bingo') return send(ws, { t: 'error', code: 'not_now' });
      // bei Panoramax kennt der Browser seine Koordinaten nicht – nachschlagen
      const spot = await whereIs(cfgOf(room), msg);
      const out = rules.judgeSnap(room, me.id, spot ? { ...msg, ...spot } : msg);
      if (!out.ok) return send(ws, { t: 'error', code: out.reason });
      send(ws, { t: 'claimed', cell: out.cell, status: out.status });
      broadcast(room, { t: 'board', board: publicBoard(room.board) });
      return undefined;
    }

    case 'done': {
      if (!room || !me) return send(ws, { t: 'error', code: 'not_now' });
      me.done = true;
      broadcast(room, { t: 'room', room: publicRoom(room) });
      maybeFinishEarly(room);
      return undefined;
    }

    case 'vote': {
      if (!room || !me || room.phase !== 'tribunal') return send(ws, { t: 'error', code: 'not_now' });
      const cell = room.board.cells.find((c) => c.snap?.id === msg.snapId);
      if (!cell || cell.status !== 'tribunal') return send(ws, { t: 'error', code: 'bad_request' });
      if (cell.team === me.team) return send(ws, { t: 'error', code: 'own_team' });
      const votes = cell.snap.votes;
      votes.real = votes.real.filter((id) => id !== me.id);
      votes.fake = votes.fake.filter((id) => id !== me.id);
      (msg.real ? votes.real : votes.fake).push(me.id);
      send(ws, { t: 'voted', snapId: msg.snapId, real: Boolean(msg.real) });
      return undefined;
    }

    case 'again': {
      if (!room || !me || room.hostId !== me.id) return send(ws, { t: 'error', code: 'not_host' });
      stopClock(room);
      room.phase = 'lobby';
      room.roundNo = 0;
      room.history = [];
      room.board = null;
      room.round = null;
      for (const p of room.players.values()) {
        p.points = 0;
        p.guess = null;
        p.done = false;
      }
      return broadcast(room, { t: 'room', room: publicRoom(room) });
    }

    case 'leave': {
      if (!room) return undefined;
      onClose(ws);
      ws.room = null;
      ws.playerId = null;
      return send(ws, { t: 'left' });
    }

    // --- GeoHunt ---------------------------------------------------------
    case 'move': {
      // Der Client meldet, wo er gerade steht. Zurück kommt nur "wie warm" und
      // die Richtung – nie die Entfernung, sonst ließe sich das Ziel ausrechnen.
      if (!room || !me || room.phase !== 'playing' || room.game !== 'hunt') return undefined;
      const at = await whereIs(cfgOf(room), msg);
      if (!at) return undefined;
      me.at = at;
      if (me.found) return undefined;
      const km = rules.distanceKm(room.round.truth, at);
      return send(ws, { t: 'heat', heat: rules.heatFor(km), bearing: rules.bearing(at, room.round.truth) });
    }

    case 'arrive': {
      if (!room || !me || room.phase !== 'playing' || room.game !== 'hunt') return send(ws, { t: 'error', code: 'not_now' });
      if (me.found) return send(ws, { t: 'error', code: 'already_found' });
      const at = await whereIs(cfgOf(room), msg);
      if (!at) return send(ws, { t: 'error', code: 'bad_request' });
      me.at = at;
      const km = rules.distanceKm(room.round.truth, at);
      if (km * 1000 > rules.HUNT_RADIUS_M) {
        return send(ws, { t: 'heat', heat: rules.heatFor(km), bearing: rules.bearing(at, room.round.truth), missed: true });
      }
      const secondsLeft = Math.max(0, Math.round((room.endsAt - Date.now()) / 1000));
      room.round.found.push(me.id);
      const points = rules.huntPoints({ secondsLeft, totalSeconds: room.seconds, rank: room.round.found.length });
      me.found = { at: Date.now(), seconds: room.seconds - secondsLeft, points, rank: room.round.found.length };
      me.points += points;
      send(ws, { t: 'found', found: me.found });
      broadcast(room, { t: 'room', room: publicRoom(room) });
      maybeFinishEarly(room);
      return undefined;
    }

    case 'ping':
      return send(ws, { t: 'pong', at: Date.now() });

    default:
      return send(ws, { t: 'error', code: 'unknown_message' });
  }
}
