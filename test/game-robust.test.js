// Things that go wrong in real rooms: lost connections in every phase, players
// who leave in the middle of a round, and the size of what is sent around.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { caption, flush, hits, setupGame } from './game-harness.js';

let env;
before(async () => {
  env = await setupGame({ HUNT_SEARCHES: '2' });
});
after(() => env.shutdown());

async function bring(client, q, index = 0) {
  await env.advance(700);
  client.send({ t: 'swap_search', q });
  await flush();
  const [res] = client.take('swap_results').slice(-1);
  client.send({ t: 'swap_pick', id: res.items[index].id });
  return res.items[index].id;
}

/** connection lost and back a moment later */
async function reconnect(client, code) {
  client.drop();
  await env.advance(2000);
  client.join(code);
  assert.deepEqual(client.errors(), []);
}

test('swap: a lost connection in any phase brings back picture, choice, text and vote', async () => {
  env.search();
  const { code, players, host } = await env.room(3, { game: 'swap', settings: { rounds: 1 } });
  const [ann, ben, cleo] = players;
  await env.start(host);

  // bring
  const mine = await bring(ben, 'cats', 1);
  await reconnect(ben, code);
  assert.equal(ben.state.phase, 'upload');
  assert.equal(ben.state.upload.mine.media.id, mine);
  assert.equal(ben.state.upload.mine.source, 'search');
  assert.equal(ben.state.upload.searchesLeft, 5);
  await bring(ann, 'dogs');
  await bring(cleo, 'birds');
  await env.advance(2500);

  // caption: the tray, the tile that was picked and the text
  assert.equal(ben.state.phase, 'caption');
  const hand = ben.state.caption.hand;
  assert.equal(hand.length, 2);
  ben.send({ t: 'pick', id: hand[1].id });
  ben.send({ t: 'draft', captions: caption('typed before the tunnel') });
  await reconnect(ben, code);
  assert.deepEqual(ben.state.caption.hand, hand);
  assert.equal(ben.state.caption.pickedId, hand[1].id);
  assert.equal(ben.state.caption.media.id, hand[1].media.id);
  assert.equal(ben.state.caption.captions[0].text, 'typed before the tunnel');
  assert.equal(ben.state.caption.submitted, false);
  ben.send({ t: 'submit', captions: caption('by Ben') });
  await reconnect(ben, code);
  assert.equal(ben.state.caption.submitted, true);
  assert.equal(ben.state.caption.captions[0].text, 'by Ben');
  for (const p of [ann, cleo]) p.send({ t: 'submit', captions: caption(`by ${p.name}`) });
  await env.advance(1500);

  // vote: the own vote is still there, the meme stays anonymous
  assert.equal(host.state.phase, 'vote');
  for (let i = 0; i < 3; i++) {
    const author = players.find((p) => p.state.vote.isMine);
    const voter = players.find((p) => p !== author);
    voter.send({ t: 'vote', score: 4 });
    await reconnect(voter, code);
    assert.equal(voter.state.vote.myScore, 4);
    assert.equal(voter.state.vote.isMine, false);
    assert.equal(voter.state.vote.votes, 1);
    for (const p of players) if (p !== author && p !== voter) p.send({ t: 'vote', score: 5 });
    await env.advance(900);
    assert.equal(voter.state.vote.stage, 'reveal');
    await reconnect(voter, code);
    assert.equal(voter.state.vote.stage, 'reveal');
    assert.equal(voter.state.vote.points, 9);
    await env.advance(3500);
  }

  // scores and final
  assert.equal(host.state.phase, 'scores');
  await reconnect(cleo, code);
  assert.equal(cleo.state.results.length, 3);
  assert.deepEqual(cleo.state.players.map((p) => p.score), host.state.players.map((p) => p.score));
  await env.advance(12_000);
  assert.equal(host.state.phase, 'final');
  await reconnect(cleo, code);
  assert.deepEqual(cleo.state.final, host.state.final);
  assert.equal(cleo.state.final.ranking.length, 3);
});

test('swap: who leaves while captioning takes the meme along - the picture stays, the bonus is gone', async () => {
  env.search();
  const { players, host } = await env.room(4, { game: 'swap', settings: { rounds: 1 } });
  const [ann, ben, cleo, dora] = players;
  await env.start(host);
  const brought = {};
  for (const [i, p] of players.entries()) brought[p.pid] = await bring(p, `topic ${i}`, i);
  await env.advance(2500);
  assert.equal(host.state.phase, 'caption');

  // somebody holds Dora's picture; Dora leaves, Cleo is kicked
  const holder = [ann, ben].find((p) => p.state.caption.hand.some((tile) => tile.media.id === brought[dora.pid]));
  assert.ok(holder, 'with four players every picture goes to two others');
  holder.send({ t: 'pick', id: holder.state.caption.hand.find((tile) => tile.media.id === brought[dora.pid]).id });
  dora.send({ t: 'submit', captions: caption('gone in a second') });
  dora.send({ t: 'leave' });
  ann.send({ t: 'kick', pid: cleo.pid });
  assert.deepEqual(host.state.players.map((p) => p.id), [ann.pid, ben.pid]);
  assert.equal(holder.state.caption.media.id, brought[dora.pid], 'the picture stays with whoever got it');
  for (const p of [ann, ben]) p.send({ t: 'submit', captions: caption(`by ${p.name}`) });
  await env.advance(1500);

  // only the memes of the two who stayed are voted on
  assert.equal(host.state.vote.total, 2);
  for (let i = 0; i < 2; i++) {
    for (const p of [ann, ben]) if (!p.state.vote.isMine) p.send({ t: 'vote', score: 5 });
    await env.advance(900 + 3500);
  }
  assert.equal(host.state.phase, 'scores');
  const result = host.state.results.find((r) => r.pid === holder.pid);
  assert.equal(result.from, dora.pid);
  assert.equal(result.assist, null, 'no bonus for somebody who is not in the room any more');
  assert.equal(host.state.players.reduce((sum, p) => sum + p.score, 0), 10 + host.state.results.reduce((sum, r) => sum + (r.assist?.points || 0), 0));
  assert.ok(host.state.leftover.every((l) => l.pid === ann.pid || l.pid === ben.pid));
});

test('hunt: leaving, kicking and a new host in the middle of a round', async () => {
  env.search();
  const { code, players, host } = await env.room(4, { game: 'hunt', settings: { rounds: 1 } });
  const [ann, ben, cleo, dora] = players;
  await env.start(host);
  for (const p of players) {
    p.send({ t: 'search', q: `gif of ${p.name}` });
    await flush();
  }
  for (const p of [ben, cleo, dora]) p.send({ t: 'submit', captions: caption(`by ${p.name}`) });
  // the host leaves: the next player takes over, the round goes on for the three who are done
  ann.send({ t: 'leave' });
  assert.equal(ben.state.hostId, ben.pid);
  assert.equal(ben.state.deadline - env.now(), 1500);
  await env.advance(1500);
  assert.equal(ben.state.phase, 'vote');
  assert.equal(ben.state.vote.total, 3);

  // somebody joins while the memes are rated: watches and votes like everybody else
  const guest = env.client({ name: 'Guest' }).join(code);
  assert.equal(guest.state.phase, 'vote');
  assert.equal(guest.state.vote.isMine, false);
  assert.equal(guest.state.vote.meme.query, null);

  // the author of the meme on screen is kicked: the meme is still rated, the points go nowhere
  const author = [ben, cleo, dora].find((p) => p.state.vote.isMine);
  const kicker = author === ben ? null : ben;
  if (kicker) {
    kicker.send({ t: 'kick', pid: author.pid });
    assert.equal(author.take('kicked').length, 1);
  } else {
    ben.send({ t: 'kick', pid: cleo.pid });
  }
  const here = () => [ben, cleo, dora, guest].filter((p) => ben.state.players.some((row) => row.id === p.pid));
  for (let i = 0; i < 3; i++) {
    for (const p of here()) if (!p.state.vote.isMine) p.send({ t: 'vote', score: 4 });
    await env.advance(900);
    assert.equal(ben.state.vote.stage, 'reveal');
    assert.ok(ben.state.vote.meme.query, 'the search term comes with the reveal');
    await env.advance(3500);
  }
  assert.equal(ben.state.phase, 'scores');
  assert.equal(ben.state.results.length, 3);
  await env.advance(12_000);
  assert.equal(ben.state.phase, 'final');
  assert.ok(ben.state.final.ranking.every((r) => here().some((p) => p.pid === r.pid)));
});

test('the state stays small: a full tray is sent once per connection, sixteen players', async () => {
  env.search((q) => hits(q, 40));
  const { code, players, host } = await env.room(1, { game: 'hunt', settings: { maxPlayers: 16, searches: 4, rounds: 1 } });
  for (let i = 1; i < 16; i++) players.push(env.client({ name: `Player number ${i}` }).join(code));
  await env.start(host);
  assert.equal(host.state.players.length, 16);
  // the largest tray somebody can collect: four searches and the lucky hand
  for (let i = 0; i < 4; i++) {
    host.send({ t: 'search', q: `a rather long search term ${i}` });
    await flush();
  }
  host.send({ t: 'search', random: true });
  assert.equal(host.state.caption.hand.length, 20);
  assert.equal(host.wire.caption.hand.length, 20, 'a changed tray is sent');
  const hand = host.state.caption.hand;
  const full = JSON.stringify(host.wire).length;
  assert.ok(full < 16_000, `state with the full tray: ${full} bytes`);

  // picking, typing and whatever the others do: the tray is not sent again, the browser still has it
  host.send({ t: 'draft', captions: Array.from({ length: 6 }, (_, i) => ({ ...caption('x'.repeat(140))[0], y: i * 10 })) });
  host.send({ t: 'pick', id: hand[5].id });
  assert.equal(host.wire.caption.hand, undefined);
  assert.equal(host.wire.caption.handKey, host.state.caption.handKey);
  assert.equal(host.wire.caption.pickedId, hand[5].id);
  assert.deepEqual(host.state.caption.hand, hand);
  players[1].send({ t: 'search', q: 'somebody else' });
  await flush();
  assert.equal(host.wire.caption.hand, undefined);
  assert.deepEqual(host.state.caption.hand, hand);
  const lean = JSON.stringify(host.wire).length;
  assert.ok(lean < 6500, `state without the tray: ${lean} bytes`);

  // a second tab and a new connection get the whole tray again
  const tab = env.client({ pid: host.pid });
  tab.secret = host.secret;
  tab.join(code);
  assert.deepEqual(tab.wire.caption.hand, hand);
  assert.equal(host.wire.caption.hand, undefined);
  tab.drop();
  host.drop();
  await env.advance(1000);
  host.join(code);
  assert.deepEqual(host.wire.caption.hand, hand);
  assert.equal(host.state.caption.pickedId, hand[5].id);

  // everybody else gets nothing of that tray
  const other = JSON.stringify(players[2].wire);
  assert.ok(other.length < 6000, `state of another player: ${other.length} bytes`);
  assert.equal(other.includes('a rather long search term'), false);
  // ... and is not told about searches and picks of a player who already had a GIF
  const before = players[2].msgs.filter((m) => m.t === 'state').length;
  host.send({ t: 'pick', id: hand[0].id });
  assert.equal(players[2].msgs.filter((m) => m.t === 'state').length, before);

  // a broken file changes the tray: it is sent again
  host.send({ t: 'broken', id: host.state.caption.media.id });
  assert.equal(host.wire.caption.hand.length, 20);
  assert.notEqual(host.wire.caption.handKey, tab.wire.caption.handKey);
});

test('a tray of an earlier game is never shown again', async () => {
  env.search((q) => hits(q, 40));
  const { players, host } = await env.room(2, { game: 'hunt', settings: { rounds: 1 } });
  const keys = new Set();
  for (let game = 0; game < 2; game++) {
    await env.start(host);
    host.send({ t: 'search', q: `game ${game}` });
    await flush();
    // same round number, same tile numbers - but another tray
    assert.equal(host.wire.caption.hand.length, 4);
    assert.deepEqual(host.state.caption.hand.map((tile) => tile.id), ['1', '2', '3', '4']);
    assert.ok(host.state.caption.hand.every((tile) => tile.q === `game ${game}`));
    keys.add(host.state.caption.handKey);
    players[1].send({ t: 'search', random: true });
    for (const p of players) p.send({ t: 'submit', captions: caption('x') });
    await env.advance(1500 + 2 * (12_000 + 3500) + 12_000);
    assert.equal(host.state.phase, 'final');
    host.send({ t: 'again' });
    assert.equal(host.state.phase, 'lobby');
  }
  assert.equal(keys.size, 2);
});
