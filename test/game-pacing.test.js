// Pacing of the new modes (not classic): away players, last call, final ranking and awards.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { caption, flush, setupGame } from './game-harness.js';

let env;
before(async () => {
  env = await setupGame();
  env.search();
});

const left = (c) => c.state.deadline - env.now();
const row = (viewer, player) => viewer.state.players.find((p) => p.id === player.pid);

async function ready(player, text = player.name) {
  player.send({ t: 'search', q: `gif of ${player.name}` });
  await flush();
  player.send({ t: 'submit', captions: caption(text) });
}

/** one vote phase in which everybody votes; `score(voter, author)` returns 1-5 */
async function voteAll(players, score) {
  const total = players[0].state.vote.total;
  for (let i = 0; i < total; i++) {
    const author = players.find((p) => p.state.vote.isMine);
    for (const p of players) if (p !== author) p.send({ t: 'vote', score: score(p, author) });
    await env.advance(900);
    assert.equal(players[0].state.vote.stage, 'reveal');
    await env.advance(3500);
  }
}

test('pacing: last call shortens the caption phase once, never below half of the time', async () => {
  const { players, host } = await env.room(4, { game: 'hunt' });
  const [ann, ben, cleo, dora] = players;
  await env.start(host);
  await env.advance(30_000);
  await ready(ann);
  await ready(ben);
  assert.equal(host.state.lastCall, false);
  assert.equal(left(host), 60_000);
  await ready(cleo);
  // three of four are done after 30 s: 20 s for the last one
  for (const p of players) {
    assert.equal(p.state.lastCall, true);
    assert.equal(left(p), 20_000);
  }
  // one-way: changing a meme does not bring the time back, a second quorum does not shorten again
  await env.advance(5000);
  ann.send({ t: 'unsubmit' });
  assert.equal(left(host), 15_000);
  ann.send({ t: 'submit', captions: caption('better') });
  assert.equal(left(host), 15_000);
  assert.equal(host.state.lastCall, true);
  // the last one finishes: the usual 1.5 s
  await ready(dora);
  assert.equal(left(host), 1500);
  await env.advance(1500);
  assert.equal(host.state.phase, 'vote');
  assert.equal(host.state.lastCall, false);
});

test('pacing: an early quorum waits for half of the configured time', async () => {
  const { players, host } = await env.room(4, { game: 'hunt' });
  await env.start(host);
  await env.advance(5000);
  for (const p of players.slice(0, 3)) await ready(p);
  assert.equal(host.state.lastCall, true);
  assert.equal(left(host), 40_000); // second 45 of 90
  await env.advance(40_000);
  assert.equal(host.state.phase, 'vote');
});

test('pacing: no last call when it would not save at least a second, and never with two players', async () => {
  const late = await env.room(4, { game: 'hunt' });
  await env.start(late.host);
  await env.advance(69_500);
  for (const p of late.players.slice(0, 3)) await ready(p);
  assert.equal(late.host.state.lastCall, false);
  assert.equal(left(late.host), 20_500);

  const duo = await env.room(2, { game: 'hunt' });
  await env.start(duo.host);
  await ready(duo.host);
  assert.equal(duo.host.state.lastCall, false);
  assert.equal(left(duo.host), 90_000);
});

test('pacing: the shortened clock survives an early end that is cancelled by a returning player', async () => {
  const { code, players, host } = await env.room(4, { game: 'hunt' });
  const [ann, ben, cleo, dora] = players;
  await env.start(host);
  await env.advance(10_000);
  dora.drop();
  await env.advance(2000);
  for (const p of [ann, ben, cleo]) await ready(p);
  // Dora still counts for a few seconds (reconnect grace): last call, floor at second 45
  assert.equal(host.state.lastCall, true);
  assert.equal(left(host), 33_000);
  // grace over: everybody who is here is done -> 1.5 s
  await env.advance(8100);
  assert.equal(left(host), 1500);
  // Dora is back before that: the clock returns to the shortened deadline, not to the full 90 s
  await env.advance(1000);
  dora.join(code);
  assert.equal(left(dora), 33_000 - 9100);
  assert.equal(dora.state.lastCall, true);
  assert.ok(dora.state.caption.hunt);
});

test('pacing: a silent round makes a player away - the others are no longer held up', async () => {
  const { players, host } = await env.room(4, { game: 'hunt', settings: { rounds: 3 } });
  const [ann, ben, cleo, dora] = players;
  const active = [ann, ben, cleo];
  await env.start(host);
  for (const p of active) await ready(p);
  assert.equal(left(host), 45_000); // last call
  for (const p of players) assert.equal(row(p, dora).away, false);
  await env.advance(45_000);
  // the round ended without any input from Dora
  assert.equal(host.state.phase, 'vote');
  for (const p of players) {
    assert.deepEqual(p.state.players.map((x) => x.away), [false, false, false, true]);
  }
  // vote: everybody who is not away has voted -> reveal after 0.9 s, Dora is not waited for
  for (let i = 0; i < 3; i++) {
    const author = active.find((p) => p.state.vote.isMine);
    const voters = active.filter((p) => p !== author);
    assert.equal(host.state.vote.voters, 3); // the count still shows everybody who could vote
    voters[0].send({ t: 'vote', score: 4 });
    await env.advance(1000);
    assert.equal(host.state.vote.stage, 'rating');
    voters[1].send({ t: 'vote', score: 4 });
    assert.equal(host.state.lastCall, false);
    await env.advance(899);
    assert.equal(host.state.vote.stage, 'rating');
    await env.advance(1);
    assert.equal(host.state.vote.stage, 'reveal');
    await env.advance(3500);
  }
  assert.equal(host.state.phase, 'scores');
  await env.advance(12_000);

  // round 2: the three finish -> the phase ends right away
  assert.equal(host.state.round, 2);
  assert.equal(row(host, dora).away, true);
  await ready(ann);
  await ready(ben);
  assert.equal(host.state.lastCall, true, 'two of three who are here: last call for the third');
  await ready(cleo);
  assert.equal(left(host), 1500);
  // Dora comes back: an unchanged draft is no sign of life, a real change is
  dora.send({ t: 'draft', captions: [] });
  assert.equal(row(host, dora).away, true);
  dora.send({ t: 'draft', captions: caption('I am back') });
  for (const p of players) assert.equal(row(p, dora).away, false);
  await env.advance(1500);
  assert.equal(host.state.phase, 'vote');
  assert.equal(host.state.vote.total, 4, 'her text became a meme');
  assert.equal(row(host, dora).away, false);
});

test('pacing: two missed votes in a row make a player away, any input brings them back', async () => {
  const { players, host } = await env.room(5, { game: 'hunt', settings: { rounds: 1 } });
  const [ann, ben, cleo, dora, eve] = players;
  await env.start(host);
  for (const p of players) await ready(p);
  await env.advance(1500);
  assert.equal(host.state.phase, 'vote');
  const voters = (author) => players.filter((p) => p !== author && p !== eve);
  let missed = 0;
  let item = 0;
  // Eve wrote a meme but does not vote
  while (missed < 2) {
    const author = players.find((p) => p.state.vote.isMine);
    const others = voters(author);
    for (const p of others) p.send({ t: 'vote', score: 3 });
    if (author === eve) {
      // everybody voted on her meme: the usual early reveal
      await env.advance(900);
      assert.equal(host.state.vote.stage, 'reveal');
      await env.advance(3500);
    } else {
      // three of four voted: last call of 4 s instead of the remaining 12
      assert.equal(host.state.lastCall, true);
      assert.equal(left(host), 4000);
      assert.equal(row(host, eve).away, false);
      await env.advance(4000);
      missed += 1;
      assert.equal(row(host, eve).away, missed >= 2);
      await env.advance(3500);
    }
    item += 1;
  }
  // from now on nobody waits for her
  assert.ok(item < 5);
  const author = players.find((p) => p.state.vote.isMine);
  const others = voters(author);
  for (const p of others) p.send({ t: 'vote', score: 3 });
  await env.advance(899);
  assert.equal(host.state.vote.stage, 'rating');
  await env.advance(1);
  assert.equal(host.state.vote.stage, 'reveal');
  // a reaction is input too
  eve.send({ t: 'react', emoji: 'laugh' });
  assert.equal(row(host, eve).away, false);
  assert.equal(ann.take('react').length, 1);
});

test('pacing: the vote last call needs at least three voters and is used once per meme', async () => {
  const { players, host } = await env.room(5, { game: 'hunt', settings: { rounds: 1, voteTime: 20 } });
  await env.start(host);
  for (const p of players) await ready(p);
  await env.advance(1500);
  const author = players.find((p) => p.state.vote.isMine);
  const voters = players.filter((p) => p !== author);
  await env.advance(2000);
  voters[0].send({ t: 'vote', score: 5 });
  voters[1].send({ t: 'vote', score: 5 });
  assert.equal(left(host), 18_000);
  assert.equal(host.state.lastCall, false);
  voters[2].send({ t: 'vote', score: 5 });
  assert.equal(left(host), 4000);
  assert.equal(host.state.lastCall, true);
  await env.advance(1000);
  voters[2].send({ t: 'vote', score: 4 }); // changing the vote does not restart the 4 s
  assert.equal(left(host), 3000);
  await env.advance(3000);
  assert.equal(host.state.vote.stage, 'reveal');
  assert.equal(host.state.vote.points, 14);
  assert.deepEqual(host.state.vote.dist, [0, 0, 0, 1, 2]);
  await env.advance(3500);
  // the next meme starts without a last call
  assert.equal(host.state.vote.stage, 'rating');
  assert.equal(host.state.lastCall, false);
  assert.equal(left(host), 20_000);
});

test('final: equal scores are decided by rounds won', async () => {
  const accA = env.account('pace_ann');
  const accB = env.account('pace_ben');
  const room = env.game.createRoom({ game: 'hunt' });
  const ann = env.client({ account: accA }).join(room.code);
  await env.advance(5);
  const ben = env.client({ account: accB }).join(room.code);
  await env.advance(5);
  const cleo = env.client({ name: 'Cleo' }).join(room.code);
  const players = [ann, ben, cleo];
  ann.send({ t: 'settings', settings: { ...ann.state.settings, rounds: 2 } });
  await env.start(ann);
  // points per meme = sum of two ratings
  const plan = [
    new Map([[ann, [5, 5]], [ben, [4, 3]], [cleo, [1, 1]]]), // Ann 10 (wins), Ben 7, Cleo 2
    new Map([[ann, [2, 2]], [ben, [4, 3]], [cleo, [4, 4]]]), // Ann 4, Ben 7, Cleo 8 (wins)
  ];
  for (const scores of plan) {
    for (const p of players) await ready(p);
    await env.advance(1500);
    const given = new Map();
    await voteAll(players, (voter, author) => {
      const n = given.get(author) || 0;
      given.set(author, n + 1);
      return scores.get(author)[n];
    });
    assert.equal(ann.state.phase, 'scores');
    await env.advance(12_000);
  }
  const final = ann.state.final;
  assert.equal(ann.state.phase, 'final');
  assert.deepEqual(final.ranking, [
    { pid: ann.pid, rank: 1, score: 14, roundWins: 1, bestMeme: 10 },
    { pid: ben.pid, rank: 2, score: 14, roundWins: 0, bestMeme: 7 },
    { pid: cleo.pid, rank: 3, score: 10, roundWins: 1, bestMeme: 8 },
  ]);
  assert.equal(final.tie, false);
  assert.equal(final.decidedBy, 'wins');
  assert.equal(final.at, env.now());
  // awards: every meme was made with one search
  assert.deepEqual(final.awards, [
    { id: 'one_shot', pid: ann.pid, value: 10, round: 1 },
    { id: 'best_meme', pid: ann.pid, value: 10, round: 1 },
    { id: 'best_avg', pid: ann.pid, value: 3.5 }, // Ben has the same average - the higher rank decides
  ]);
  const rows = env.db.all('SELECT user_id, points, won, round_wins FROM game_results WHERE user_id IN (?, ?) ORDER BY user_id', accA.id, accB.id);
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { user_id: accA.id, points: 14, won: 1, round_wins: 1 },
    { user_id: accB.id, points: 14, won: 0, round_wins: 0 },
  ]);

  // a reconnect sees the same final
  ben.drop();
  ben.join(room.code);
  assert.deepEqual(ben.state.final.ranking, final.ranking);
  assert.equal(ben.state.final.at, final.at);
  // play again: everything is reset
  ann.send({ t: 'again' });
  assert.equal(ann.state.phase, 'lobby');
  assert.equal(ann.state.final, undefined);
  assert.deepEqual(ann.state.players.map((p) => [p.score, p.streak, p.away]), [[0, 0, false], [0, 0, false], [0, 0, false]]);
});

test('final: equal scores and equal wins are decided by the best single meme; streaks and the crowd award', async () => {
  const { players, host } = await env.room(3, { game: 'hunt', settings: { rounds: 2 } });
  const [ann, ben, cleo] = players;
  await env.start(host);
  const plan = [
    new Map([[ann, [5, 5]], [ben, [3, 3]], [cleo, [1, 1]]]), // Ann 10 (wins), Ben 6, Cleo 2
    new Map([[ann, [2, 2]], [ben, [4, 4]], [cleo, [1, 1]]]), // Ann 4, Ben 8 (wins), Cleo 2
  ];
  for (const [round, scores] of plan.entries()) {
    for (const p of players) await ready(p);
    await env.advance(1500);
    const total = host.state.vote.total;
    for (let i = 0; i < total; i++) {
      const author = players.find((p) => p.state.vote.isMine);
      const voters = players.filter((p) => p !== author);
      if (author === cleo) {
        // the crowd loves Cleo's memes: at most 5 reactions per fan and meme count
        for (let n = 0; n < 7; n++) {
          await env.advance(350);
          ann.send({ t: 'react', emoji: 'heart' });
        }
        await env.advance(350);
        ben.send({ t: 'react', emoji: 'laugh' });
        cleo.send({ t: 'react', emoji: 'flame' }); // the own meme does not count
      }
      voters.forEach((p, n) => p.send({ t: 'vote', score: scores.get(author)[n] }));
      await env.advance(900 + 3500);
    }
    assert.equal(host.state.phase, 'scores');
    assert.deepEqual(host.state.players.map((p) => p.streak), round === 0 ? [1, 0, 0] : [0, 1, 0]);
    assert.equal(JSON.stringify(host.state).includes('crowd'), false);
    await env.advance(12_000);
  }
  const final = host.state.final;
  assert.deepEqual(final.ranking.map((r) => [r.pid, r.rank, r.score]), [[ann.pid, 1, 14], [ben.pid, 2, 14], [cleo.pid, 3, 4]]);
  assert.equal(final.decidedBy, 'meme');
  assert.equal(final.tie, false);
  assert.deepEqual(final.awards, [
    { id: 'one_shot', pid: ann.pid, value: 10, round: 1 },
    { id: 'best_meme', pid: ann.pid, value: 10, round: 1 },
    { id: 'crowd', pid: cleo.pid, value: 12 },
  ]);
});

test('final: classic ranks by score only and keeps the shared first place', async () => {
  const { players, host } = await env.room(3, { settings: { rounds: 2 } });
  const [ann, ben, cleo] = players;
  await env.start(host);
  const plan = [
    new Map([[ann, [5, 5]], [ben, [3, 3]], [cleo, [1, 1]]]),
    new Map([[ann, [5, 4]], [ben, [5, 5]], [cleo, [1, 1]]]), // Ann 9, Ben 10 (wins)
  ];
  for (const [round, scores] of plan.entries()) {
    for (const p of players) p.send({ t: 'submit', captions: caption(p.name) });
    await env.advance(1500);
    for (let i = 0; i < 3; i++) {
      const author = players.find((p) => p.state.vote.isMine);
      players.filter((p) => p !== author).forEach((p, n) => p.send({ t: 'vote', score: scores.get(author)[n] }));
      await env.advance(900);
      assert.equal(host.state.vote.dist.reduce((a, b) => a + b, 0), 2);
      await env.advance(3500);
    }
    assert.deepEqual(host.state.results.map((r) => r.assist), [null, null, null]);
    assert.equal(host.state.results[0].dist.length, 5);
    assert.equal(host.state.results[0].searches, undefined);
    assert.equal(host.state.leftover, undefined);
    assert.deepEqual(host.state.players.map((p) => p.streak), round === 0 ? [1, 0, 0] : [0, 1, 0]);
    await env.advance(12_000);
  }
  // Ann 19, Ben 16 - make it a tie with a third round? No: check the plain ranking first
  const final = host.state.final;
  assert.deepEqual(final.ranking.map((r) => [r.pid, r.rank, r.score]), [[ann.pid, 1, 19], [ben.pid, 2, 16], [cleo.pid, 3, 4]]);
  assert.equal(final.tie, false);
  assert.equal(final.decidedBy, null);
  assert.deepEqual(final.awards.map((a) => a.id), ['best_meme', 'best_avg']);

  // a real tie in classic: both on rank 1, no tie-break although Ann won more rounds
  const tied = await env.room(3, { settings: { rounds: 2 } });
  const [a, b, c] = tied.players;
  await env.start(tied.host);
  const tiePlan = [
    new Map([[a, [5, 5]], [b, [4, 4]], [c, [1, 1]]]), // a 10 (wins), b 8
    new Map([[a, [4, 4]], [b, [5, 5]], [c, [1, 1]]]), // a 8, b 10 (wins)
  ];
  tiePlan[1].set(a, [5, 4]); // a 9 ...
  tiePlan[1].set(b, [5, 5]); // b 10 (wins) -> 19 : 18
  tiePlan[0].set(b, [5, 4]); // b 9 -> 19 : 19, round 1 is won by a
  for (const scores of tiePlan) {
    for (const p of tied.players) p.send({ t: 'submit', captions: caption(p.name) });
    await env.advance(1500);
    for (let i = 0; i < 3; i++) {
      const author = tied.players.find((p) => p.state.vote.isMine);
      tied.players.filter((p) => p !== author).forEach((p, n) => p.send({ t: 'vote', score: scores.get(author)[n] }));
      await env.advance(900 + 3500);
    }
    await env.advance(12_000);
  }
  const shared = tied.host.state.final;
  assert.deepEqual(shared.ranking.map((r) => [r.pid, r.rank, r.score]), [[a.pid, 1, 19], [b.pid, 1, 19], [c.pid, 3, 4]]);
  assert.equal(shared.tie, true);
  assert.equal(shared.decidedBy, null);
});

test('final: rounds that end level count for both - a full tie stays a shared win', async () => {
  const { players, host } = await env.room(2, { game: 'hunt', settings: { rounds: 2 } });
  await env.start(host);
  for (let round = 1; round <= 2; round++) {
    for (const p of players) await ready(p);
    await env.advance(1500);
    await voteAll(players, () => 5);
    await env.advance(12_000);
  }
  const final = host.state.final;
  assert.deepEqual(final.ranking.map((r) => [r.rank, r.score, r.roundWins, r.bestMeme]), [[1, 10, 2, 5], [1, 10, 2, 5]]);
  assert.equal(final.tie, true);
  assert.equal(final.decidedBy, null);
  assert.deepEqual(final.awards, []);
});
