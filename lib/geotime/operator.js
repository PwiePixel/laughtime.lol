// Wer geotime.lol betreibt. Derselbe Betreiber wie bei LaughTime – die Daten
// kommen aus lib/operator.js, nur Name und Domain der Plattform sind eigene.
import { OPERATOR } from '@/lib/operator';

export const GEO_OPERATOR = { ...OPERATOR, platform: 'GeoTime', domain: 'geotime.lol' };
