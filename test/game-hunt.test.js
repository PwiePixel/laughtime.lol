// GIF Hunt v2: every search deals a hand, the first tile is picked, nothing is overwritten.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { caption, flush, hits, setupGame } from './game-harness.js';

let env;
before(async () => {
  env = await setupGame();
});

const left = (c) => c.state.deadline - env.now();
const states = (c) => c.msgs.filter((m) => m.t === 'state').length;

async function searchFor(client, q) {
  client.send({ t: 'search', q });
  await flush();
}

test('hunt: a search deals four tiles and picks the first, a second search keeps the first hand', async () => {
  const calls = env.search();
  const { players, host } = await env.room(3, { game: 'hunt' });
  const [ann, ben] = players;
  await env.start(host);
  for (const p of players) {
    assert.equal(p.state.phase, 'caption');
    assert.equal(left(p), 90_000);
    assert.equal(p.state.caption.media, null);
    assert.deepEqual(p.state.caption.hand, []);
    assert.equal(p.state.caption.pickedId, null);
    const { ideas, ...hunt } = p.state.caption.hunt;
    assert.deepEqual(hunt, { searchesLeft: 2, max: 2, query: '', searching: false, luckyLeft: 1 });
    assert.equal(ideas.length, 3);
    assert.equal(new Set(ideas).size, 3);
    assert.deepEqual(ideas, host.state.caption.hunt.ideas);
    assert.deepEqual(p.state.players.map((row) => row.step), ['search', 'search', 'search']);
  }

  ann.send({ t: 'search', q: '  cats ' });
  assert.equal(ann.state.caption.hunt.searching, true);
  ann.send({ t: 'search', q: 'cats again' }); // still searching: ignored
  await flush();
  assert.deepEqual(calls, ['cats']);
  let cap = ann.state.caption;
  assert.equal(cap.hand.length, 4);
  assert.equal(cap.pickedId, cap.hand[0].id);
  assert.equal(cap.media.id, cap.hand[0].media.id);
  assert.deepEqual(cap.hunt.searchesLeft, 1);
  assert.equal(cap.hunt.query, 'cats');
  assert.equal(cap.hunt.searching, false);
  assert.equal(cap.draftVersion, 1);
  for (const tile of cap.hand) {
    assert.equal(tile.q, 'cats');
    assert.match(tile.media.id, /^test:cats:(\d|1[0-5])$/); // one of the 16 best hits
    assert.match(tile.media.thumb, /^\/api\/media\?u=/);
    assert.equal(typeof tile.id, 'string');
    assert.equal('from' in tile, false);
  }
  assert.equal(new Set(cap.hand.map((t) => t.media.id)).size, 4);
  // the others only see that Ann has something to caption now
  assert.deepEqual(ben.state.players.map((row) => row.step), ['write', 'search', 'search']);
  assert.deepEqual(ben.state.caption.hand, []);
  assert.equal(JSON.stringify(ben.state).includes('cats'), false);

  // typed text survives the next search; the first hand stays in the tray
  ann.send({ t: 'draft', captions: caption('when the food bowl is empty') });
  const benStates = states(ben);
  const firstHand = cap.hand.map((t) => t.id);
  await searchFor(ann, 'dogs');
  cap = ann.state.caption;
  assert.equal(cap.hand.length, 8);
  assert.deepEqual(cap.hand.slice(0, 4).map((t) => t.id), firstHand);
  assert.equal(cap.pickedId, cap.hand[4].id);
  assert.equal(cap.media.id, cap.hand[4].media.id);
  assert.equal(cap.hunt.query, 'dogs');
  assert.equal(cap.hunt.searchesLeft, 0);
  assert.equal(cap.captions[0].text, 'when the food bowl is empty');
  assert.equal(cap.draftVersion, 2);
  assert.equal(states(ben), benStates, 'a tray change is nobody else\'s business');

  // pick: back to a tile of the first search
  ann.send({ t: 'pick', id: firstHand[1] });
  cap = ann.state.caption;
  assert.equal(cap.pickedId, firstHand[1]);
  assert.equal(cap.media.id, cap.hand[1].media.id);
  assert.equal(cap.hunt.query, 'cats');
  assert.equal(cap.captions[0].text, 'when the food bowl is empty');
  assert.equal(cap.draftVersion, 3);
  assert.equal(states(ben), benStates);
  // picking the picked tile again changes nothing
  const annStates = states(ann);
  ann.send({ t: 'pick', id: firstHand[1] });
  assert.equal(states(ann), annStates);
  // foreign and malformed ids
  ann.send({ t: 'pick', id: '999' }).send({ t: 'pick', id: 'x'.repeat(17) }).send({ t: 'pick', id: 2 }).send({ t: 'pick' });
  assert.deepEqual(ann.errors(), ['item_expired', 'item_expired', 'item_expired', 'item_expired']);
  assert.equal(ann.state.caption.pickedId, firstHand[1]);
  ben.send({ t: 'pick', id: firstHand[0] }); // a tile of somebody else's tray
  assert.deepEqual(ben.errors(), ['item_expired']);

  // no searches left - the lucky hand is still free, once
  await searchFor(ann, 'birds');
  assert.deepEqual(ann.errors(), ['no_searches_left']);
  ann.send({ t: 'search', random: true });
  cap = ann.state.caption;
  assert.equal(cap.hand.length, 12);
  assert.equal(cap.pickedId, cap.hand[8].id);
  assert.equal(cap.hunt.query, '');
  assert.equal(cap.hunt.luckyLeft, 0);
  assert.equal(cap.hunt.searchesLeft, 0);
  assert.deepEqual(cap.hand.slice(8).map((t) => t.q), ['', '', '', '']);
  assert.equal(new Set(cap.hand.map((t) => t.media.id)).size, 12);
  assert.equal(cap.captions[0].text, 'when the food bowl is empty');
  ann.send({ t: 'search', random: true });
  assert.deepEqual(ann.errors(), ['no_lucky_left']);
  assert.deepEqual(calls, ['cats', 'dogs'], 'the lucky hand never calls a provider');

  // a submitted meme cannot change its tile any more
  ann.send({ t: 'pick', id: firstHand[2] });
  ann.send({ t: 'submit', captions: caption('done') });
  const picked = ann.state.caption.pickedId;
  ann.send({ t: 'pick', id: firstHand[0] });
  assert.equal(ann.state.caption.pickedId, picked);
  assert.deepEqual(ben.state.players.map((row) => row.step), ['done', 'search', 'search']);
});

test('hunt: a search without a hit is free, the number of attempts is limited', async () => {
  const calls = env.search((q) => (q.startsWith('void') ? [] : hits(q, 3)));
  const { players, host } = await env.room(2, { game: 'hunt' });
  const [ann] = players;
  await env.start(host);
  ann.send({ t: 'search', q: 'x' });
  ann.send({ t: 'search', q: 'porn pictures' });
  ann.send({ t: 'submit', captions: caption('no gif yet') });
  assert.deepEqual(ann.errors(), ['search_short', 'search_blocked', 'search_first']);
  for (let i = 0; i < 11; i++) {
    await searchFor(ann, `void ${i}`);
    assert.deepEqual(ann.errors(), ['search_empty']);
    assert.equal(ann.state.caption.hunt.searchesLeft, 2);
    assert.equal(ann.state.caption.hunt.searching, false);
    assert.equal(ann.state.caption.media, null);
  }
  // only three hits: a small hand
  await searchFor(ann, 'rare');
  assert.equal(ann.state.caption.hand.length, 3);
  assert.equal(ann.state.caption.hunt.searchesLeft, 1);
  // 12 attempts are used up: no more provider calls this round
  await searchFor(ann, 'more');
  assert.deepEqual(ann.errors(), ['search_limit']);
  assert.equal(calls.length, 12);
  // the same hits again: nothing new to deal -> free as well (not reachable any more, the limit comes first)
  assert.equal(ann.state.caption.hunt.searchesLeft, 1);
});

test('hunt: the search term is hidden while rating and shown with the reveal', async () => {
  env.search();
  const { players, host } = await env.room(3, { game: 'hunt', settings: { rounds: 1 } });
  const [ann, ben, cleo] = players;
  await env.start(host);
  await searchFor(ann, 'cats');
  await searchFor(ben, 'dogs');
  await searchFor(ben, 'frogs');
  cleo.send({ t: 'search', random: true });
  for (const p of players) p.send({ t: 'submit', captions: caption(`by ${p.name}`) });
  assert.equal(left(host), 1500);
  await env.advance(1500);
  const terms = { [ann.name]: 'cats', [ben.name]: 'frogs', [cleo.name]: null };
  for (let i = 0; i < 3; i++) {
    const author = players.find((p) => p.state.vote.isMine);
    for (const p of players) {
      assert.equal(p.state.vote.stage, 'rating');
      assert.equal(p.state.vote.meme.query, null);
      assert.equal(p.state.vote.dist, null);
      assert.equal(/"(q|query)":"/.test(JSON.stringify(p.state)), false);
      if (p !== author) p.send({ t: 'vote', score: p === players[0] || author === players[0] ? 5 : 2 });
    }
    await env.advance(900);
    for (const p of players) {
      assert.equal(p.state.vote.stage, 'reveal');
      assert.equal(p.state.vote.meme.query, terms[author.name]);
      assert.equal(p.state.vote.dist.reduce((a, b) => a + b, 0), 2);
    }
    await env.advance(3500);
  }
  assert.equal(host.state.phase, 'scores');
  const byPid = Object.fromEntries(host.state.results.map((r) => [r.pid, r]));
  assert.equal(byPid[ann.pid].meme.query, 'cats');
  assert.equal(byPid[ann.pid].searches, 1);
  assert.equal(byPid[ben.pid].meme.query, 'frogs');
  assert.equal(byPid[ben.pid].searches, 2);
  assert.equal(byPid[cleo.pid].meme.query, null);
  assert.equal(byPid[cleo.pid].searches, 0);
  assert.deepEqual(byPid[ann.pid].dist, [0, 0, 0, 0, 2]);
  assert.equal(byPid[ann.pid].assist, null);
  // no state ever contains the server-only ratings
  for (const p of players) assert.equal(JSON.stringify(p.state).includes('ratings'), false);
});

test('hunt: typed text without a GIF still becomes a meme', async () => {
  env.search();
  const { players, host } = await env.room(2, { game: 'hunt', settings: { captionTime: 30 } });
  const [ann, ben] = players;
  await env.start(host);
  await searchFor(ann, 'cats');
  ann.send({ t: 'submit', captions: caption('with gif') });
  ben.send({ t: 'draft', captions: caption('no gif but funny') });
  assert.equal(ben.state.caption.media, null);
  await env.advance(30_000);
  assert.equal(host.state.phase, 'vote');
  assert.equal(host.state.vote.total, 2);
  const mine = ben.state.vote.isMine ? ben.state.vote : null;
  await env.advance(12_000 + 3500);
  const benMeme = mine || ben.state.vote;
  assert.equal(benMeme.isMine, true);
  assert.equal(benMeme.meme.captions[0].text, 'no gif but funny');
  assert.ok(benMeme.meme.media.id);
});

test('hunt: searches per round come from the host setting, otherwise from HUNT_SEARCHES', async () => {
  env.search();
  const custom = await env.room(2, { game: 'hunt', settings: { searches: 4 } });
  assert.equal(custom.host.state.settings.searches, 4);
  await env.start(custom.host);
  assert.equal(custom.host.state.caption.hunt.max, 4);
  assert.equal(custom.host.state.caption.hunt.searchesLeft, 4);
  for (const q of ['a1', 'b2', 'c3', 'd4']) await searchFor(custom.host, q);
  assert.equal(custom.host.state.caption.hand.length, 16);
  assert.equal(custom.host.state.caption.hunt.searchesLeft, 0);

  const standard = await env.room(2, { game: 'hunt' });
  assert.equal(standard.host.state.settings.searches, 0);
  await env.start(standard.host);
  assert.equal(standard.host.state.caption.hunt.max, 2);

  // public rooms have no host: always the server default
  const room = env.game.createRoom({ game: 'hunt', isPublic: true });
  const a = env.client().join(room.code);
  const b = env.client().join(room.code);
  a.send({ t: 'settings', settings: { ...a.state.settings, searches: 4 } });
  assert.equal(a.state.settings.searches, 0);
  await env.advance(3500);
  await flush();
  assert.equal(b.state.phase, 'caption');
  assert.equal(b.state.caption.hunt.max, 2);
  assert.equal(b.state.settings.mode, 'videos');
});

test('hunt: the tray never grows beyond its limit and never loses the picked tile', async () => {
  env.search((q) => hits(q, 40));
  const { host } = await env.room(2, { game: 'hunt', settings: { searches: 4, rounds: 1 } });
  await env.start(host);
  for (const q of ['one', 'two', 'three', 'four']) await searchFor(host, q);
  host.send({ t: 'search', random: true });
  assert.equal(host.state.caption.hand.length, 20);
  // broken files bring in spare hits: the picked tile is replaced in place
  host.send({ t: 'pick', id: host.state.caption.hand[13].id });
  for (let i = 0; i < 4; i++) {
    const before = host.state.caption;
    host.send({ t: 'broken', id: before.media.id });
    const after = host.state.caption;
    assert.equal(after.hand.length, 20);
    assert.notEqual(after.media.id, before.media.id);
    assert.equal(after.pickedId, after.hand[13].id);
    assert.equal(after.hand[13].q, 'four');
    assert.equal(after.hunt.query, 'four');
    assert.equal(after.hunt.searchesLeft, 0);
    assert.equal(new Set(after.hand.map((t) => t.media.id)).size, 20);
  }
  // four free replacements per round, then the tile stays
  const stuck = host.state.caption.media.id;
  host.send({ t: 'broken', id: stuck });
  assert.equal(host.state.caption.media.id, stuck);
});

test('hunt: broken files without spare hits fall back to another tile, then to the pool', async () => {
  env.search((q) => hits(q, 2));
  const { host } = await env.room(2, { game: 'hunt' });
  await env.start(host);
  await searchFor(host, 'tiny');
  assert.equal(host.state.caption.hand.length, 2);
  const [first, second] = host.state.caption.hand;
  host.send({ t: 'draft', captions: caption('keep me') });
  host.send({ t: 'broken', id: first.media.id });
  assert.deepEqual(host.state.caption.hand.map((t) => t.id), [second.id]);
  assert.equal(host.state.caption.pickedId, second.id);
  host.send({ t: 'broken', id: 'something else' }); // not the picked media: ignored
  assert.equal(host.state.caption.pickedId, second.id);
  host.send({ t: 'broken', id: second.media.id });
  const cap = host.state.caption;
  assert.equal(cap.hand.length, 1);
  assert.equal(cap.hand[0].q, '');
  assert.equal(cap.media.id, cap.hand[0].media.id);
  assert.equal(cap.hunt.query, '');
  assert.equal(cap.captions[0].text, 'keep me');
  assert.equal(cap.hunt.searchesLeft, 1);
});

test('hunt: GIFs of earlier rounds and tiles picked by others are avoided', async () => {
  env.search((q) => hits(q, 20));
  const { players, host } = await env.room(2, { game: 'hunt', settings: { rounds: 2 } });
  const [ann, ben] = players;
  await env.start(host);
  await searchFor(ann, 'cats');
  const annPick = ann.state.caption.media.id;
  // Ben searches the same word: Ann's picked GIF is not dealt to him while fresh ones are left
  await searchFor(ben, 'cats');
  assert.equal(ben.state.caption.hand.some((t) => t.media.id === annPick), false);
  const benPick = ben.state.caption.media.id;
  for (const p of players) p.send({ t: 'submit', captions: caption('x') });
  await env.advance(1500);
  for (let i = 0; i < 2; i++) {
    for (const p of players) p.send({ t: 'vote', score: 3 });
    await env.advance(900 + 3500);
  }
  await env.advance(12_000);
  assert.equal(host.state.round, 2);
  assert.deepEqual(ann.state.caption.hand, []);
  for (const p of players) {
    await searchFor(p, 'cats');
    const dealt = p.state.caption.hand.map((t) => t.media.id);
    assert.equal(dealt.includes(annPick), false);
    assert.equal(dealt.includes(benPick), false);
  }
});

test('hunt: late join plays with at least 30 s left, reconnect restores tray, pick and text', async () => {
  env.search();
  const { code, players, host } = await env.room(2, { game: 'hunt' });
  await env.start(host);
  const [ann] = players;
  await searchFor(ann, 'cats');
  ann.send({ t: 'pick', id: ann.state.caption.hand[2].id });
  ann.send({ t: 'draft', captions: caption('half done') });
  const before = ann.state.caption;
  ann.drop();
  await env.advance(4000);
  ann.join(code);
  assert.deepEqual(ann.state.caption.hand, before.hand);
  assert.equal(ann.state.caption.pickedId, before.pickedId);
  assert.equal(ann.state.caption.media.id, before.media.id);
  assert.equal(ann.state.caption.captions[0].text, 'half done');
  assert.equal(ann.state.caption.hunt.searchesLeft, 1);

  await env.advance(54_000); // 32 s left
  const late = env.client().join(code);
  assert.equal(late.state.caption.hunt.searchesLeft, 2);
  assert.equal(late.state.caption.hunt.luckyLeft, 1);
  assert.equal(late.me().step, 'search');
  await env.advance(3000); // 29 s left
  const later = env.client().join(code);
  assert.deepEqual(later.state.caption, { spectator: true });
  assert.equal(later.me().step, undefined);
  assert.equal(later.me().playing, false);
});

test('hunt: quick play queues exist for public modes only', async () => {
  env.search();
  const a = env.client().open();
  const b = env.client().open();
  a.send({ t: 'queue', game: 'hunt', pid: a.pid, name: 'Qa', avatar: 'cat|1' });
  b.send({ t: 'queue', game: 'hunt', pid: b.pid, name: 'Qb', avatar: 'dog|2' });
  await env.advance(1000);
  const [match] = a.take('matched');
  assert.ok(match?.code);
  assert.equal(b.take('matched')[0].code, match.code);
  assert.equal(env.game.roomInfo(match.code).game, 'hunt');
  assert.equal(env.game.roomInfo(match.code).public, true);
  // private-only and beta modes have no queue: such a request lands in the classic queue
  const c = env.client().open();
  const d = env.client().open();
  c.send({ t: 'queue', game: 'swap', pid: c.pid, name: 'Qc', avatar: 'cat|1' });
  d.send({ t: 'queue', game: 'same', pid: d.pid, name: 'Qd', avatar: 'cat|1' });
  assert.equal(c.take('queue').at(-1).game, 'classic');
  await env.advance(1000);
  const other = c.take('matched')[0];
  assert.equal(env.game.roomInfo(other.code).game, 'classic');
  assert.equal(d.take('matched')[0].code, other.code);
});
