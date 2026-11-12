// Hostile and sloppy clients: second hello on one socket, leaving with a second
// tab open, messages that make no sense. Nothing of that may leave a ghost in a
// room, hand out something for free or end up in the error log.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { caption, flush, hits, setupGame } from './game-harness.js';

let env;
const logged = []; // what the server wrote to its error log ("[game] ...")
const realError = console.error;
before(async () => {
  env = await setupGame({ HUNT_SEARCHES: '2' });
  console.error = (...args) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('[')) logged.push(line);
    else realError(...args);
  };
});
after(async () => {
  console.error = realError;
  await env.shutdown();
});

const hello = (client, code, pid = client.pid, secret = client.secret) => client.send({ t: 'hello', code, pid, secret, name: client.name, avatar: 'cat|1' });

test('a socket holds one seat: a second hello gives up the first one', async () => {
  const first = await env.room(3, { game: 'classic', settings: { rounds: 1 } });
  const second = await env.room(1, { game: 'classic' });
  const [ann, ben, cleo] = first.players;
  await env.start(first.host);
  // Ben's socket says hello to another room without closing anything
  hello(ben, second.code);
  await flush();
  assert.equal(ben.state.code, second.code);
  assert.equal(ann.state.players.find((p) => p.id === ben.pid).connected, false);
  // the room is not held up by a player who is no longer there
  ann.send({ t: 'submit', captions: caption('a') });
  cleo.send({ t: 'submit', captions: caption('c') });
  await env.advance(10_200);
  assert.equal(ann.state.caption.submitted, true);
  await env.advance(1500);
  assert.equal(ann.state.phase, 'vote');
  assert.equal(ann.state.vote.voters, 1);
  // closing the socket only touches the seat it has now
  ben.drop();
  await flush();
  assert.equal(second.host.state.players.find((p) => p.id === ben.pid).connected, false);

  // same room, another player id: the old seat is given up as well
  const third = await env.room(2, { game: 'classic' });
  const dan = third.players[1];
  hello(dan, third.code, 'another-player-id', 'another-secret-0123456789');
  await flush();
  assert.deepEqual(third.host.state.players.map((p) => p.connected), [true, false, true]);
  dan.drop();
  await env.advance(12_100);
  // lobby: both seats of that socket are gone, nobody stays behind as "connected"
  assert.deepEqual(third.host.state.players.map((p) => p.id), [third.host.pid]);
  assert.deepEqual(logged, []);
});

test('leave takes every tab of the player out of the room', async () => {
  const { code, players, host } = await env.room(3, { game: 'classic', settings: { rounds: 1 } });
  const [ann, ben, cleo] = players;
  const tab = env.client({ pid: ben.pid, name: ben.name });
  tab.secret = ben.secret;
  tab.join(code);
  await env.start(host);
  for (const p of [ann, cleo]) p.send({ t: 'submit', captions: caption(`by ${p.name}`) });
  ben.send({ t: 'leave' });
  await flush();
  assert.deepEqual(ann.state.players.map((p) => p.id), [ann.pid, cleo.pid]);
  await env.advance(1500);
  assert.equal(ann.state.phase, 'vote');
  // the second tab is not a hidden voter
  tab.take('error');
  tab.send({ t: 'vote', score: 5 }).send({ t: 'react', emoji: 'laugh' });
  await flush();
  assert.deepEqual(tab.errors(), ['not_joined', 'not_joined']);
  assert.equal(ann.state.vote.votes, 0);
  assert.equal(ann.take('react').length, 0);
  // it can come back like anybody else
  tab.drop();
  tab.join(code);
  assert.equal(tab.state.phase, 'vote');
  assert.equal(tab.me().score, 0);
  assert.deepEqual(logged, []);
});

test('hunt: "broken" without a picture gives nothing away', async () => {
  const calls = env.search();
  const { players, host } = await env.room(2, { game: 'hunt', settings: { rounds: 1 } });
  const [ann, ben] = players;
  await env.start(host);
  ann.send({ t: 'broken' }).send({ t: 'broken', noVideo: true }).send({ t: 'broken', id: null });
  await flush();
  assert.equal(ann.state.caption.media, null);
  assert.deepEqual(ann.state.caption.hand, []);
  assert.equal(ann.state.caption.hunt.luckyLeft, 1);
  assert.equal(ann.me().step, 'search');
  // an object is not a search term: no provider call for "[object Object]"
  ann.send({ t: 'search', q: {} }).send({ t: 'search', q: ['cats'] });
  await flush();
  assert.deepEqual(ann.errors(), ['search_short', 'search_short']);
  assert.equal(calls.length, 0);
  // the four free replacements of the round are still there
  ann.send({ t: 'search', q: 'cats' });
  await flush();
  for (let i = 0; i < 4; i++) {
    const before = ann.state.caption.media.id;
    ann.send({ t: 'broken', id: before });
    assert.notEqual(ann.state.caption.media.id, before);
  }
  const last = ann.state.caption.media.id;
  ann.send({ t: 'broken', id: last });
  assert.equal(ann.state.caption.media.id, last);
  assert.equal(calls.length, 1);
  assert.equal(ben.state.caption.hand.length, 0);
  assert.deepEqual(logged, []);
});

test('messages that make no sense are ignored without an entry in the error log', async () => {
  env.search((q) => hits(q, 6, 'image'));
  const { players, host } = await env.room(3, { game: 'swap', settings: { rounds: 1 } });
  const [ann, ben, cleo] = players;
  const trap = { toString: 1, valueOf: 'x' };
  const junk = [
    { t: 'swap_pick', id: trap },
    { t: 'swap_search', q: trap },
    { t: 'kick', pid: trap },
    { t: 'report', pid: trap, reason: trap, comment: trap },
    { t: 'report', target: 'result', round: trap, pid: trap },
    { t: 'profile', name: trap, avatar: trap },
    { t: 'pack', id: trap },
    { t: 'pick', id: trap },
    { t: 'vote', score: trap },
    { t: 'search', q: trap, random: trap },
    { t: 'draft', captions: [{ text: trap, color: trap, x: trap }] },
    { t: 'submit', captions: trap },
    { t: 'broken', id: trap, noVideo: trap },
    { t: 'react', emoji: trap },
    { t: 'settings', settings: { game: trap, rounds: trap } },
    { t: 'queue', game: trap, pid: trap, name: trap },
    { t: 'hello', code: trap, pid: trap, secret: trap },
  ];
  const everything = () => junk.forEach((msg) => ben.send(msg));
  everything();
  await env.start(host);
  everything();
  ben.send({ t: 'swap_search', q: {} });
  assert.equal(ben.errors().pop(), 'search_short');
  for (const p of players) p.send({ t: 'swap_random' });
  await env.advance(2500);
  assert.equal(ann.state.phase, 'caption');
  everything();
  for (const p of players) p.send({ t: 'submit', captions: caption(`by ${p.name}`) });
  await env.advance(1500);
  assert.equal(ann.state.phase, 'vote');
  everything();
  await flush();
  assert.equal(ann.state.vote.votes, 0);
  assert.deepEqual(ann.state.players.map((p) => p.id), [ann.pid, ben.pid, cleo.pid]);
  assert.equal(ben.me().name, ben.name);
  assert.deepEqual(logged, []);
});

test('swap: search results belong to one bring phase', async () => {
  env.search((q) => hits(q, 6, 'image'));
  const { players, host } = await env.room(2, { game: 'swap', settings: { rounds: 2 } });
  const [ann, ben] = players;
  await env.start(host);
  ann.send({ t: 'swap_search', q: 'cats' });
  await flush();
  const [res] = ann.take('swap_results');
  ann.send({ t: 'swap_pick', id: res.items[0].id });
  ben.send({ t: 'swap_random' });
  await env.advance(2500);
  for (const p of players) p.send({ t: 'submit', captions: caption('x') });
  await env.advance(1500);
  while (ann.state.phase === 'vote') {
    for (const p of players) if (!p.state.vote.isMine) p.send({ t: 'vote', score: 3 });
    await env.advance(900 + 3500);
  }
  await env.advance(12_000);
  assert.equal(ann.state.phase, 'upload');
  assert.equal(ann.state.round, 2);
  // the list of round 1 is gone: picking from it would be a search that is not counted
  ann.send({ t: 'swap_pick', id: res.items[1].id });
  assert.deepEqual(ann.errors(), ['item_expired']);
  assert.equal(ann.state.upload.mine, null);
  assert.deepEqual(logged, []);
});
