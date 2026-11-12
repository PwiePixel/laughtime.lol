/**
 * Zahlen fürs Auge – Entfernungen in Meter/Kilometer.
 *
 * Deutsch schreibt 1.234,5 km, Englisch 1,234.5 km. Deshalb hängt die
 * Schreibweise an der eingestellten Sprache und nicht an der des Browsers.
 */

/** @param {number} km @param {'de'|'en'} lang */
export function distanceText(km, lang = 'de') {
  if (!Number.isFinite(km)) return '–';
  const loc = lang === 'de' ? 'de-DE' : 'en-US';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
  if (km < 100) return `${km.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  return `${Math.round(km).toLocaleString(loc)} km`;
}
