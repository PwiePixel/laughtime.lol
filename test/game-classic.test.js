// Golden test of the classic mode: phases, timings, scoring, re-rolls and
// anonymity must stay exactly as they are.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { caption, flush, setupGame } from './game-harness.js';

let env;
before(async () => {
  env = await setupGame();
});

// time left on the phase clock (the deadline of the last state against the server clock)
const left = (c) => c.state.deadline - env.now();

/** everybody writes and submits "<name> <round>" */
function submitAll(players, round) {
  for (const p of players) p.send({ t: 'submit', captions: caption(`${p.name} ${round}`) });
}

/** plays one vote phase; `score(voter, authorName)` returns 1-5 */
async function voteAll(players, score, check = () => {}) {
  const total = players[0].state.vote.total;
  for (let i = 0; i < total; i++) {
    const author = players.find((p) => p.state.vote.isMine);
    check(author, 'rating');
    for (const p of players) if (p !== author) p.send({ t: 'vote', score: score(p, author) });
    await env.advance(900);
    check(author, 'reveal');
    await env.advance(3500);
  }
}

test('classic: a complete game with the exact phases, timings and scores', async () => {
  const { players, host } = await env.room(3, { names: ['Ann', 'Ben', 'Cleo'], settings: { rounds: 2 } });
  const [ann, ben, cleo] = players;
  assert.equal(host.state.phase, 'lobby');
  assert.deepEqual(
    { ...host.state.settings },
    { ...host.state.settings, game: 'classic', rounds: 2, captionTime: 90, voteTime: 12, uploadTime: 60, mode: 'mixed', rerolls: 2, maxPlayers: 10, pack: null },
  );

  await env.start(host);
  for (const p of players) {
    assert.equal(p.state.phase, 'caption');
    assert.equal(p.state.round, 1);
    assert.equal(left(p), 90_000);
    assert.ok(p.state.caption.media.id);
    assert.equal(p.state.caption.rerollsLeft, 2);
    assert.equal(p.state.caption.submitted, false);
    assert.deepEqual(p.state.caption.captions, []);
    assert.equal(p.state.caption.swapped, false);
    assert.equal(p.state.caption.hunt, undefined);
    assert.equal(p.state.players.length, 3);
    for (const row of p.state.players) {
      assert.equal(row.submitted, false);
      assert.equal(row.playing, true);
      assert.equal(row.score, 0);
    }
  }

  // re-roll: new template, one re-roll less
  const firstMedia = ann.state.caption.media.id;
  ann.send({ t: 'reroll' });
  assert.notEqual(ann.state.caption.media.id, firstMedia);
  assert.equal(ann.state.caption.rerollsLeft, 1);
  assert.equal(ann.state.caption.draftVersion, 1);
  ann.send({ t: 'reroll' }).send({ t: 'reroll' });
  assert.equal(ann.state.caption.rerollsLeft, 0);
  assert.equal(ann.state.caption.draftVersion, 2);

  // a draft is stored, an empty submit is refused
  ben.send({ t: 'draft', captions: caption('draft') });
  ben.send({ t: 'submit', captions: caption('   ') });
  assert.deepEqual(ben.errors(), ['empty_caption']);

  // the phase only ends early when ALL have submitted
  await env.advance(10_000);
  ann.send({ t: 'submit', captions: caption('Ann 1') });
  ben.send({ t: 'submit', captions: caption('Ben 1') });
  assert.equal(left(cleo), 80_000);
  assert.equal(cleo.state.players.filter((p) => p.submitted).length, 2);
  await env.advance(20_000);
  assert.equal(cleo.state.phase, 'caption');
  cleo.send({ t: 'submit', captions: caption('Cleo 1') });
  assert.equal(left(cleo), 1500);
  await env.advance(1500);

  // vote: 12 s rating per meme, early reveal 0.9 s after everybody voted, 3.5 s reveal
  const points = { Ann: 0, Ben: 0, Cleo: 0 };
  const table = { Ann: 5, Ben: 3, Cleo: 1 };
  for (let i = 0; i < 3; i++) {
    for (const p of players) {
      const v = p.state.vote;
      assert.equal(p.state.phase, 'vote');
      assert.equal(v.index, i);
      assert.equal(v.total, 3);
      assert.equal(v.stage, 'rating');
      assert.equal(v.votes, 0);
      assert.equal(v.voters, 2);
      assert.equal(v.points, null);
      assert.equal(v.avg, null);
      assert.equal(left(p), 12_000);
      // nothing in the vote state says who made the meme
      assert.equal('pid' in v, false);
      assert.equal('from' in v, false);
      for (const other of players) assert.equal(JSON.stringify(v).includes(other.pid), false);
      for (const row of p.state.players) {
        assert.equal(row.score, 0);
        assert.equal(row.lastPoints, 0);
        assert.equal('voted' in row, false);
      }
    }
    const author = players.find((p) => p.state.vote.isMine);
    assert.equal(players.filter((p) => p.state.vote.isMine).length, 1);
    assert.match(author.state.vote.meme.captions[0].text, new RegExp(`^${author.name} 1$`));
    // the author cannot vote
    author.send({ t: 'vote', score: 5 });
    assert.equal(author.state.vote.votes, 0);
    const voters = players.filter((p) => p !== author);
    voters[0].send({ t: 'vote', score: table[author.name] });
    assert.equal(left(voters[0]), 12_000);
    assert.equal(voters[0].state.vote.myScore, table[author.name]);
    voters[1].send({ t: 'vote', score: 9 }); // invalid
    assert.equal(voters[1].state.vote.votes, 1);
    voters[1].send({ t: 'vote', score: table[author.name] });
    assert.equal(voters[1].state.vote.votes, 2);
    await env.advance(899);
    assert.equal(ann.state.vote.stage, 'rating');
    await env.advance(1);
    for (const p of players) {
      assert.equal(p.state.vote.stage, 'reveal');
      assert.equal(p.state.vote.points, table[author.name] * 2);
      assert.equal(p.state.vote.avg, table[author.name]);
      assert.equal(left(p), 3500);
      for (const row of p.state.players) assert.equal(row.score, 0);
    }
    points[author.name] += table[author.name] * 2;
    await env.advance(3500);
  }

  // scores: 12 s, authors revealed, points = sum of the ratings
  for (const p of players) {
    assert.equal(p.state.phase, 'scores');
    assert.equal(left(p), 12_000);
    assert.equal(p.state.lastRound, false);
    assert.deepEqual(
      p.state.results.map((r) => [r.pid, r.points, r.avg, r.from]),
      [
        [ann.pid, 10, 5, null],
        [ben.pid, 6, 3, null],
        [cleo.pid, 2, 1, null],
      ],
    );
    assert.deepEqual(
      p.state.players.map((row) => [row.name, row.score, row.lastPoints]),
      [
        ['Ann', 10, 10],
        ['Ben', 6, 6],
        ['Cleo', 2, 2],
      ],
    );
  }
  assert.deepEqual(points, { Ann: 10, Ben: 6, Cleo: 2 });
  await env.advance(11_999);
  assert.equal(ann.state.phase, 'scores');
  await env.advance(1);

  // round 2: fresh re-rolls, unsent drafts with text count when the time runs out
  for (const p of players) {
    assert.equal(p.state.phase, 'caption');
    assert.equal(p.state.round, 2);
    assert.equal(left(p), 90_000);
    assert.equal(p.state.caption.rerollsLeft, 2);
  }
  ann.send({ t: 'draft', captions: caption('Ann 2') });
  ben.send({ t: 'submit', captions: caption('Ben 2') });
  await env.advance(89_999);
  assert.equal(ann.state.phase, 'caption');
  await env.advance(1);
  assert.equal(ann.state.phase, 'vote');
  assert.equal(ann.state.vote.total, 2); // Cleo wrote nothing -> no meme
  await voteAll(players, () => 4);
  assert.equal(ann.state.phase, 'scores');
  assert.equal(ann.state.lastRound, true);
  assert.deepEqual(
    ann.state.players.map((row) => [row.name, row.score, row.lastPoints]),
    [
      ['Ann', 18, 8],
      ['Ben', 14, 8],
      ['Cleo', 2, 0],
    ],
  );
  await env.advance(12_000);

  for (const p of players) {
    assert.equal(p.state.phase, 'final');
    assert.equal(p.state.deadline, 0);
    assert.equal(p.state.final.totalMemes, 5);
    assert.equal(p.state.final.best[0].points, 10);
    assert.equal(p.state.final.best[0].pid, ann.pid);
  }

  // play again: back to the lobby with clean scores
  host.send({ t: 'again' });
  assert.equal(ben.state.phase, 'lobby');
  assert.deepEqual(ben.state.players.map((row) => row.score), [0, 0, 0]);
});

test('classic: no pacing rules - three of four done changes nothing, nobody is away', async () => {
  const { players, host } = await env.room(4, { settings: { rounds: 3 } });
  await env.start(host);
  await env.advance(5000);
  submitAll(players.slice(0, 3), 1);
  for (const p of players) {
    assert.equal(left(p), 85_000);
    assert.ok(!p.state.lastCall);
  }
  await env.advance(60_000);
  assert.equal(host.state.phase, 'caption');
  assert.equal(left(host), 25_000);
  // unsubmit and submit again: still the full time
  players[0].send({ t: 'unsubmit' });
  assert.equal(players[0].state.caption.submitted, false);
  players[0].send({ t: 'submit', captions: caption('again') });
  assert.equal(left(host), 25_000);
  await env.advance(25_000);
  assert.equal(host.state.phase, 'vote');
  assert.equal(host.state.vote.total, 3);

  // vote: three of the eligible voters voted -> still the full 12 s, the silent one changes nothing
  const silent = players[3];
  for (let i = 0; i < 3; i++) {
    const author = players.find((p) => p.state.vote.isMine);
    for (const p of players) if (p !== author && p !== silent) p.send({ t: 'vote', score: 3 });
    assert.equal(left(host), 12_000);
    assert.ok(!host.state.lastCall);
    await env.advance(11_999);
    assert.equal(host.state.vote.stage, 'rating');
    await env.advance(1);
    assert.equal(host.state.vote.stage, 'reveal');
    assert.equal(host.state.vote.points, 6);
    await env.advance(3500);
  }
  assert.equal(host.state.phase, 'scores');
  await env.advance(12_000);

  // two rounds in which one player does nothing at all: never marked as away, never skipped
  for (let round = 2; round <= 3; round++) {
    assert.equal(host.state.phase, 'caption');
    for (const p of players) for (const row of p.state.players) assert.ok(!row.away);
    submitAll(players.slice(0, 3), round);
    assert.equal(left(host), 90_000);
    await env.advance(90_000);
    assert.equal(host.state.phase, 'vote');
    for (let i = 0; i < 3; i++) {
      const author = players.find((p) => p.state.vote.isMine);
      for (const p of players) if (p !== author && p !== silent) p.send({ t: 'vote', score: 2 });
      assert.equal(left(host), 12_000);
      await env.advance(12_000);
      await env.advance(3500);
    }
    assert.equal(host.state.phase, 'scores');
    await env.advance(12_000);
  }
  assert.equal(host.state.phase, 'final');
});

test('classic: late join plays with more than 15 s left, otherwise watches and votes', async () => {
  const { code, players, host } = await env.room(2);
  await env.start(host);
  await env.advance(74_000); // 16 s left
  const late = env.client({ name: 'Late' }).join(code);
  assert.ok(late.state.caption.media);
  assert.equal(late.me().playing, true);
  await env.advance(2000); // 14 s left
  const later = env.client({ name: 'Later' }).join(code);
  assert.deepEqual(later.state.caption, { spectator: true });
  assert.equal(later.me().playing, false);
  submitAll([...players, late], 1);
  // the spectator does not hold the round up
  assert.equal(left(host), 1500);
  await env.advance(1500);
  assert.equal(later.state.phase, 'vote');
  assert.equal(later.state.vote.voters, 3);
  later.send({ t: 'vote', score: 5 });
  assert.equal(later.state.vote.myScore, 5);
});

test('classic: reconnect keeps template and text, the host role moves on after the grace time', async () => {
  const { code, players, host } = await env.room(3);
  await env.start(host);
  const [, ben] = players;
  ben.send({ t: 'draft', captions: caption('half a joke') });
  const media = ben.state.caption.media.id;
  ben.drop();
  await env.advance(3000);
  assert.equal(host.state.players.find((p) => p.id === ben.pid).connected, false);
  ben.join(code);
  assert.equal(ben.state.caption.media.id, media);
  assert.equal(ben.state.caption.captions[0].text, 'half a joke');

  host.drop();
  await env.advance(11_999);
  assert.equal(ben.state.hostId, host.pid);
  await env.advance(1);
  assert.equal(ben.state.hostId, ben.pid);

  // kick: the player is gone and cannot come back
  ben.send({ t: 'kick', pid: players[2].pid });
  assert.deepEqual(players[2].take('kicked').length, 1);
  assert.equal(ben.state.players.some((p) => p.id === players[2].pid), false);
  players[2].join(code);
  assert.deepEqual(players[2].errors(), ['kicked']);
});

test('classic: a tie stays a shared win in the saved results', async () => {
  const a = env.account('tie_ann');
  const b = env.account('tie_ben');
  const room = env.game.createRoom({ game: 'classic' });
  const ann = env.client({ account: a }).join(room.code);
  await env.advance(5);
  const ben = env.client({ account: b }).join(room.code);
  await env.advance(5);
  const cleo = env.client({ name: 'Cleo' }).join(room.code);
  ann.send({ t: 'settings', settings: { ...ann.state.settings, rounds: 1 } });
  await env.start(ann);
  const players = [ann, ben, cleo];
  submitAll(players, 1);
  await env.advance(1500);
  await voteAll(players, (voter, author) => (author === cleo ? 1 : 4));
  assert.equal(ann.state.phase, 'scores');
  assert.deepEqual(ann.state.players.map((p) => p.score), [8, 8, 2]);
  await env.advance(12_000);
  assert.equal(ann.state.phase, 'final');
  await flush();
  const rows = env.db.all('SELECT user_id, points, won, rounds, round_wins, memes, votes, players FROM game_results WHERE user_id IN (?, ?) ORDER BY user_id', a.id, b.id);
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [
      { user_id: a.id, points: 8, won: 1, rounds: 1, round_wins: rows[0].round_wins, memes: 1, votes: 2, players: 3 },
      { user_id: b.id, points: 8, won: 1, rounds: 1, round_wins: rows[1].round_wins, memes: 1, votes: 2, players: 3 },
    ],
  );
  // exactly one of the two tied memes is the round winner and goes to the gallery
  assert.equal(rows[0].round_wins + rows[1].round_wins, 1);
  assert.equal(env.db.get('SELECT COUNT(*) AS n FROM memes WHERE user_id IN (?, ?)', a.id, b.id).n, 1);
});

test('classic: public rooms start by themselves and restart after the final', async () => {
  const room = env.game.createRoom({ game: 'classic', isPublic: true });
  assert.equal(room.settings.maxPlayers, 8);
  const a = env.client();
  const b = env.client();
  env.game.reserveSeat(room, a.pid);
  env.game.reserveSeat(room, b.pid);
  a.join(room.code);
  b.join(room.code);
  assert.equal(a.state.hostId, null);
  assert.equal(left(a), 3500);
  // nobody is host: settings and skip are ignored
  a.send({ t: 'settings', settings: { ...a.state.settings, rounds: 1 } });
  assert.equal(a.state.settings.rounds, 3);
  await env.advance(3500);
  await flush();
  assert.equal(a.state.phase, 'caption');
  assert.equal(env.game.findPublicRoom('classic'), room);
  for (let round = 1; round <= 3; round++) {
    submitAll([a, b], round);
    await env.advance(1500);
    await voteAll([a, b], () => 3);
    assert.equal(a.state.phase, 'scores');
    await env.advance(12_000);
  }
  assert.equal(a.state.phase, 'final');
  assert.equal(left(a), 20_000);
  await env.advance(20_000);
  assert.equal(a.state.phase, 'lobby');
  await env.advance(3500);
  await flush();
  assert.equal(a.state.phase, 'caption');
  assert.equal(a.state.round, 1);
});
