import assert from 'node:assert/strict';
import { test } from 'node:test';
import ui from '../lib/locales/ui.js';
import { AVATAR_COLORS, AVATAR_ICONS } from '../lib/shared.js';

test('ui texts exist in English and German', () => {
  assert.deepEqual(Object.keys(ui.de).sort(), Object.keys(ui.en).sort());
  for (const lang of ['en', 'de']) {
    for (const [key, text] of Object.entries(ui[lang])) {
      assert.ok(typeof text === 'string' && text.trim(), `${lang}: ${key} is empty`);
    }
  }
});

test('placeholders are the same in both languages', () => {
  const vars = (text) => (text.match(/\{\w+\}/g) || []).sort();
  for (const key of Object.keys(ui.en)) {
    assert.deepEqual(vars(ui.de[key]), vars(ui.en[key]), key);
  }
});

test('every avatar picture and colour has a spoken name', () => {
  for (const name of AVATAR_ICONS) assert.ok(ui.en[`ui.icon.${name}`], `ui.icon.${name}`);
  AVATAR_COLORS.forEach((_, i) => assert.ok(ui.en[`ui.color.${i}`], `ui.color.${i}`));
});
