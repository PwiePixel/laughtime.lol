import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dictionaries } from '../lib/i18n.js';
import newsTexts from '../lib/locales/news.js';
import { NEWS, NEWS_TAGS, byId, formatNewsDate, latest, older, pick, splitTitle } from '../lib/news.js';
import { APP_RELEASE, APP_VERSION } from '../lib/version.js';

const LANGS = ['en', 'de'];

// icon names from the mapping in components/Icon.jsx (read as text: the file is JSX)
function iconNames() {
  const source = readFileSync(new URL('../components/Icon.jsx', import.meta.url), 'utf8');
  const block = source.match(/const ICONS = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'ICONS mapping not found in components/Icon.jsx');
  const names = new Set();
  for (const m of block[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm)) names.add(m[1] || m[2]);
  return names;
}

// a text is a { en, de } pair with real content in both languages
function assertText(text, where) {
  assert.equal(typeof text, 'object', `${where}: must be { en, de }`);
  for (const lang of LANGS) {
    assert.equal(typeof text?.[lang], 'string', `${where}: "${lang}" is missing`);
    assert.ok(text[lang].trim().length > 0, `${where}: "${lang}" is empty`);
    assert.equal(text[lang], text[lang].trim(), `${where}: "${lang}" has stray spaces`);
  }
}

test('there is news and the helpers find it', () => {
  assert.ok(NEWS.length >= 1);
  assert.equal(latest(), NEWS[0]);
  assert.equal(byId(NEWS[0].id), NEWS[0]);
  assert.equal(byId('does-not-exist'), undefined);
  assert.deepEqual(older(), NEWS.slice(1));
});

test('ids are unique and URL-safe', () => {
  const ids = NEWS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate news id');
  for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `id "${id}"`);
});

test('dates are valid ISO days, newest first', () => {
  for (const entry of NEWS) {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, `${entry.id}: date`);
    const date = new Date(`${entry.date}T00:00:00Z`);
    assert.ok(!Number.isNaN(date.getTime()), `${entry.id}: date does not exist`);
    // "2026-02-31" would silently roll over into March
    assert.equal(date.toISOString().slice(0, 10), entry.date, `${entry.id}: date does not exist`);
  }
  for (let i = 1; i < NEWS.length; i += 1) {
    assert.ok(NEWS[i - 1].date >= NEWS[i].date, `${NEWS[i].id} is newer than the entry above it`);
  }
});

test('tags and versions are well-formed', () => {
  for (const entry of NEWS) {
    assert.ok(NEWS_TAGS.includes(entry.tag), `${entry.id}: unknown tag "${entry.tag}"`);
    assert.match(entry.version, /^\d+\.\d+\.\d+$/, `${entry.id}: version`);
  }
});

test('every text exists in English and German', () => {
  for (const entry of NEWS) {
    assertText(entry.title, `${entry.id}.title`);
    assertText(entry.summary, `${entry.id}.summary`);
    if (entry.teaser !== undefined) assertText(entry.teaser, `${entry.id}.teaser`);
    assert.ok(Array.isArray(entry.highlights) && entry.highlights.length > 0, `${entry.id}: highlights`);
    entry.highlights.forEach((h, i) => {
      assertText(h.title, `${entry.id}.highlights[${i}].title`);
      assertText(h.text, `${entry.id}.highlights[${i}].text`);
    });
    assert.ok(Array.isArray(entry.sections) && entry.sections.length > 0, `${entry.id}: sections`);
    entry.sections.forEach((s, i) => {
      assertText(s.title, `${entry.id}.sections[${i}].title`);
      assert.ok(Array.isArray(s.items) && s.items.length > 0, `${entry.id}.sections[${i}]: items`);
      s.items.forEach((item, n) => {
        assertText(item, `${entry.id}.sections[${i}].items[${n}]`);
        if (item.link !== undefined) {
          assertText(item.link, `${entry.id}.sections[${i}].items[${n}].link`);
          assert.match(item.link.href, /^(\/(?!\/)|https:\/\/)/, `${entry.id}.sections[${i}].items[${n}].link.href`);
        }
      });
    });
  }
});

test('icons exist in components/Icon.jsx', () => {
  const known = iconNames();
  assert.ok(known.has('sparkles') && known.has('thumbs-up'), 'icon mapping was not parsed');
  for (const entry of NEWS) {
    entry.highlights.forEach((h, i) => {
      assert.ok(known.has(h.icon), `${entry.id}.highlights[${i}]: unknown icon "${h.icon}"`);
    });
    entry.sections.forEach((s, i) => {
      if (s.icon !== undefined) assert.ok(known.has(s.icon), `${entry.id}.sections[${i}]: unknown icon "${s.icon}"`);
    });
  }
});

test('the entry of the running release carries the release name', () => {
  const current = NEWS.find((entry) => entry.tag === 'release' && entry.version === APP_VERSION);
  if (!current) return;
  for (const lang of LANGS) {
    assert.ok(current.title[lang].startsWith(APP_RELEASE), `${current.id}.title.${lang} should start with "${APP_RELEASE}"`);
  }
});

test('interface texts of the news area exist in both languages', () => {
  assert.deepEqual(Object.keys(newsTexts.de).sort(), Object.keys(newsTexts.en).sort());
  for (const key of Object.keys(newsTexts.en)) {
    for (const lang of LANGS) assert.ok(dictionaries[lang][key]?.trim(), `${key} (${lang})`);
  }
  for (const tag of NEWS_TAGS) assert.ok(newsTexts.en[`news.tag.${tag}`], `news.tag.${tag}`);
});

test('text helpers', () => {
  assert.equal(pick({ en: 'Hello', de: 'Hallo' }, 'de'), 'Hallo');
  assert.equal(pick({ en: 'Hello' }, 'de'), 'Hello');
  assert.equal(pick(undefined, 'en'), '');
  assert.equal(formatNewsDate('2026-11-12', 'en'), 'November 12, 2026');
  assert.equal(formatNewsDate('2026-11-12', 'de'), '12. November 2026');
  assert.equal(formatNewsDate('soon', 'en'), 'soon');
  assert.deepEqual(splitTitle('LaughTime v2 – we are back'), ['LaughTime v2', 'we are back']);
  assert.deepEqual(splitTitle('Small fixes'), ['Small fixes']);
});
