// Random games of every mode with players who come and go, leave, get kicked,
// open second tabs, repeat their hello and send rubbish. After every step the
// states of all players are checked: nothing names an author, a bringer or a
// vote too early, the scoreboard only moves with the scores, no phase runs
// longer than its clock allows, nothing lands in the error log and every game
// reaches its final.
//   SOAK_GAMES=2000 SOAK_SEED=7 node --test test/game-soak.test.js
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { caption, flush, hits, setupGame } from './game-harness.js';

const GAMES = Number(process.env.SOAK_GAMES || 40);
const SEED = Number(process.env.SOAK_SEED || 1);

let env;
const logged = []; // what the server wrote to its error log ("[game] ...")
const realError = console.error;
before(async () => {
  env = await setupGame({ MIN_PLAYERS: '1' });
  console.error = (...args) => {
    const line = args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ');
    if (line.startsWith('[')) logged.push(line);
    else realError(...args);
  };
});
after(async () => {
  console.error = realError;
  await env.shutdown();
  // rooms close when everybody is gone, queues are empty
  assert.equal(env.game.stats().rooms, 0);
});

/** small seeded generator, so a failing run can be repeated with its seed */
function generator(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// messages no screen would send
const RUBBISH = [
  { t: 'vote' }, { t: 'vote', score: 9 }, { t: 'vote', score: '3' }, { t: 'draft', captions: 'x' }, { t: 'draft', captions: [null, 5, { text: {} }] },
  { t: 'submit' }, { t: 'pick' }, { t: 'pick', id: 5 }, { t: 'pick', id: '999' }, { t: 'pick', id: '1' }, { t: 'search' }, { t: 'search', q: {} },
  { t: 'search', q: 'a' }, { t: 'search', random: 'yes' }, { t: 'search', random: true }, { t: 'swap_pick' }, { t: 'swap_pick', id: {} }, { t: 'swap_search', q: [] },
  { t: 'swap_clear' }, { t: 'swap_random' }, { t: 'broken' }, { t: 'broken', id: null, noVideo: true }, { t: 'kick', pid: 'x' }, { t: 'kick' },
  { t: 'settings', settings: { game: 'same', rounds: 99 } }, { t: 'settings', settings: 'x' }, { t: 'pack', id: {} }, { t: 'report' },
  { t: 'report', target: 'vote', reason: {} }, { t: 'report', target: 'result', round: 'x', pid: null }, { t: 'react' }, { t: 'react', emoji: ['laugh'] },
  { t: 'profile', name: {}, avatar: [1, 2] }, { t: 'unsubmit' }, { t: 'reroll' }, { t: 'again' }, { t: 'start' }, { t: 'hello' },
  { t: 'hello', code: 'AAAAA', pid: {} }, { t: 'constructor' },
];

async function playGame(index, rand) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const chance = (p) => rand() < p;
  const mode = pick(['classic', 'hunt', 'swap', 'same']);
  const n = 1 + Math.floor(rand() * (chance(0.2) ? 12 : 5));
  const rounds = 1 + Math.floor(rand() * 3);
  const paced = mode !== 'classic';
  const isPublic = (mode === 'classic' || mode === 'hunt') && n >= 2 && chance(0.25);
  const t0 = env.now();
  const trace = [];
  const note = (what) => {
    trace.push(`${env.now() - t0}:${what}`);
    if (trace.length > 60) trace.shift();
  };
  const fail = (msg) => {
    throw new Error(`seed ${SEED}, game ${index} (${isPublic ? 'public ' : ''}${mode}, ${n} players, ${rounds} rounds): ${msg}\nlast events: ${trace.join(' | ')}`);
  };

  env.search((q) => (q === 'none' ? [] : hits(q, 6 + Math.floor(rand() * 20), chance(0.5) ? 'video' : 'image')));
  let room;
  let players;
  if (isPublic) {
    room = env.game.createRoom({ game: mode, isPublic: true });
    players = Array.from({ length: Math.min(n, 8) }, () => env.client().join(room.code));
    room.settings = { ...room.settings, rounds, captionTime: 30, voteTime: 8 };
  } else {
    const settings = { rounds, captionTime: pick([30, 45]), voteTime: 8, uploadTime: 30, searches: pick([0, 1, 3]) };
    ({ room, players } = await env.room(n, { game: mode, channel: 'beta', settings }));
  }
  const { code } = room;
  const all = [...players];
  const tabs = []; // sockets of tabs that were replaced by a newer one
  // one player mostly sits there and does nothing (and is away soon in the paced modes)
  if (players.length >= 3) players[players.length - 1].lazy = true;
  const online = (c) => c.ws.readyState === 1 && !c.out && c.state;
  const hello = (c) => c.send({ t: 'hello', code, pid: c.pid, secret: c.secret, name: c.name, avatar: 'cat|1' });
  const gone = (pid) => all.find((c) => c.pid === pid)?.left;

  /** what one player sees must be allowed at this moment */
  const inspect = (c) => {
    const s = c.state;
    if (!online(c) || s.code !== code) return;
    if (['upload', 'caption', 'vote', 'scores'].includes(s.phase) && s.deadline < env.now() - 1000) fail(`${c.name}: no clock in ${s.phase}`);
    if (!paced && (s.lastCall || s.players.some((p) => p.away))) fail('classic shows pacing');
    if (['upload', 'caption', 'vote'].includes(s.phase)) {
      // outside the player list nobody's id may appear: no author, no bringer, no voter
      const { players: list, you, hostId, ...rest } = s;
      const text = JSON.stringify(rest);
      for (const other of all) if (text.includes(other.pid)) fail(`${c.name} sees an id in ${s.phase}: ${text.slice(Math.max(0, text.indexOf(other.pid) - 100), text.indexOf(other.pid) + 40)}`);
    }
    if (s.phase === 'vote') {
      // the scoreboard stands still until the scores (who leaves and returns starts at zero)
      const board = new Map(s.players.map((p) => [p.id, `${p.score}/${p.lastPoints}/${p.streak}`]));
      if (c.board?.round === s.round) {
        for (const [pid, row] of board) if (c.board.rows.has(pid) && c.board.rows.get(pid) !== row && !gone(pid)) fail(`${c.name}: the board moved during the vote`);
      }
      c.board = { round: s.round, rows: board };
      const v = s.vote;
      if (v.stage === 'rating' && (v.points !== null || v.avg !== null || v.dist !== null)) fail('points before the reveal');
      if (mode === 'hunt' && v.stage === 'rating' && v.meme.query) fail('search term before the reveal');
      if (v.isMine && v.myScore !== null) fail('voted on the own meme');
    } else c.board = null;
    if (s.phase === 'caption' && s.caption && !s.caption.spectator) {
      const cap = s.caption;
      if (cap.hand.some((tile) => 'from' in tile)) fail('a tile names its bringer');
      if (cap.hand.length && cap.hand.find((tile) => tile.id === cap.pickedId)?.media.id !== cap.media.id) fail('picked tile and picture differ');
      if (cap.hand.length > 24) fail('tray too large');
      if (cap.submitted && !cap.media) fail('submitted without a picture');
    }
    if (s.phase === 'scores') {
      for (const p of s.players) {
        const memes = s.results.filter((r) => r.pid === p.id).reduce((sum, r) => sum + r.points, 0);
        const bonus = s.results.filter((r) => r.assist?.pid === p.id).reduce((sum, r) => sum + r.assist.points, 0);
        if (p.lastPoints !== memes + bonus && !gone(p.id)) fail(`${p.name}: +${p.lastPoints} on the board, ${memes} + ${bonus} in the results`);
      }
      for (const r of s.results) {
        if (r.dist && r.dist.reduce((sum, k, i) => sum + k * (i + 1), 0) !== r.points) fail('the distribution does not add up to the points');
        if (mode !== 'swap' && (r.assist || r.from)) fail('picture bonus outside the swap round');
        if (r.assist && r.assist.pid === r.pid) fail('picture bonus for the author');
      }
    }
    if (s.phase === 'final') {
      const { ranking, decidedBy } = s.final;
      for (let i = 1; i < ranking.length; i++) if (ranking[i].score > ranking[i - 1].score || ranking[i].rank < ranking[i - 1].rank) fail('ranking out of order');
      if (!paced && decidedBy) fail('tie-break in classic');
    }
  };

  /** no phase may run longer than its clock (plus the short "everybody is done" countdown) */
  let stage = { key: '', at: 0 };
  const inspectRoom = () => {
    const item = room.current?.voteItem;
    const key = `${room.phase}|${room.round}|${item ? `${room.current.voteIndex}|${item.stage}` : ''}`;
    if (key !== stage.key) stage = { key, at: env.now() };
    const s = room.settings;
    const voteMs = item?.stage === 'reveal' ? 3500 : s.voteTime * 1000 + 1000;
    const max = { upload: s.uploadTime * 1000 + 3000, caption: s.captionTime * 1000 + 2000, vote: voteMs, scores: 12000, starting: 9000 }[room.phase];
    if (max && env.now() - stage.at > max + 200) fail(`${room.phase} runs for ${env.now() - stage.at} ms (allowed: ${max})`);
    if (logged.length) fail(`error log: ${logged.join('\n')}`);
  };
  const inspectAll = () => {
    all.forEach(inspect);
    inspectRoom();
  };
  /** lets the clock run; players who nag repeat their hello twice a second */
  const wait = async (ms) => {
    for (let i = 0; i < ms; i += 10) {
      mock.timers.tick(10);
      if (i % 500 !== 490) continue;
      for (const c of all) {
        if (!(c.nag > 0) || !online(c)) continue;
        c.nag -= 1;
        hello(c);
      }
    }
    await flush(2);
    inspectAll();
  };

  if (isPublic) await wait(4000);
  else await env.start(players[0]);
  // generous: every phase with its full clock
  const limit = rounds * (30 + 45 + 20 * 12.5 + 17) * 1000 + 30_000;
  let steps = 0;
  while (env.now() - t0 < limit && room.phase !== 'final' && !(isPublic && room.phase === 'lobby' && steps > 50)) {
    steps += 1;
    let c = pick(all);
    if (c.lazy && chance(0.9)) c = pick(all);
    const s = c.state;
    const boss = all.find((x) => online(x) && x.pid === s?.hostId);
    const roll = rand();
    if (c.lazy && online(c) && chance(0.5)) {
      if (chance(0.1)) c.nag = 200;
    } else if (!online(c)) {
      if (chance(0.25) && !c.kicked) {
        if (c.ws.readyState === 1) c.drop();
        c.take('welcome');
        c.join(code);
        c.out = !c.take('welcome').length; // the room may be full by now
        if (c.out) c.drop();
        note(`${c.name} ${c.out ? 'is refused' : 'is back'}`);
      }
    } else if (roll < 0.02 && all.length < 20) {
      const late = env.client({ name: `Late${all.length}` }).join(code);
      late.out = !late.take('welcome').length;
      if (late.out) late.drop();
      all.push(late);
      note(`${late.name} joins in ${room.phase}`);
    } else if (roll < 0.05) {
      note(`${c.name} drops`);
      c.drop();
    } else if (roll < 0.065) {
      note(`${c.name} leaves`);
      c.send({ t: 'leave' });
      c.out = true;
      c.left = true;
    } else if (roll < 0.075) {
      const victim = pick(all);
      if (boss && victim !== boss && !victim.out) {
        note(`${boss.name} kicks ${victim.name}`);
        boss.send({ t: 'kick', pid: victim.pid });
        victim.out = true;
        victim.kicked = true;
      }
    } else if (roll < 0.08) {
      if (boss) boss.send({ t: 'skip' });
    } else if (roll < 0.09) {
      note(`${c.name} opens a second tab`);
      tabs.push(c.ws);
      c.join(code);
    } else if (roll < 0.095) {
      // the same socket as a stranger, then as itself again
      c.send({ t: 'hello', code, pid: `stranger-${index}-${steps}`, secret: 'secret-of-a-stranger-0123456789', name: 'X', avatar: 'cat|1' });
      hello(c);
    } else if (roll < 0.105) {
      c.nag = 200;
    } else if (roll < 0.16) {
      c.send(pick(RUBBISH));
    } else if (roll < 0.2) {
      c.send({ t: 'react', emoji: 'laugh' });
    } else if (s.phase === 'upload') {
      const k = rand();
      if (k < 0.3) c.send({ t: 'swap_random' });
      else if (k < 0.5) await env.upload(c, code).catch((err) => err.status || Promise.reject(err));
      else if (k < 0.8) {
        c.send({ t: 'swap_search', q: pick(['cats', 'dogs', 'none', 'cats']) });
        await flush();
        const [res] = c.take('swap_results').slice(-1);
        if (res?.items.length) c.send({ t: 'swap_pick', id: pick(res.items.slice(0, 3)).id });
      } else if (k < 0.9) c.send({ t: 'swap_clear' });
    } else if (s.phase === 'caption' && s.caption && !s.caption.spectator) {
      const k = rand();
      const cap = s.caption;
      if (mode === 'hunt' && !cap.media) {
        if (k < 0.5) c.send({ t: 'search', q: pick(['cats', 'dogs', 'none', 'birds']) });
        else if (k < 0.8) c.send({ t: 'search', random: true });
        else c.send({ t: 'draft', captions: caption('text first') });
      } else if (k < 0.35) c.send({ t: 'submit', captions: caption(chance(0.1) ? '  ' : `${c.name} says hi`) });
      else if (k < 0.45) c.send({ t: 'draft', captions: caption(chance(0.3) ? '' : 'draft') });
      else if (k < 0.55 && cap.hand.length) c.send({ t: 'pick', id: pick(cap.hand).id });
      else if (k < 0.65) c.send({ t: 'unsubmit' });
      else if (k < 0.72) c.send({ t: 'reroll' });
      else if (k < 0.8 && cap.media) c.send({ t: 'broken', id: cap.media.id, noVideo: chance(0.3) });
      else if (mode === 'hunt') c.send(k < 0.9 ? { t: 'search', q: pick(['cats', 'dogs', 'frogs']) } : { t: 'search', random: true });
    } else if (s.phase === 'vote') {
      if (chance(0.8)) c.send({ t: 'vote', score: 1 + Math.floor(rand() * 5) });
      if (chance(0.1)) c.send({ t: 'report', target: 'vote', reason: pick(['meme', 'upload']) });
      if (chance(0.1)) c.send({ t: 'report', target: 'result', pid: pick(all).pid, reason: 'meme' });
    }
    await flush(2);
    inspectAll();
    await wait(pick([0, 0, 50, 200, 700, 1500, 4000]));
  }
  // (a public room that everybody left never finishes its game)
  if (room.phase !== 'final' && !(isPublic && room.players.size < 2)) fail(`still in ${room.phase} of round ${room.round} after ${Math.round((env.now() - t0) / 1000)} s`);

  // back to the lobby with a clean board
  const host = all.find((x) => online(x) && x.pid === room.hostId);
  if (host && room.phase === 'final') {
    host.send({ t: 'again' });
    await flush();
    if (host.state.phase !== 'lobby') fail('no way back to the lobby');
    if (host.state.players.some((p) => p.score || p.away || p.streak || p.lastPoints)) fail('the board was not reset');
  }
  for (const c of all) if (c.ws.readyState === 1) c.drop();
  for (const ws of tabs) {
    if (ws.readyState !== 1) continue;
    ws.readyState = 3;
    env.wss.clients.delete(ws);
    ws.emit('close');
  }
  return mode;
}

test(`${GAMES} random games with restless and hostile players (seed ${SEED})`, async () => {
  const rand = generator(SEED);
  const played = {};
  for (let i = 0; i < GAMES; i++) {
    const mode = await playGame(i, rand);
    played[mode] = (played[mode] || 0) + 1;
  }
  assert.deepEqual(Object.keys(played).sort(), ['classic', 'hunt', 'same', 'swap']);
  assert.deepEqual(logged, []);
});
