// Swap v2: bring a picture, get two from other players, pick one, caption it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { caption, flush, hits, setupGame } from './game-harness.js';

let env;
let uploadDir;
before(async () => {
  env = await setupGame();
  ({ UPLOAD_DIR: uploadDir } = await import('../server/uploads.js'));
});

// rooms close when everybody is gone - no uploaded file may survive that
after(() => env.shutdown());

const left = (c) => c.state.deadline - env.now();
const fileOf = (media) => path.join(uploadDir, media.src.replace('/api/uploads/', ''));

/** brings a picture from a search: `bring(client, 'cats', 3)` picks the fourth hit */
async function bring(client, q, index = 0) {
  await env.advance(700); // searches of one player are spaced out by the server
  client.send({ t: 'swap_search', q });
  await flush();
  const [res] = client.take('swap_results').slice(-1);
  client.send({ t: 'swap_pick', id: res.items[index].id });
  return res.items[index].id;
}

async function voteRound(players, score) {
  const total = players[0].state.vote.total;
  const order = [];
  for (let i = 0; i < total; i++) {
    const author = players.find((p) => p.state.vote.isMine);
    order.push({ author, sameAsPrev: players[0].state.vote.sameAsPrev, media: players[0].state.vote.meme.media.id });
    for (const p of players) if (p !== author) p.send({ t: 'vote', score: score(p, author) });
    await env.advance(900);
    await env.advance(3500);
  }
  return order;
}

test('swap: bring with upload, search or surprise - a new choice replaces the old one', async () => {
  env.search();
  const { code, players, host } = await env.room(3, { game: 'swap' });
  const [ann, ben, cleo] = players;
  await env.start(host);
  for (const p of players) {
    assert.equal(p.state.phase, 'upload');
    assert.equal(left(p), 60_000);
    assert.equal(p.state.upload.mine, null);
    assert.equal(p.state.upload.searchesLeft, 6);
    assert.equal(p.state.upload.ideas.length, 3);
    assert.deepEqual(p.state.players.map((row) => row.step), ['bring', 'bring', 'bring']);
    assert.deepEqual(p.state.players.map((row) => row.submitted), [false, false, false]);
  }

  // upload: neutral title, the file exists
  assert.deepEqual(await env.upload(ann, code), { ok: true });
  let mine = ann.state.upload.mine;
  assert.equal(mine.source, 'upload');
  assert.equal(mine.uploaded, true);
  assert.equal(mine.auto, false);
  assert.equal(mine.media.title, 'Upload');
  assert.equal(JSON.stringify(ann.state).includes('secret name'), false);
  const firstFile = fileOf(mine.media);
  assert.ok(fs.existsSync(firstFile));
  assert.deepEqual(ben.state.players.map((row) => row.step), ['done', 'bring', 'bring']);
  assert.equal(ben.state.upload.done, 1);
  assert.equal(ben.state.upload.mine, null);

  // a second upload replaces the first one without clearing: the old file is deleted
  await env.upload(ann, code);
  const secondFile = fileOf(ann.state.upload.mine.media);
  assert.notEqual(secondFile, firstFile);
  await env.until(() => !fs.existsSync(firstFile), 'old upload to be deleted');
  assert.ok(fs.existsSync(secondFile));

  // search + pick, then surprise, then pick again - never a clear in between
  const picked = await bring(ben, 'cats', 2);
  assert.equal(ben.state.upload.mine.source, 'search');
  assert.equal(ben.state.upload.mine.media.id, picked);
  assert.equal(ben.state.upload.searchesLeft, 5);
  ben.send({ t: 'swap_random' });
  assert.equal(ben.state.upload.mine.source, 'random');
  assert.notEqual(ben.state.upload.mine.media.id, picked);
  ben.send({ t: 'swap_pick', id: picked });
  assert.equal(ben.state.upload.mine.source, 'search');
  assert.equal(ben.state.upload.done, 2);
  ben.send({ t: 'swap_pick', id: 'test:unknown:1' });
  assert.deepEqual(ben.errors(), ['item_expired']);

  // old clients still clear first
  ben.send({ t: 'swap_clear' });
  assert.equal(ben.state.upload.mine, null);
  assert.equal(ben.me().step, 'bring');
  ben.send({ t: 'swap_pick', id: picked });

  // an upload replaced by a search result: the file goes away too
  await bring(ann, 'dogs');
  await env.until(() => !fs.existsSync(secondFile), 'replaced upload to be deleted');
  assert.equal(ann.state.upload.mine.uploaded, false);

  // two of three are ready: last call for Cleo - 15 s, but never below half of the 60 s
  assert.equal(host.state.lastCall, true);
  assert.equal(left(host), 30_000 - 1400);
  // everybody is ready -> the swap happens 2.5 s later
  cleo.send({ t: 'swap_random' });
  for (const p of players) {
    assert.equal(p.state.upload.endingSoon, true);
    assert.equal(left(p), 2500);
  }
  await env.advance(2500);
  assert.equal(host.state.phase, 'caption');
  assert.equal(left(host), 90_000);
});

test('swap: at most six searches per player and round', async () => {
  const calls = env.search();
  const { players, host } = await env.room(2, { game: 'swap', settings: { rounds: 2 } });
  const [ann, ben] = players;
  await env.start(host);
  ann.send({ t: 'swap_search', q: 'a' }).send({ t: 'swap_search', q: 'porn' });
  assert.deepEqual(ann.errors(), ['search_short', 'search_blocked']);
  for (let i = 0; i < 6; i++) {
    await env.advance(700);
    ann.send({ t: 'swap_search', q: `term ${i}` });
    ann.send({ t: 'swap_search', q: `too fast ${i}` }); // within 700 ms: dropped, costs nothing
    await flush();
    assert.equal(ann.state.upload.searchesLeft, 5 - i);
    assert.equal(ann.take('swap_results').length, 1);
  }
  await env.advance(700);
  ann.send({ t: 'swap_search', q: 'one more' });
  await flush();
  assert.deepEqual(ann.errors(), ['search_limit']);
  assert.equal(ann.state.upload.searchesLeft, 0);
  assert.equal(calls.length, 6);
  assert.equal(ben.state.upload.searchesLeft, 6);
  // 30 tiles per result, with previews
  env.search((q) => hits(q, 50));
  ben.send({ t: 'swap_search', q: 'many' });
  await flush();
  const [res] = ben.take('swap_results');
  assert.equal(res.items.length, 30);
  assert.match(res.items[0].thumb, /^\/api\/media\?u=/);
  // next round: a fresh budget
  ben.send({ t: 'swap_pick', id: res.items[0].id });
  ann.send({ t: 'swap_random' });
  await env.advance(2500);
  for (const p of players) p.send({ t: 'submit', captions: caption('x') });
  await env.advance(1500);
  await voteRound(players, () => 3);
  await env.advance(12_000);
  assert.equal(ann.state.phase, 'upload');
  assert.equal(ann.state.round, 2);
  assert.equal(ann.state.upload.searchesLeft, 6);
});

test('swap: everybody chooses between the pictures of two others, the bringer stays secret', async () => {
  env.search();
  const { code, players, host } = await env.room(4, { game: 'swap', settings: { rounds: 1 } });
  const [ann, ben, cleo, dora] = players;
  await env.start(host);
  await env.upload(ann, code);
  const brought = { [ann.pid]: ann.state.upload.mine.media.id };
  brought[ben.pid] = await bring(ben, 'cats', 1);
  brought[cleo.pid] = await bring(cleo, 'dogs', 4);
  dora.send({ t: 'swap_random' });
  brought[dora.pid] = dora.state.upload.mine.media.id;
  await env.advance(2500);

  const owner = (mediaId) => Object.keys(brought).find((pid) => brought[pid] === mediaId);
  const offers = new Map();
  for (const p of players) {
    const cap = p.state.caption;
    assert.equal(cap.hand.length, 2);
    assert.equal(cap.pickedId, cap.hand[0].id);
    assert.equal(cap.media.id, cap.hand[0].media.id);
    assert.equal(cap.swapped, true);
    assert.equal(cap.hunt, undefined);
    assert.notEqual(cap.hand[0].media.id, cap.hand[1].media.id);
    for (const tile of cap.hand) {
      assert.notEqual(tile.media.id, brought[p.pid], 'own picture offered');
      assert.equal(tile.q, null);
      assert.equal('from' in tile, false);
      assert.ok(owner(tile.media.id));
      offers.set(tile.media.id, (offers.get(tile.media.id) || 0) + 1);
    }
    // nothing in the caption state names another player
    for (const other of players) assert.equal(JSON.stringify(cap).includes(other.pid), false);
  }
  // every picture went to exactly two players
  assert.deepEqual([...offers.values()], [2, 2, 2, 2]);

  // pick the other option: text stays, nobody else is told
  ann.send({ t: 'draft', captions: caption('typed before choosing') });
  const benStates = ben.msgs.filter((m) => m.t === 'state').length;
  const second = ann.state.caption.hand[1];
  ann.send({ t: 'pick', id: second.id });
  assert.equal(ann.state.caption.pickedId, second.id);
  assert.equal(ann.state.caption.media.id, second.media.id);
  assert.equal(ann.state.caption.captions[0].text, 'typed before choosing');
  assert.equal(ben.msgs.filter((m) => m.t === 'state').length, benStates);

  // everybody rates everything with 5 except Dora, who gives 3
  const choice = {};
  for (const p of players) {
    choice[p.pid] = p.state.caption.media.id;
    p.send({ t: 'submit', captions: caption(`by ${p.name}`) });
  }
  await env.advance(1500);
  assert.equal(host.state.phase, 'vote');
  for (let i = 0; i < 4; i++) {
    const author = players.find((p) => p.state.vote.isMine);
    for (const p of players) {
      // no author, no bringer and no moving score while voting
      const json = JSON.stringify({ vote: p.state.vote, lastCall: p.state.lastCall });
      for (const other of players) assert.equal(json.includes(other.pid), false);
      assert.deepEqual(p.state.players.map((row) => [row.score, row.lastPoints]), [[0, 0], [0, 0], [0, 0], [0, 0]]);
      if (p !== author) p.send({ t: 'vote', score: p === dora ? 3 : 5 });
    }
    await env.advance(900);
    assert.deepEqual(host.state.players.map((row) => row.score), [0, 0, 0, 0]);
    await env.advance(3500);
  }

  // scores: picture bonus = ratings of 4 or 5 that did not come from the bringer
  assert.equal(host.state.phase, 'scores');
  const expected = Object.fromEntries(players.map((p) => [p.pid, 0]));
  for (const r of host.state.results) {
    const author = players.find((p) => p.pid === r.pid);
    const bringer = owner(choice[r.pid]);
    assert.equal(r.from, bringer);
    assert.equal(r.points, author === dora ? 15 : 13, 'points stay the plain sum of the ratings');
    expected[r.pid] += r.points;
    if (bringer === dora.pid) {
      assert.equal(r.assist, null, 'surprise pictures earn nothing');
      continue;
    }
    // voters: everybody but the author; Dora's 3 does not count, the bringer's own vote neither
    const voters = players.filter((p) => p !== author && p.pid !== bringer && p !== dora);
    assert.deepEqual(r.assist, { pid: bringer, points: voters.length });
    expected[bringer] += voters.length;
  }
  for (const p of players) {
    assert.deepEqual(p.state.players.map((row) => row.score), players.map((x) => expected[x.pid]));
    assert.deepEqual(p.state.players.map((row) => row.lastPoints), players.map((x) => expected[x.pid]));
    assert.equal(JSON.stringify(p.state).includes('ratings'), false);
  }
  // pictures nobody used: only brought ones (not the surprise picture), with their bringer
  const usedMedia = new Set(Object.values(choice));
  const shelf = [ann, ben, cleo].filter((p) => !usedMedia.has(brought[p.pid])).map((p) => p.pid).sort();
  assert.deepEqual(host.state.leftover.map((l) => l.pid).sort(), shelf);
  for (const l of host.state.leftover) assert.equal(l.media.id, brought[l.pid]);

  await env.advance(12_000);
  assert.equal(host.state.phase, 'final');
  assert.equal(host.state.final.best[0].from, owner(host.state.final.best[0].meme.media.id));
});

test('swap: memes on the same picture are voted on back to back', async () => {
  env.search();
  const { players, host } = await env.room(3, { game: 'swap', settings: { rounds: 1 } });
  await env.start(host);
  for (const [i, p] of players.entries()) await bring(p, 'cats', i);
  await env.advance(2500);
  // in a ring of three any two players share exactly one option
  const [a, b, c] = players;
  const common = a.state.caption.hand.find((t) => b.state.caption.hand.some((o) => o.media.id === t.media.id)).media.id;
  for (const p of [a, b]) p.send({ t: 'pick', id: p.state.caption.hand.find((t) => t.media.id === common).id });
  c.send({ t: 'pick', id: c.state.caption.hand.find((t) => t.media.id !== common).id });
  for (const p of players) p.send({ t: 'submit', captions: caption(p.name) });
  await env.advance(1500);
  const order = await voteRound(players, () => 4);
  const twins = order.map((o, i) => (o.media === common ? i : -1)).filter((i) => i >= 0);
  assert.equal(twins.length, 2);
  assert.equal(twins[1] - twins[0], 1);
  assert.deepEqual(order.map((o) => o.sameAsPrev), order.map((o, i) => i === twins[1]));
});

test('swap: two players get the picture of the other one, no bonus possible', async () => {
  env.search();
  const { players, host } = await env.room(2, { game: 'swap', settings: { rounds: 1 } });
  const [ann, ben] = players;
  await env.start(host);
  const fromAnn = await bring(ann, 'cats');
  const fromBen = await bring(ben, 'dogs');
  await env.advance(2500);
  assert.deepEqual(ann.state.caption.hand.map((t) => t.media.id), [fromBen]);
  assert.deepEqual(ben.state.caption.hand.map((t) => t.media.id), [fromAnn]);
  for (const p of players) p.send({ t: 'submit', captions: caption(p.name) });
  await env.advance(1500);
  await voteRound(players, () => 5);
  assert.deepEqual(host.state.results.map((r) => r.assist.points), [0, 0]);
  assert.deepEqual(host.state.players.map((row) => row.score), [5, 5]);
  assert.deepEqual(host.state.leftover, []);
});

test('swap: who brings nothing has no picture in the deal; alone you caption a template', async () => {
  env.search();
  const { players, host } = await env.room(3, { game: 'swap', settings: { uploadTime: 30 } });
  const [ann, ben, cleo] = players;
  await env.start(host);
  const fromAnn = await bring(ann, 'cats');
  await env.advance(30_000);
  assert.equal(host.state.phase, 'caption');
  // Ann is the only one with a picture: the others get it, she gets her own back (no bonus for that)
  assert.deepEqual(ben.state.caption.hand.map((t) => t.media.id), [fromAnn]);
  assert.deepEqual(cleo.state.caption.hand.map((t) => t.media.id), [fromAnn]);
  assert.deepEqual(ann.state.caption.hand.map((t) => t.media.id), [fromAnn]);
  assert.equal(ann.state.caption.swapped, false);
  assert.equal(ben.state.caption.swapped, true);

  // nobody brings anything: random templates, nobody is named as bringer
  const empty = await env.room(2, { game: 'swap', settings: { uploadTime: 30, rounds: 1 } });
  await env.start(empty.host);
  await env.advance(30_000);
  for (const p of empty.players) {
    assert.equal(p.state.caption.hand.length, 1);
    assert.equal(p.state.caption.swapped, false);
    p.send({ t: 'submit', captions: caption('template') });
  }
  await env.advance(1500);
  await voteRound(empty.players, () => 5);
  assert.deepEqual(empty.host.state.results.map((r) => [r.from, r.assist]), [[null, null], [null, null]]);
});

test('swap: a broken picture falls back to the other option, then to a template', async () => {
  env.search();
  const { players, host } = await env.room(3, { game: 'swap' });
  await env.start(host);
  for (const [i, p] of players.entries()) await bring(p, 'cats', i);
  await env.advance(2500);
  const [ann] = players;
  const [first, second] = ann.state.caption.hand;
  ann.send({ t: 'draft', captions: caption('keep') });
  ann.send({ t: 'broken', id: first.media.id });
  assert.deepEqual(ann.state.caption.hand.map((t) => t.id), [second.id]);
  assert.equal(ann.state.caption.media.id, second.media.id);
  assert.equal(ann.state.caption.swapped, true);
  ann.send({ t: 'broken', id: second.media.id });
  assert.equal(ann.state.caption.hand.length, 1);
  assert.equal(ann.state.caption.swapped, false);
  assert.doesNotMatch(ann.state.caption.media.id, /^test:/);
  assert.equal(ann.state.caption.captions[0].text, 'keep');
});

test('swap: leaving or being kicked while bringing removes the picture and its file', async () => {
  env.search();
  const { code, players, host } = await env.room(4, { game: 'swap' });
  const [ann, ben, cleo, dora] = players;
  await env.start(host);
  await env.upload(ben, code);
  await env.upload(cleo, code);
  const benFile = fileOf(ben.state.upload.mine.media);
  const cleoFile = fileOf(cleo.state.upload.mine.media);
  assert.equal(ann.state.upload.done, 2);

  ben.send({ t: 'leave' });
  await env.until(() => !fs.existsSync(benFile), 'file of the player who left');
  assert.equal(ann.state.players.length, 3);
  assert.equal(ann.state.upload.done, 1);

  ann.send({ t: 'kick', pid: cleo.pid });
  await env.until(() => !fs.existsSync(cleoFile), 'file of the kicked player');
  assert.equal(ann.state.upload.done, 0);
  assert.equal(ann.state.upload.endingSoon, false);

  // the last one who is missing leaves -> everybody left is ready -> early end
  await bring(ann, 'cats');
  assert.equal(ann.state.upload.endingSoon, false);
  dora.send({ t: 'leave' });
  assert.equal(ann.state.upload.endingSoon, true);
  assert.equal(left(ann), 2500);
  await env.advance(2500);
  assert.equal(ann.state.phase, 'caption');
});

test('swap: a bringer who is offline at the deal keeps the picture in the game and joins late', async () => {
  env.search();
  const { code, players, host } = await env.room(4, { game: 'swap' });
  const [ann, ben, cleo, dora] = players;
  await env.start(host);
  const fromDora = await bring(dora, 'frogs', 5);
  dora.drop();
  await env.advance(11_000); // longer than the reconnect grace time
  const brought = [await bring(ann, 'cats', 0), await bring(ben, 'cats', 1), await bring(cleo, 'cats', 2)];
  assert.equal(host.state.upload.endingSoon, true);
  await env.advance(2500);
  assert.equal(host.state.phase, 'caption');
  const dealt = [ann, ben, cleo].flatMap((p) => p.state.caption.hand.map((t) => t.media.id));
  assert.equal(dealt.length, 6);
  assert.ok(dealt.includes(fromDora), 'the picture of the offline player is in the deal');
  assert.equal(host.state.players.find((row) => row.id === dora.pid).playing, false);

  // back with enough time left: two pictures of the round, least offered first, never the own
  await env.advance(20_000);
  dora.join(code);
  const hand = dora.state.caption.hand.map((t) => t.media.id);
  assert.equal(hand.length, 2);
  assert.ok(!hand.includes(fromDora));
  for (const id of hand) assert.ok(brought.includes(id));
  const count = (id) => dealt.filter((x) => x === id).length;
  const least = Math.min(...brought.map(count));
  assert.ok(hand.some((id) => count(id) === least));
  assert.equal(dora.me().playing, true);

  // a stranger joining with less than 30 s left only watches
  await env.advance(42_000);
  const late = env.client().join(code);
  assert.deepEqual(late.state.caption, { spectator: true });
});

test('swap: a new player joining the caption phase gets pictures of the round', async () => {
  env.search();
  const { code, players, host } = await env.room(2, { game: 'swap' });
  await env.start(host);
  const a = await bring(players[0], 'cats', 0);
  const b = await bring(players[1], 'cats', 1);
  await env.advance(2500);
  const late = env.client().join(code);
  assert.deepEqual(late.state.caption.hand.map((t) => t.media.id).sort(), [a, b].sort());
  assert.equal(late.state.caption.swapped, true);
});

test('swap: the gallery never gets a room upload, a searched GIF is fine', async () => {
  env.search();
  const accA = env.account('swap_ann');
  const accB = env.account('swap_ben');
  const room = env.game.createRoom({ game: 'swap' });
  const ann = env.client({ account: accA }).join(room.code);
  await env.advance(5);
  const ben = env.client({ account: accB }).join(room.code);
  ann.send({ t: 'settings', settings: { ...ann.state.settings, rounds: 2 } });
  await env.start(ann);
  const players = [ann, ben];
  for (let round = 1; round <= 2; round++) {
    assert.equal(ann.state.phase, 'upload');
    await env.upload(ann, room.code); // Ben captions Ann's upload
    await bring(ben, 'cats', round); // Ann captions Ben's searched GIF
    await env.advance(2500);
    for (const p of players) p.send({ t: 'submit', captions: caption(`${p.name} ${round}`) });
    await env.advance(1500);
    // round 1: Ann's meme (searched GIF) wins, round 2: Ben's meme (room upload) wins
    await voteRound(players, (voter) => ((round === 1) === (voter === ben) ? 5 : 1));
    assert.equal(ann.state.phase, 'scores');
    assert.equal(ann.state.results[0].pid, round === 1 ? ann.pid : ben.pid);
    await env.advance(12_000);
  }
  assert.equal(ann.state.phase, 'final');
  const memes = env.db.all('SELECT user_id, media FROM memes WHERE user_id IN (?, ?)', accA.id, accB.id);
  assert.equal(memes.length, 1);
  assert.equal(memes[0].user_id, accA.id);
  assert.match(JSON.parse(memes[0].media).id, /^test:cats:/);
  // both took part: results are saved, a full tie shares the win
  const rows = env.db.all('SELECT user_id, points, won, round_wins FROM game_results WHERE user_id IN (?, ?) ORDER BY user_id', accA.id, accB.id);
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { user_id: accA.id, points: 6, won: 1, round_wins: 1 },
    { user_id: accB.id, points: 6, won: 1, round_wins: 1 },
  ]);
  assert.equal(ann.state.final.tie, true);
});

test('swap: reporting the picture targets whoever brought it, reporting the meme its author', async () => {
  env.search();
  const { players, host } = await env.room(3, { game: 'swap', settings: { rounds: 1 } });
  await env.start(host);
  const brought = {};
  for (const [i, p] of players.entries()) brought[await bring(p, 'cats', i)] = p;
  await env.advance(2500);
  const choice = new Map(players.map((p) => [p, brought[p.state.caption.media.id]]));
  for (const p of players) p.send({ t: 'submit', captions: caption(p.name) });
  await env.advance(1500);
  const author = players.find((p) => p.state.vote.isMine);
  const bringer = choice.get(author);
  // the reporter is neither the author nor the bringer
  const reporter = players.find((p) => p !== author && p !== bringer);
  reporter.send({ t: 'report', target: 'vote', reason: 'upload' });
  await env.until(() => reporter.take('reported').length, 'report about the picture');
  reporter.send({ t: 'report', target: 'vote', reason: 'meme' });
  await env.until(() => reporter.take('reported').length, 'report about the meme');
  const rows = env.db.all('SELECT target_pid, reason FROM reports WHERE reporter_pid = ? ORDER BY id', reporter.pid);
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { target_pid: bringer.pid, reason: 'upload' },
    { target_pid: author.pid, reason: 'meme' },
  ]);
  // the answer tells the reporter nothing about who it was
  assert.deepEqual(reporter.errors(), []);

  // from the scores: same rule; when the bringer has left, the author is responsible
  await voteRound(players, () => 3);
  assert.equal(host.state.phase, 'scores');
  const entry = host.state.results.find((r) => r.pid !== players[0].pid && r.from !== players[0].pid && r.from !== r.pid) || null;
  if (entry) {
    players[0].send({ t: 'report', target: 'result', pid: entry.pid, reason: 'upload' });
    await env.until(() => players[0].take('reported').length || players[0].errors().length, 'report from the scores');
    // (a second report about the same player within 30 minutes is not stored again)
    const rows2 = env.db.all("SELECT target_pid FROM reports WHERE reporter_pid = ? AND reason = 'upload'", players[0].pid);
    assert.ok(rows2.some((row) => row.target_pid === entry.from));
    assert.ok(!rows2.some((row) => row.target_pid === entry.pid));
  }
});

test('swap: last call in the bring phase, never below half of the time', async () => {
  env.search();
  const { players, host } = await env.room(4, { game: 'swap' });
  await env.start(host);
  await env.advance(2900);
  for (const [i, p] of players.slice(0, 3).entries()) await bring(p, 'cats', i); // done after 5 s
  for (const p of players) {
    assert.equal(p.state.lastCall, true);
    assert.equal(left(p), 25_000); // 15 s from now would be second 20 - the floor is second 30
  }
  // the fourth player is ready too: the usual 2.5 s
  players[3].send({ t: 'swap_random' });
  assert.equal(left(host), 2500);
  // ...and cannot take the picture back while the swap is about to happen
  players[3].send({ t: 'swap_clear' });
  assert.equal(players[3].state.upload.mine?.source, 'random', 'no clearing while the swap is about to happen');
  await env.advance(2500);
  assert.equal(host.state.phase, 'caption');
  assert.equal(host.state.lastCall, false);
});
