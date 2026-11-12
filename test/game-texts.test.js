import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { dictionaries } from '../lib/i18n.js';
import modes from '../lib/locales/modes.js';
import { GAME_MODES, RATINGS } from '../lib/shared.js';

const root = new URL('..', import.meta.url);
const SCREENS = [
  'GameRoom', 'Lobby', 'GamePicker', 'CaptionPhase', 'UploadPhase', 'VotePhase', 'ScoresPhase', 'FinalPhase',
  'PlayerStrip', 'Reactions', 'Timer', 'MatchStage', 'Matchmaking',
].map((name) => `components/${name}.jsx`);
const HELPERS = readdirSync(new URL('components/game/', root)).map((name) => `components/game/${name}`);

/** all literal keys passed to t('...') in a source file */
function keysOf(file) {
  const src = readFileSync(new URL(file, root), 'utf8');
  return [...src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
}

test('the mode texts exist in English and German with the same placeholders', () => {
  assert.deepEqual(Object.keys(modes.en).sort(), Object.keys(modes.de).sort());
  for (const [key, text] of Object.entries(modes.en)) {
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(vars(modes.de[key]), vars(text), key);
  }
});

test('every text key the game screens use is translated in both languages', () => {
  const missing = [];
  for (const file of [...SCREENS, ...HELPERS]) {
    for (const key of keysOf(file)) {
      for (const lang of ['en', 'de']) if (!(key in dictionaries[lang])) missing.push(`${file}: ${key} (${lang})`);
    }
  }
  assert.deepEqual(missing, []);
});

test('keys that are built at runtime exist for every mode, rating, award and phase', () => {
  const keys = [
    ...GAME_MODES.flatMap((g) => [`games.${g.id}`, `games.${g.id}.text`]),
    ...RATINGS.map((r) => `vote.r${r.score}`),
    ...['best_meme', 'on_fire', 'crowd', 'best_avg', 'supplier', 'one_shot'].flatMap((id) => [`award.${id}`, `award.${id}.value`]),
    ...['lobby', 'upload', 'caption', 'vote', 'scores', 'final'].map((p) => `phase.${p}`),
    'final.winsBy.wins',
    'final.winsBy.meme',
    'pace.lastCallYou',
    'pace.lastCallWait',
    'err.no_lucky_left',
    'err.search_empty',
    'err.item_expired',
    'err.search_limit',
  ];
  for (const lang of ['en', 'de']) {
    for (const key of keys) assert.ok(key in dictionaries[lang], `${key} (${lang})`);
  }
});
