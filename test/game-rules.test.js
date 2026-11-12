import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assistFor,
  awardsFor,
  dealSwap,
  distOf,
  drawHand,
  lastCallDeadline,
  lastCallReached,
  lateOptions,
  rankPlayers,
  stragglersAllowed,
  swapVoteOrder,
} from '../server/game/rules.js';

const items = (n, prefix = 'g') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const ids = (list) => list.map((i) => i.id);
const reverse = (list) => [...list].reverse();
// small seeded shuffle so "random" cases are repeatable
function seeded(seed) {
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
}

test('drawHand: four tiles out of the 16 best fresh hits', () => {
  const hits = items(40);
  const plain = drawHand(hits);
  assert.deepEqual(ids(plain.hand), ['g0', 'g1', 'g2', 'g3']);
  assert.equal(plain.spares.length, 30);
  assert.equal(plain.spares[0].id, 'g4');
  const rev = drawHand(hits, { shuffle: reverse });
  assert.deepEqual(ids(rev.hand), ['g15', 'g14', 'g13', 'g12']);
  for (let seed = 1; seed <= 20; seed++) {
    const { hand, spares } = drawHand(hits, { shuffle: seeded(seed) });
    assert.equal(hand.length, 4);
    assert.equal(new Set(ids(hand)).size, 4);
    for (const tile of hand) assert.ok(Number(tile.id.slice(1)) < 16);
    for (const tile of hand) assert.ok(!ids(spares).includes(tile.id));
  }
});

test('drawHand: used hits only fill up, own tiles never come back', () => {
  const hits = items(10);
  const avoid = new Set(['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7']);
  const filled = drawHand(hits, { avoid });
  assert.deepEqual(ids(filled.hand), ['g8', 'g9', 'g0', 'g1']);
  assert.deepEqual(ids(filled.spares), ['g2', 'g3', 'g4', 'g5', 'g6', 'g7']);
  const own = new Set(['g0', 'g1', 'g2']);
  const second = drawHand(hits, { own });
  assert.deepEqual(ids(second.hand), ['g3', 'g4', 'g5', 'g6']);
  assert.ok(!ids(second.spares).some((id) => own.has(id)));
  // everything is used already: still a full hand
  assert.equal(drawHand(hits, { avoid: new Set(ids(hits)) }).hand.length, 4);
});

test('drawHand: fewer than four hits, no hits, duplicates', () => {
  assert.deepEqual(ids(drawHand(items(2)).hand), ['g0', 'g1']);
  assert.deepEqual(drawHand(items(2)).spares, []);
  assert.deepEqual(drawHand([]).hand, []);
  assert.deepEqual(drawHand(undefined).hand, []);
  assert.deepEqual(drawHand(items(3), { own: new Set(['g0', 'g1', 'g2']) }).hand, []);
  assert.deepEqual(ids(drawHand([{ id: 'a' }, { id: 'a' }, { id: 'b' }]).hand), ['a', 'b']);
  assert.equal(drawHand(items(40), { size: 6, top: 6 }).hand.length, 6);
});

test('dealSwap: never the own picture, no owner twice, two offers per picture', () => {
  for (const n of [1, 2, 3, 4, 8, 16]) {
    const players = Array.from({ length: n }, (_, i) => `p${i}`);
    for (let seed = 1; seed <= 25; seed++) {
      const deal = dealSwap({ receivers: players, owners: players, shuffle: seeded(seed * n) });
      const offers = new Map(players.map((p) => [p, 0]));
      assert.equal(deal.size, n);
      for (const [receiver, got] of deal) {
        assert.ok(!got.includes(receiver), 'own picture offered');
        assert.equal(new Set(got).size, got.length, 'same owner twice');
        assert.equal(got.length, Math.min(2, n - 1));
        for (const owner of got) offers.set(owner, offers.get(owner) + 1);
      }
      if (n >= 3) for (const count of offers.values()) assert.equal(count, 2);
      if (n === 2) for (const count of offers.values()) assert.equal(count, 1);
    }
  }
  assert.deepEqual(dealSwap({ receivers: ['a'], owners: ['a'] }).get('a'), []);
  assert.deepEqual(dealSwap({ receivers: ['a', 'b'], owners: ['a', 'b'] }), new Map([['a', ['b']], ['b', ['a']]]));
});

test('dealSwap: offline bringers stay in, receivers without a picture still get two', () => {
  // d brought a picture but is offline: no receiver seat, picture in the game
  const withOffline = dealSwap({ receivers: ['a', 'b', 'c'], owners: ['a', 'b', 'c', 'd'] });
  assert.equal(withOffline.has('d'), false);
  assert.ok([...withOffline.values()].some((got) => got.includes('d')));
  for (const [receiver, got] of withOffline) {
    assert.equal(got.length, 2);
    assert.ok(!got.includes(receiver));
  }
  // c and d brought nothing
  const some = dealSwap({ receivers: ['a', 'b', 'c', 'd'], owners: ['a', 'b'] });
  assert.deepEqual(some.get('a'), ['b']);
  assert.deepEqual(some.get('b'), ['a']);
  assert.deepEqual([...some.get('c')].sort(), ['a', 'b']);
  assert.deepEqual([...some.get('d')].sort(), ['a', 'b']);
  // only one picture in the round: its owner gets nothing
  const one = dealSwap({ receivers: ['a', 'b', 'c'], owners: ['b'] });
  assert.deepEqual(one.get('a'), ['b']);
  assert.deepEqual(one.get('b'), []);
  assert.deepEqual(one.get('c'), ['b']);
  // nobody brought anything
  const none = dealSwap({ receivers: ['a', 'b', 'c'], owners: [] });
  for (const got of none.values()) assert.deepEqual(got, []);
  // random seats, many players, a few without pictures
  for (let seed = 1; seed <= 30; seed++) {
    const receivers = Array.from({ length: 16 }, (_, i) => `p${i}`);
    const owners = [...receivers.filter((_, i) => i % 3 !== 0), 'gone1', 'gone2'];
    const deal = dealSwap({ receivers, owners, shuffle: seeded(seed) });
    for (const [receiver, got] of deal) {
      assert.equal(got.length, 2);
      assert.ok(!got.includes(receiver));
      assert.equal(new Set(got).size, 2);
      for (const owner of got) assert.ok(owners.includes(owner));
    }
  }
});

test('lateOptions: least offered pictures first, never the own one', () => {
  const offers = new Map([['a', 2], ['b', 1], ['c', 2], ['d', 0]]);
  assert.deepEqual(lateOptions({ pid: 'x', owners: ['a', 'b', 'c', 'd'], offers }), ['d', 'b']);
  assert.deepEqual(lateOptions({ pid: 'd', owners: ['a', 'b', 'c', 'd'], offers }), ['b', 'a']);
  assert.deepEqual(lateOptions({ pid: 'd', owners: ['a', 'b', 'c', 'd'], offers, shuffle: reverse }), ['b', 'c']);
  assert.deepEqual(lateOptions({ pid: 'x', owners: ['a'], offers }), ['a']);
  assert.deepEqual(lateOptions({ pid: 'a', owners: ['a'], offers }), []);
  assert.deepEqual(lateOptions({ pid: 'x', owners: [] }), []);
  assert.deepEqual(lateOptions({ pid: 'x', owners: ['n1', 'n2', 'n3'] }), ['n1', 'n2']);
});

test('swapVoteOrder: memes on the same picture run back to back', () => {
  const entries = [
    { pid: 'a', from: 'x', mediaId: 'm1' },
    { pid: 'b', from: 'y', mediaId: 'm2' },
    { pid: 'c', from: 'x', mediaId: 'm1' },
    { pid: 'd', from: null, mediaId: 'm3' },
    { pid: 'e', from: 'y', mediaId: 'm2' },
    { pid: 'f', from: 'y', mediaId: 'other' },
  ];
  assert.deepEqual(swapVoteOrder(entries), [
    { pid: 'a', sameAsPrev: false },
    { pid: 'c', sameAsPrev: true },
    { pid: 'b', sameAsPrev: false },
    { pid: 'e', sameAsPrev: true },
    { pid: 'd', sameAsPrev: false },
    { pid: 'f', sameAsPrev: false },
  ]);
  for (let seed = 1; seed <= 20; seed++) {
    const order = swapVoteOrder(entries, seeded(seed));
    assert.deepEqual(order.map((o) => o.pid).sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
    const pos = (pid) => order.findIndex((o) => o.pid === pid);
    assert.equal(Math.abs(pos('a') - pos('c')), 1);
    assert.equal(Math.abs(pos('b') - pos('e')), 1);
    assert.equal(order.filter((o) => o.sameAsPrev).length, 2);
    assert.equal(order[0].sameAsPrev, false);
  }
  assert.deepEqual(swapVoteOrder([]), []);
});

test('assistFor: one point per 4 or 5 that is not from the bringer', () => {
  const base = { pid: 'author', from: 'bringer', source: 'upload' };
  assert.equal(assistFor({ ...base, ratings: [['v1', 5], ['v2', 4], ['v3', 3], ['v4', 1]] }), 2);
  assert.equal(assistFor({ ...base, ratings: [['bringer', 5], ['v2', 4]] }), 1);
  assert.equal(assistFor({ ...base, source: 'search', ratings: new Map([['v1', 4]]) }), 1);
  // two players: the only voter is the bringer
  assert.equal(assistFor({ ...base, ratings: [['bringer', 5]] }), 0);
  assert.equal(assistFor({ ...base, source: 'random', ratings: [['v1', 5]] }), 0);
  assert.equal(assistFor({ ...base, source: undefined, ratings: [['v1', 5]] }), 0);
  assert.equal(assistFor({ ...base, from: null, ratings: [['v1', 5]] }), 0);
  assert.equal(assistFor({ ...base, from: 'author', ratings: [['v1', 5]] }), 0);
  assert.equal(assistFor({ ...base }), 0);
  assert.equal(assistFor(null), 0);
});

test('distOf counts every rating', () => {
  assert.deepEqual(distOf([5, 5, 1, 3, 4, 5]), [1, 0, 1, 1, 3]);
  assert.deepEqual(distOf([]), [0, 0, 0, 0, 0]);
  assert.deepEqual(distOf([0, 6, 2.5, '3', 2]), [0, 1, 0, 0, 0]);
});

test('last call: quorum for 2 to 16 players', () => {
  assert.deepEqual(
    Array.from({ length: 15 }, (_, i) => stragglersAllowed(i + 2)),
    [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4],
  );
  for (let total = 2; total <= 16; total++) {
    const allowed = stragglersAllowed(total);
    for (let done = 0; done <= total; done++) {
      const expected = total >= 3 && done < total && total - done <= allowed;
      assert.equal(lastCallReached(done, total), expected, `${done}/${total}`);
    }
  }
  assert.equal(lastCallReached(1, 2), false);
  assert.equal(lastCallReached(2, 3), true);
  assert.equal(lastCallReached(3, 4), true);
  assert.equal(lastCallReached(2, 4), false);
  assert.equal(lastCallReached(6, 8), true);
  assert.equal(lastCallReached(12, 16), true);
  assert.equal(lastCallReached(11, 16), false);
});

test('last call: the new deadline never cuts below half of the configured time', () => {
  const caption = { phaseStart: 0, configuredMs: 90_000, graceMs: 20_000, deadline: 90_000 };
  assert.equal(lastCallDeadline({ ...caption, now: 30_000 }), 50_000);
  assert.equal(lastCallDeadline({ ...caption, now: 5_000 }), 45_000);
  assert.equal(lastCallDeadline({ ...caption, now: 60_000 }), 80_000);
  // not at least a second earlier -> nothing changes
  assert.equal(lastCallDeadline({ ...caption, now: 69_001 }), null);
  assert.equal(lastCallDeadline({ ...caption, now: 69_000 }), 89_000);
  assert.equal(lastCallDeadline({ ...caption, now: 85_000 }), null);
  // vote: no floor
  assert.equal(lastCallDeadline({ now: 1000, deadline: 13_000, graceMs: 4000 }), 5000);
  assert.equal(lastCallDeadline({ now: 9000, deadline: 13_000, graceMs: 4000 }), null);
  // 30 s bring phase: floor at 15 s
  assert.equal(lastCallDeadline({ now: 2000, deadline: 60_000, phaseStart: 0, configuredMs: 60_000, graceMs: 15_000 }), 30_000);
});

test('rankPlayers: score only, shared ranks', () => {
  const rows = [
    { pid: 'a', score: 10, roundWins: 0, bestMeme: 5, joinedAt: 3 },
    { pid: 'b', score: 10, roundWins: 2, bestMeme: 9, joinedAt: 2 },
    { pid: 'c', score: 4, roundWins: 1, bestMeme: 4, joinedAt: 1 },
    { pid: 'd', score: 4, roundWins: 0, bestMeme: 2, joinedAt: 0 },
  ];
  const { ranking, tie, decidedBy } = rankPlayers(rows);
  assert.deepEqual(ranking.map((r) => [r.pid, r.rank]), [['b', 1], ['a', 1], ['d', 3], ['c', 3]]);
  assert.equal(tie, true);
  assert.equal(decidedBy, null);
  assert.deepEqual(ranking[0], { pid: 'b', rank: 1, score: 10, roundWins: 2, bestMeme: 9 });
});

test('rankPlayers: tie-break by rounds won, then by the best meme', () => {
  const rows = [
    { pid: 'a', score: 10, roundWins: 1, bestMeme: 5, joinedAt: 0 },
    { pid: 'b', score: 10, roundWins: 2, bestMeme: 4, joinedAt: 1 },
    { pid: 'c', score: 4, roundWins: 0, bestMeme: 4, joinedAt: 2 },
  ];
  const byWins = rankPlayers(rows, { tieBreak: true });
  assert.deepEqual(byWins.ranking.map((r) => [r.pid, r.rank]), [['b', 1], ['a', 2], ['c', 3]]);
  assert.equal(byWins.tie, false);
  assert.equal(byWins.decidedBy, 'wins');

  rows[0].roundWins = 2;
  const byMeme = rankPlayers(rows, { tieBreak: true });
  assert.deepEqual(byMeme.ranking.map((r) => [r.pid, r.rank]), [['a', 1], ['b', 2], ['c', 3]]);
  assert.equal(byMeme.decidedBy, 'meme');

  rows[1].bestMeme = 5;
  const full = rankPlayers(rows, { tieBreak: true });
  assert.deepEqual(full.ranking.map((r) => [r.pid, r.rank]), [['a', 1], ['b', 1], ['c', 3]]);
  assert.equal(full.tie, true);
  assert.equal(full.decidedBy, null);

  // a clear winner needs no tie-break
  rows[0].score = 11;
  const clear = rankPlayers(rows, { tieBreak: true });
  assert.equal(clear.tie, false);
  assert.equal(clear.decidedBy, null);
  assert.deepEqual(rankPlayers([], { tieBreak: true }), { ranking: [], tie: false, decidedBy: null });
  assert.equal(rankPlayers([rows[0]], { tieBreak: true }).tie, false);
});

const meme = (round, pid, points, avg, extra = {}) => ({ round, pid, points, avg, votes: 3, ...extra });

test('awardsFor: thresholds and who wins what', () => {
  const players = [
    { pid: 'a', score: 30, bestStreak: 2, assist: 0 },
    { pid: 'b', score: 20, bestStreak: 1, assist: 0 },
    { pid: 'c', score: 10, bestStreak: 0, assist: 0 },
    { pid: 'd', score: 5, bestStreak: 0, assist: 0 },
  ];
  const memes = [meme(1, 'a', 12, 4), meme(1, 'b', 9, 3), meme(1, 'c', 6, 2), meme(2, 'a', 12, 4), meme(2, 'b', 11, 3.7), meme(2, 'c', 4, 1.3)];
  const crowd = new Map([['c', 3], ['b', 2]]);
  const awards = awardsFor({ game: 'classic', players, memes, crowd });
  // a holds best_meme already: on_fire is skipped first and only fills the third slot, best_avg (a again) stays out
  assert.deepEqual(awards, [
    { id: 'best_meme', pid: 'a', value: 12, round: 1 },
    { id: 'on_fire', pid: 'a', value: 2 },
    { id: 'crowd', pid: 'c', value: 3 },
  ]);
  // the steady hand goes to the best mean of the average ratings
  const steady = awardsFor({ game: 'classic', players: players.map((p) => ({ ...p, bestStreak: 0 })), memes: memes.filter((m) => m.pid !== 'a'), crowd });
  assert.deepEqual(steady, [
    { id: 'best_meme', pid: 'b', value: 11, round: 2 },
    { id: 'crowd', pid: 'c', value: 3 },
    { id: 'best_avg', pid: 'b', value: 3.4 },
  ]);
  // thresholds: streak of 1, two reactions, a single rated meme are not enough
  const thin = awardsFor({
    game: 'classic',
    players: players.map((p) => ({ ...p, bestStreak: 1 })),
    memes: [meme(1, 'a', 12, 4), meme(1, 'b', 9, 3)],
    crowd: new Map([['c', 2]]),
  });
  assert.deepEqual(thin, [{ id: 'best_meme', pid: 'a', value: 12, round: 1 }]);
});

test('awardsFor: one player who wins everything still fills three awards, never more than four', () => {
  const players = [
    { pid: 'a', score: 30, bestStreak: 3, assist: 0 },
    { pid: 'b', score: 2, bestStreak: 0, assist: 0 },
    { pid: 'c', score: 1, bestStreak: 0, assist: 0 },
  ];
  const memes = [meme(1, 'a', 10, 5), meme(2, 'a', 10, 5), meme(3, 'a', 10, 5), meme(1, 'b', 2, 1), meme(1, 'c', 1, 0.5)];
  const solo = awardsFor({ game: 'classic', players, memes, crowd: new Map([['a', 9]]) });
  assert.deepEqual(solo.map((a) => [a.id, a.pid]), [['best_meme', 'a'], ['on_fire', 'a'], ['crowd', 'a']]);

  const six = Array.from({ length: 6 }, (_, i) => ({ pid: `p${i}`, score: 60 - i * 10, bestStreak: 0, assist: 0 }));
  six[0].assist = 4;
  six[2].bestStreak = 2;
  const spread = awardsFor({
    game: 'swap',
    players: six,
    memes: [meme(1, 'p1', 12, 4), meme(2, 'p1', 3, 1), meme(1, 'p4', 9, 4.5), meme(2, 'p4', 9, 4.5)],
    crowd: new Map([['p3', 7]]),
  });
  assert.deepEqual(spread.map((a) => [a.id, a.pid, a.value]), [
    ['supplier', 'p0', 4],
    ['best_meme', 'p1', 12],
    ['on_fire', 'p2', 2],
    ['crowd', 'p3', 7],
  ]);
});

test('awardsFor: needs three players and a meme with points; mode awards only in their mode', () => {
  const players = [
    { pid: 'a', score: 9, bestStreak: 0, assist: 3 },
    { pid: 'b', score: 5, bestStreak: 0, assist: 0 },
    { pid: 'c', score: 0, bestStreak: 0, assist: 0 },
  ];
  const memes = [meme(1, 'a', 9, 4.5, { searches: 1 }), meme(1, 'b', 5, 2.5, { searches: 2 })];
  assert.deepEqual(awardsFor({ game: 'hunt', players: players.slice(0, 2), memes }), []);
  assert.deepEqual(awardsFor({ game: 'hunt', players, memes: memes.map((m) => ({ ...m, points: 0 })) }), []);
  assert.deepEqual(awardsFor({ game: 'hunt', players, memes: [] }), []);
  const hunt = awardsFor({ game: 'hunt', players, memes });
  assert.deepEqual(hunt, [
    { id: 'one_shot', pid: 'a', value: 9, round: 1 },
    { id: 'best_meme', pid: 'a', value: 9, round: 1 },
  ]);
  // a one-shot needs at most one search
  const two = awardsFor({ game: 'hunt', players, memes: memes.map((m) => ({ ...m, searches: 2 })) });
  assert.deepEqual(two.map((a) => a.id), ['best_meme']);
  const swap = awardsFor({ game: 'swap', players, memes });
  assert.deepEqual(swap.map((a) => [a.id, a.pid]), [['supplier', 'a'], ['best_meme', 'a']]);
  assert.deepEqual(awardsFor({ game: 'classic', players, memes }).map((a) => a.id), ['best_meme']);
  assert.deepEqual(awardsFor({ game: 'same', players, memes }).map((a) => a.id), ['best_meme']);
  // memes of players who left the room earn nothing
  assert.deepEqual(awardsFor({ game: 'classic', players, memes: [meme(1, 'gone', 15, 5)] }), []);
});
