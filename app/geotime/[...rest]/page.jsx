import { notFound } from 'next/navigation';

/**
 * Alles, was es auf GeoTime nicht gibt, landet hier und zeigt die eigene
 * 404-Seite (app/geotime/not-found.jsx). Ohne diesen Auffang würde Next die
 * 404-Seite von LaughTime rendern – die gehört nicht auf geotime.lol.
 */
export default function GeotimeCatchAll() {
  notFound();
}
