// Beta mode "One for All": everybody captions the same picture.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { caption, originalUrl, setupGame } from './game-harness.js';

let env;
let markBroken;
before(async () => {
  env = await setupGame();
  ({ markBroken } = await import('../server/media/index.js'));
});

const left = (c) => c.state.deadline - env.now();

test('same: a beta mode can only be created or chosen in a beta room', async () => {
  assert.equal(env.game.createRoom({ game: 'same' }).settings.game, 'classic');
  assert.equal(env.game.createRoom({ game: 'same', channel: 'stable' }).settings.game, 'classic');
  assert.equal(env.game.createRoom({ game: 'same', channel: 'beta', isPublic: true }).settings.game, 'classic');
  assert.equal(env.game.createRoom({ game: 'swap', channel: 'beta', isPublic: true }).settings.game, 'classic');
  const beta = env.game.createRoom({ game: 'same', channel: 'beta' });
  assert.deepEqual(beta.settings, { game: 'same', rounds: 3, captionTime: 60, voteTime: 12, uploadTime: 60, mode: 'images', rerolls: 0, maxPlayers: 10, pack: null, searches: 0 });

  // switching in the lobby
  const stable = await env.room(2);
  assert.equal(stable.host.state.channel, 'stable');
  stable.host.send({ t: 'settings', settings: { ...stable.host.state.settings, game: 'same' } });
  assert.equal(stable.host.state.settings.game, 'classic');
  assert.equal(stable.host.state.settings.captionTime, 90);
  stable.host.send({ t: 'settings', settings: { ...stable.host.state.settings, game: 'swap' } });
  assert.equal(stable.host.state.settings.game, 'swap');

  const room = await env.room(2, { channel: 'beta' });
  assert.equal(room.host.state.channel, 'beta');
  room.host.send({ t: 'settings', settings: { ...room.host.state.settings, game: 'same' } });
  assert.equal(room.host.state.settings.game, 'same');
  assert.equal(room.host.state.settings.captionTime, 60);
  assert.equal(room.host.state.settings.mode, 'images');
  assert.equal(room.host.state.settings.rerolls, 0);
  // only the host
  room.players[1].send({ t: 'settings', settings: { ...room.host.state.settings, game: 'classic' } });
  assert.equal(room.host.state.settings.game, 'same');

  // Discord Activity rooms are stable rooms
  const activity = env.game.activityRoom({ instanceId: 'instance-1', userId: 'user-1' });
  assert.equal(activity.channel, 'stable');
  assert.equal(activity.settings.game, 'classic');
});

test('same: one picture for everybody, no re-roll, late joiners get it too', async () => {
  const { code, players, host } = await env.room(3, { game: 'same', channel: 'beta', settings: { rounds: 2 } });
  const [ann, ben, cleo] = players;
  await env.start(host);
  const shared = host.state.caption.media.id;
  for (const p of players) {
    assert.equal(p.state.phase, 'caption');
    assert.equal(left(p), 60_000);
    assert.equal(p.state.caption.media.id, shared);
    assert.equal(p.state.caption.media.kind, 'image');
    assert.equal(p.state.caption.shared, true);
    assert.equal(p.state.caption.rerollsLeft, 0);
    assert.deepEqual(p.state.caption.hand, []);
    assert.equal(p.state.caption.hunt, undefined);
    assert.deepEqual(p.state.players.map((row) => row.step), ['write', 'write', 'write']);
  }
  ann.send({ t: 'reroll' });
  assert.equal(ann.state.caption.media.id, shared);
  ann.send({ t: 'pick', id: '1' });
  ann.send({ t: 'search', q: 'cats' });
  assert.deepEqual(ann.errors(), []);
  assert.equal(ann.state.caption.media.id, shared);

  // late join: 15 s like classic
  await env.advance(44_000);
  const late = env.client().join(code);
  assert.equal(late.state.caption.media.id, shared);
  assert.equal(late.state.caption.shared, true);
  await env.advance(2000);
  assert.deepEqual(env.client().join(code).state.caption, { spectator: true });

  for (const p of [ann, ben, cleo, late]) p.send({ t: 'submit', captions: caption(p.name) });
  await env.advance(1500);
  assert.equal(host.state.phase, 'vote');
  assert.equal(host.state.vote.total, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(host.state.vote.meme.media.id, shared);
    assert.equal(host.state.vote.sameAsPrev, false);
    await env.advance(12_000 + 3500);
  }
  await env.advance(12_000);
  // a new picture every round
  assert.equal(host.state.round, 2);
  assert.notEqual(host.state.caption.media.id, shared);
  assert.equal(ben.state.caption.media.id, host.state.caption.media.id);
});

test('same: a picture nobody can load is replaced for everybody who is still writing', async () => {
  const { players, host } = await env.room(3, { game: 'same', channel: 'beta' });
  const [ann, ben, cleo] = players;
  await env.start(host);
  const first = host.state.caption.media;
  ann.send({ t: 'submit', captions: caption('fast') });
  ben.send({ t: 'draft', captions: caption('typing') });

  // only Ben's browser has a problem: he gets a picture of his own
  ben.send({ t: 'broken', id: first.id });
  assert.notEqual(ben.state.caption.media.id, first.id);
  assert.equal(ben.state.caption.shared, false);
  assert.equal(ben.state.caption.captions[0].text, 'typing');
  assert.equal(cleo.state.caption.media.id, first.id);
  assert.equal(cleo.state.caption.shared, true);

  // the file is broken for the server too: a new shared picture for everybody who has not submitted
  markBroken(originalUrl(first));
  const version = cleo.state.caption.draftVersion;
  cleo.send({ t: 'broken', id: first.id });
  const second = cleo.state.caption.media;
  assert.notEqual(second.id, first.id);
  assert.equal(cleo.state.caption.shared, true);
  assert.equal(cleo.state.caption.draftVersion, version + 1);
  assert.equal(ann.state.caption.media.id, first.id, 'a submitted meme keeps its picture');
  assert.equal(ben.state.caption.shared, false, 'Ben keeps his own replacement');

  // twice per round at most, then it is a personal replacement again
  const late = env.client().join(host.state.code);
  assert.equal(late.state.caption.media.id, second.id);
  markBroken(originalUrl(second));
  late.send({ t: 'broken', id: second.id });
  const third = late.state.caption.media;
  assert.equal(cleo.state.caption.media.id, third.id);
  assert.equal(late.state.caption.shared, true);
  markBroken(originalUrl(third));
  late.send({ t: 'broken', id: third.id });
  assert.notEqual(late.state.caption.media.id, third.id);
  assert.equal(late.state.caption.shared, false);
  assert.equal(cleo.state.caption.media.id, third.id);
});

test('same: paced like the other new modes - last call and tie-break', async () => {
  const { players, host } = await env.room(4, { game: 'same', channel: 'beta', settings: { rounds: 1 } });
  await env.start(host);
  await env.advance(10_000);
  for (const p of players.slice(0, 3)) p.send({ t: 'submit', captions: caption(p.name) });
  assert.equal(host.state.lastCall, true);
  assert.equal(left(host), 20_000); // second 30 = half of the 60 s
  await env.advance(20_000);
  assert.equal(host.state.phase, 'vote');
  assert.equal(host.state.lastCall, false);
});
