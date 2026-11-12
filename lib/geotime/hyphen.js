/**
 * Weiche Trennstellen für die Bingo-Begriffe.
 *
 * Im kleinen 5x5-Feld auf dem Handy passen lange deutsche Wörter nicht in eine
 * Zeile. Ohne Trennhilfe bricht der Browser mitten im Wort um („Supermark|t").
 * Deshalb setzen wir ein bedingtes Trennzeichen (U+00AD) vor die üblichen
 * zweiten Wortteile – sichtbar wird es nur, wenn wirklich umgebrochen wird.
 *
 * Bewusst hier und nicht in den Spieldaten: die Begriffe bleiben sauber, und
 * neue Begriffe aus einem Hot-Update funktionieren weiter (dann eben ohne
 * Trennhilfe).
 */
const SOFT = '­';

/** häufige zweite Bestandteile deutscher Zusammensetzungen */
const PARTS = [
  'übergang', 'haltestelle', 'anlage', 'verkehr', 'gänger', 'stelle', 'kasten',
  'straße', 'strasse', 'brücke', 'garten', 'markt', 'bahn', 'platz', 'haus',
  'turm', 'bank', 'zone', 'laden', 'schild', 'punkt', 'fahrt', 'feld', 'halte',
  'gang', 'weg', 'tor',
];

/**
 * @param {string} term
 * @returns {string} derselbe Begriff mit bedingten Trennzeichen
 */
export function hyphenate(term) {
  const word = String(term || '');
  if (word.length < 9 || word.includes(' ')) return word;
  const lower = word.toLowerCase();
  const cuts = new Set();
  for (const part of PARTS) {
    let from = 1;
    for (;;) {
      const at = lower.indexOf(part, from);
      if (at === -1) break;
      // nur trennen, wenn vorne und hinten genug übrig bleibt
      if (at >= 3 && word.length - at >= 3) cuts.add(at);
      from = at + 1;
    }
  }
  if (!cuts.size) return word;
  const sorted = [...cuts].sort((a, b) => a - b);
  let out = '';
  let last = 0;
  for (const at of sorted) {
    if (at - last < 3) continue; // zu kurze Stücke bringen nichts
    out += word.slice(last, at) + SOFT;
    last = at;
  }
  return out + word.slice(last);
}
