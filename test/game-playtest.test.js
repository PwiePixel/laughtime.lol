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
