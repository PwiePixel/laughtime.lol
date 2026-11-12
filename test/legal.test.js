import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEGAL } from '../lib/legal.js';
import { LEGAL_V2 } from '../lib/legal-v2.js';

test('the v2 privacy additions exist in both languages with the same structure', () => {
  assert.deepEqual(Object.keys(LEGAL_V2).sort(), ['de', 'en']);
  assert.equal(LEGAL_V2.en.paragraphs.length, LEGAL_V2.de.paragraphs.length);
  for (const lang of ['en', 'de']) {
    assert.ok(LEGAL_V2[lang].title.length > 10);
    for (const p of LEGAL_V2[lang].paragraphs) assert.ok(p.length > 80, 'every paragraph is a full text');
  }
});

test('paragraphs of the legal page have unique beginnings (used as list keys)', () => {
  for (const lang of ['en', 'de']) {
    for (const section of [...LEGAL[lang].sections, LEGAL_V2[lang]]) {
      const keys = section.paragraphs.map((p) => p.slice(0, 40));
      assert.equal(new Set(keys).size, keys.length, `${lang}: ${section.title}`);
    }
    const titles = [...LEGAL[lang].sections, LEGAL_V2[lang]].map((s) => s.title);
    assert.equal(new Set(titles).size, titles.length);
  }
});
