// Regression tests for defects found while play-testing the merged game modes
// with simulated players (full games, hostile clients, people who come and go).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { caption, flush, setupGame } from './game-harness.js';

let env;
before(async () => {
  env = await setupGame();
});
after(() => env.shutdown());

/** everybody rates the meme on screen, then the reveal */
async function rate(players, score = 3) {
  for (const p of players) if (!p.state.vote.isMine) p.send({ t: 'vote', score });
  await env.advance(900);
}

/** answers to a report: stored ("reported"), refused (error code) or nothing at all */
async function report(client, msg) {
  client.take('reported');
  client.errors();
  client.send({ t: 'report', ...msg });
  // the report is written to the database before the answer comes
  await flush(40);
  return client.take('reported').length + client.errors().length;
}

test('a report cannot be used to ask who made a meme while the vote runs', async () => {
  const { players, host } = await env.room(4, { game: 'classic', settings: { rounds: 2 } });
  await env.start(host);
  for (const p of players) p.send({ t: 'submit', captions: caption(p.name) });
  await env.advance(1500);
  assert.equal(host.state.phase, 'vote');
  const author = players.find((p) => p.state.vote.isMine);
  const spy = players.find((p) => p !== author);
  await rate(players);
  assert.equal(host.state.vote.stage, 'reveal');
  // the first meme was shown with its points: asking for "the meme of player X" stays unanswered for everybody
  for (const p of players) {
    if (p === spy) continue;
    assert.equal(await report(spy, { target: 'result', pid: p.pid, reason: 'meme' }), 0, `no answer for ${p === author ? 'the author' : 'somebody else'}`);
  }
  assert.equal(env.db.all('SELECT id FROM reports WHERE reporter_pid = ?', spy.pid).length, 0);
  // the meme on screen can be reported as before - without a name
  assert.equal(await report(spy, { target: 'vote', reason: 'meme' }), 1);

  // with the scores the authors are public and their memes can be reported by name
  await env.advance(3500);
  while (host.state.phase === 'vote') {
    await rate(players);
    await env.advance(3500);
  }
  assert.equal(host.state.phase, 'scores');
  const other = players.find((p) => p !== spy && p !== author);
  assert.equal(await report(spy, { target: 'result', pid: other.pid, reason: 'meme' }), 1);
  assert.equal(env.db.all('SELECT id FROM reports WHERE reporter_pid = ? AND target_pid = ?', spy.pid, other.pid).length, 1);

  // in the next round the finished round stays reportable, the running one is closed again
  await env.advance(12_000);
  assert.equal(host.state.phase, 'caption');
  for (const p of players) p.send({ t: 'submit', captions: caption(p.name) });
  await env.advance(1500);
  await rate(players);
  const second = players.find((p) => p.state.vote.isMine);
  const watcher = players.find((p) => p !== second && p !== spy);
  assert.equal(await report(watcher, { target: 'result', pid: second.pid, reason: 'meme' }), 0);
  assert.equal(await report(watcher, { target: 'result', round: 1, pid: second.pid, reason: 'meme' }), 1);
});

test('pacing: skipping the caption phase makes nobody away - only a clock that ran out does', async () => {
  const { players, host } = await env.room(3, { game: 'same', channel: 'beta', settings: { rounds: 2, captionTime: 30 } });
  const [ann, ben, cleo] = players;
  await env.start(host);
  await env.advance(3000);
  ann.send({ t: 'submit', captions: caption('quick') });
  // the host does not want to wait: Ben and Cleo had three seconds, that says nothing about them
  ann.send({ t: 'skip' });
  await flush();
  assert.equal(ann.state.phase, 'vote');
  assert.deepEqual(ann.state.players.map((p) => p.away), [false, false, false]);
  // so the vote still waits for both of them
  ben.send({ t: 'vote', score: 4 });
  await env.advance(900);
  assert.equal(ann.state.vote.stage, 'rating');
  cleo.send({ t: 'vote', score: 4 });
  await env.advance(900);
  assert.equal(ann.state.vote.stage, 'reveal');

  // next round: the full clock runs out on a silent Cleo - that still counts
  await env.advance(3500 + 12_000);
  assert.equal(ann.state.phase, 'caption');
  ann.send({ t: 'submit', captions: caption('a') });
  ben.send({ t: 'submit', captions: caption('b') });
  await env.advance(30_000);
  assert.equal(ann.state.phase, 'vote');
  assert.deepEqual(ann.state.players.map((p) => p.away), [false, false, true]);
});

test('a client that keeps saying hello under new ids cannot grow a room without end', async () => {
  const { players, host, code } = await env.room(3, { game: 'classic', settings: { rounds: 2 } });
  const [ann, ben, eve] = players;
  await env.start(host);
  for (const p of players) p.send({ t: 'submit', captions: caption(p.name) });
  await env.advance(1500);
  while (ann.state.phase === 'vote') {
    await rate(players, 5);
    await env.advance(3500);
  }
  assert.equal(ann.state.phase, 'scores');
  assert.ok(ann.state.players.find((p) => p.id === ben.pid).score > 0);
  // Ben loses the connection for good: his seat and his points stay until the game is over
  ben.drop();
  const limit = ann.state.settings.maxPlayers + 32;
  for (let i = 0; i < 400; i++) {
    eve.send({ t: 'hello', code, pid: `stranger-${String(i).padStart(4, '0')}`, secret: 'secret-of-a-stranger-0123456789', name: `S${i}`, avatar: 'cat|1' });
    assert.ok(ann.state.players.length <= limit, `${ann.state.players.length} seats after ${i + 1} hellos`);
  }
  assert.ok(JSON.stringify(ann.wire).length < 16_000, 'the state stays small');
  const seats = ann.state.players;
  assert.ok(seats.find((p) => p.id === ben.pid).score > 0, 'a seat with points is never given up');
  assert.equal(seats.find((p) => p.id === eve.pid).connected, false);
  assert.ok(seats.find((p) => p.id === eve.pid).score > 0);
  // real players still get in, and come back to the seat they had
  const dan = env.client({ name: 'Dan' }).join(code);
  assert.deepEqual(dan.errors(), []);
  assert.equal(dan.me().connected, true);
  ben.join(code);
  assert.deepEqual(ben.errors(), []);
  assert.ok(ben.me().score > 0);
});

test('swap: a report about a picture reaches whoever brought it, also after they left', async () => {
  env.search();
  const { players, host } = await env.room(3, { game: 'swap', settings: { rounds: 1 } });
  const [ann, ben, cleo] = players;
  await env.start(host);
  const brought = new Map();
  for (const [i, p] of players.entries()) {
    await env.advance(700);
    p.send({ t: 'swap_search', q: 'cats' });
    await flush();
    const [res] = p.take('swap_results').slice(-1);
    p.send({ t: 'swap_pick', id: res.items[i].id });
    brought.set(p, res.items[i].id);
  }
  await env.advance(2500);
  assert.equal(ann.state.phase, 'caption');
  // Ann takes Cleo's picture, then Cleo leaves the room
  ann.send({ t: 'pick', id: ann.state.caption.hand.find((tile) => tile.media.id === brought.get(cleo)).id });
  assert.equal(ann.state.caption.media.id, brought.get(cleo));
  cleo.send({ t: 'leave' });
  ann.send({ t: 'submit', captions: caption('made with the picture of somebody who left') });
  ben.send({ t: 'submit', captions: caption('ben') });
  await env.advance(1500);
  assert.equal(ann.state.phase, 'vote');
  if (!ann.state.vote.isMine) {
    ann.send({ t: 'vote', score: 3 });
    await env.advance(900 + 3500);
  }
  assert.equal(ann.state.vote.isMine, true);
  // Ben finds the picture offensive: that is not Ann's doing
  assert.equal(await report(ben, { target: 'vote', reason: 'upload' }), 1);
  assert.equal(await report(ben, { target: 'vote', reason: 'meme' }), 1);
  const rows = env.db.all('SELECT target_pid, target_name, reason FROM reports WHERE reporter_pid = ? ORDER BY id', ben.pid);
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { target_pid: cleo.pid, target_name: cleo.name, reason: 'upload' },
    { target_pid: ann.pid, target_name: ann.name, reason: 'meme' },
  ]);
  // no picture bonus for somebody who is gone, and nothing in the answers names anybody
  ben.send({ t: 'vote', score: 5 });
  await env.advance(900 + 3500);
  while (ann.state.phase === 'vote') {
    await rate([ann, ben], 5);
    await env.advance(3500);
  }
  assert.equal(ann.state.phase, 'scores');
  assert.equal(ann.state.results.find((r) => r.pid === ann.pid).assist, null);
  assert.deepEqual(ben.errors(), []);
});
