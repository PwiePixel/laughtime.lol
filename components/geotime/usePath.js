'use client';

/**
 * GeoTime.lol – Pfad der aktuellen Seite
 *
 * Achtung, kleiner Stolperstein: GeoTime ist nach außen eine eigene Domain
 * (geotime.lol/play), intern liegen die Seiten im gemeinsamen Build aber unter
 * /geotime/play. `usePathname()` liefert deshalb je nach Situation das eine
 * oder das andere. Dieser Haken gibt immer das zurück, was im Browser steht.
 *
 *   const path = useGeoPath();   // "/play", nie "/geotime/play"
 *
 * Links werden ganz normal ohne Präfix geschrieben: <Link href="/play">.
 */
import { usePathname } from 'next/navigation';

/** internes Präfix entfernen: "/geotime/play" -> "/play" */
export const geoPath = (pathname) => String(pathname || '/').replace(/^\/geotime(?=\/|$)/, '') || '/';

export function useGeoPath() {
  return geoPath(usePathname());
}
