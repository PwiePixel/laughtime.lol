/**
 * GeoTime.lol – Pfade
 *
 * GeoTime lebt im LaughTime-Projekt, hat aber einen eigenen Ordner, eine eigene
 * Datenbank und eigene Update-Kanäle. LaughTime-Dateien werden nie verändert.
 *
 *   laughtime/
 *     index.js          einzige Startdatei (startet LaughTime und GeoTime)
 *     geotime/          dieser Ordner
 *     data/geotime.db   eigene Datenbank von GeoTime
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GEOTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(GEOTIME_DIR);
export const DATA_DIR = path.join(ROOT, 'data');
export const UPDATES_DIR = path.join(GEOTIME_DIR, 'updates');
/** eigene Dateien von GeoTime (Icon, OG-Bild) – liegen NICHT in LaughTimes public/ */
export const ASSETS_DIR = path.join(GEOTIME_DIR, 'assets');
export const RUNTIME_DIR = path.join(DATA_DIR, 'geotime-runtime');
