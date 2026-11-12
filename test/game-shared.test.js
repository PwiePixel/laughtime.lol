import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SETTINGS,
  GAME_IDS,
  GAME_MODES,
  PUBLIC_GAME_IDS,
  gameAllowed,
  gamesFor,
  isPaced,
  presetFor,
  restoreHand,
  sanitizeSettings,
} from '../lib/shared.js';

test('beta modes exist only in the beta channel, private-only modes never in quick play', () => {
  assert.deepEqual(GAME_IDS, ['classic', 'hunt', 'swap', 'same']);
  assert.deepEqual(PUBLIC_GAME_IDS, ['classic', 'hunt']);
  assert.equal(gameAllowed('same'), false);
  assert.equal(gameAllowed('same', { channel: 'stable' }), false);
  assert.equal(gameAllowed('same', { channel: 'beta' }), true);
  assert.equal(gameAllowed('same', { channel: 'beta', isPublic: true }), false);
  assert.equal(gameAllowed('swap'), true);
  assert.equal(gameAllowed('swap', { isPublic: true }), false);
  assert.equal(gameAllowed('classic', { isPublic: true }), true);
  assert.equal(gameAllowed('nope', { channel: 'beta' }), false);
  assert.equal(gameAllowed(undefined), false);
  assert.deepEqual(gamesFor().map((g) => g.id), ['classic', 'hunt', 'swap']);
  assert.deepEqual(gamesFor({ channel: 'beta' }).map((g) => g.id), ['classic', 'hunt', 'swap', 'same']);
  assert.deepEqual(gamesFor({ channel: 'beta', isPublic: true }).map((g) => g.id), PUBLIC_GAME_IDS);
  // every public queue mode is a stable, non-private mode
  for (const id of PUBLIC_GAME_IDS) {
    const mode = GAME_MODES.find((g) => g.id === id);
    assert.ok(!mode.beta && !mode.privateOnly);
  }
});

test('only classic is unpaced', () => {
  assert.equal(isPaced('classic'), false);
  for (const id of ['hunt', 'swap', 'same']) assert.equal(isPaced(id), true);
});

test('presets: classic is exactly what it was, plus the searches key', () => {
  assert.deepEqual(presetFor('classic'), {
    game: 'classic',
    rounds: 3,
    captionTime: 90,
    voteTime: 12,
    uploadTime: 60,
    mode: 'mixed',
    rerolls: 2,
    maxPlayers: 10,
    pack: null,
    searches: 0,
  });
  assert.deepEqual(presetFor('classic'), DEFAULT_SETTINGS);
  assert.deepEqual(presetFor('unknown'), DEFAULT_SETTINGS);
  assert.deepEqual(presetFor('hunt'), { ...DEFAULT_SETTINGS, game: 'hunt', mode: 'videos', rerolls: 0 });
  assert.deepEqual(presetFor('swap'), { ...DEFAULT_SETTINGS, game: 'swap', mode: 'mixed', rerolls: 0 });
  assert.deepEqual(presetFor('same'), { ...DEFAULT_SETTINGS, game: 'same', mode: 'images', rerolls: 0, captionTime: 60 });
});

test('settings: a beta mode cannot be chosen in a stable room', () => {
  const classic = presetFor('classic');
  assert.equal(sanitizeSettings({ ...classic, game: 'same' }, classic).game, 'classic');
  assert.equal(sanitizeSettings({ ...classic, game: 'same' }, classic, { channel: 'stable' }).game, 'classic');
  // the refused switch does not apply a preset either
  assert.deepEqual(sanitizeSettings({ ...classic, game: 'same' }, classic, { channel: 'stable' }), classic);
  const same = sanitizeSettings({ ...classic, game: 'same' }, classic, { channel: 'beta' });
  assert.deepEqual(same, presetFor('same'));
  // a room that already plays the beta mode keeps it whatever the channel says
  assert.equal(sanitizeSettings({ ...same, rounds: 5 }, same, { channel: 'stable' }).game, 'same');
});

test('settings: the caption time preset only moves when switching to or from "same"', () => {
  const classic = presetFor('classic');
  const beta = { channel: 'beta' };
  const same = sanitizeSettings({ ...classic, game: 'same' }, classic, beta);
  assert.equal(same.captionTime, 60);
  assert.equal(sanitizeSettings({ ...same, game: 'classic' }, same, beta).captionTime, 90);
  // a caption time that is sent together with the switch wins
  assert.equal(sanitizeSettings({ ...classic, game: 'same', captionTime: 120 }, classic, beta).captionTime, 120);
  // a host who changed the time before keeps... the preset of the new mode (same rule as mode/re-rolls)
  const custom = { ...classic, captionTime: 45 };
  assert.equal(sanitizeSettings({ ...custom, game: 'same' }, custom, beta).captionTime, 60);
  assert.equal(sanitizeSettings({ ...custom, game: 'hunt' }, custom, beta).captionTime, 45);
});

test('settings: classic <-> hunt <-> swap switches behave as before', () => {
  const classic = presetFor('classic');
  const hunt = sanitizeSettings({ ...classic, game: 'hunt' }, classic);
  assert.deepEqual(hunt, presetFor('hunt'));
  const back = sanitizeSettings({ ...hunt, game: 'classic' }, hunt);
  assert.deepEqual(back, classic);
  const swap = sanitizeSettings({ ...classic, game: 'swap' }, classic);
  assert.deepEqual(swap, presetFor('swap'));
  // only the game key: nothing but the game changes
  assert.deepEqual(sanitizeSettings({ game: 'hunt' }, classic), { ...classic, game: 'hunt' });
  // plain changes
  assert.equal(sanitizeSettings({ rounds: 5 }, classic).rounds, 5);
  assert.equal(sanitizeSettings({ rounds: 7 }, classic).rounds, 3);
  assert.equal(sanitizeSettings({ voteTime: '12' }, { ...classic, voteTime: 20 }).voteTime, 20);
  assert.equal(sanitizeSettings(null, classic).game, 'classic');
  // the pack never comes from the client
  const pack = { id: 'p1', name: 'Mine' };
  assert.equal(sanitizeSettings({ pack: { id: 'evil' } }, classic).pack, null);
  assert.deepEqual(sanitizeSettings({ pack: null }, { ...classic, pack }).pack, pack);
});

test('settings: searches per round', () => {
  const hunt = presetFor('hunt');
  assert.equal(hunt.searches, 0);
  assert.equal(sanitizeSettings({ searches: 4 }, hunt).searches, 4);
  for (const bad of [5, -1, 2.5, '3', null, undefined, NaN]) assert.equal(sanitizeSettings({ searches: bad }, { ...hunt, searches: 2 }).searches, 2);
  // rooms created before the setting existed get the default
  const { searches, ...old } = hunt;
  assert.equal(searches, 0);
  assert.equal(sanitizeSettings({ rounds: 2 }, old).searches, 0);
});

test('restoreHand: the tray comes once per connection and is put back into later states', () => {
  const hand = [{ id: '1' }, { id: '2' }];
  let cache = null;
  // first state with a tray: remembered
  const first = { caption: { hand, handKey: '7:1.2', pickedId: '1' } };
  cache = restoreHand(first, cache);
  assert.deepEqual(cache, { key: '7:1.2', hand });
  assert.equal(first.caption.hand, hand);
  // later states come without it
  const lean = { caption: { handKey: '7:1.2', pickedId: '2' } };
  cache = restoreHand(lean, cache);
  assert.equal(lean.caption.hand, hand);
  // a key the connection never got a tray for: empty rather than a wrong tray
  const stale = { caption: { handKey: '8:1.2' } };
  cache = restoreHand(stale, cache);
  assert.deepEqual(stale.caption.hand, []);
  // modes without a tray always send the empty list and no key
  const classic = { caption: { hand: [] } };
  assert.equal(restoreHand(classic, cache), cache);
  assert.deepEqual(classic.caption.hand, []);
  // spectators and other phases are left alone
  const spectator = { caption: { spectator: true } };
  assert.equal(restoreHand(spectator, cache), cache);
  assert.deepEqual(spectator, { caption: { spectator: true } });
  assert.equal(restoreHand({ phase: 'vote' }, cache), cache);
  assert.equal(restoreHand(null, null), null);
});
