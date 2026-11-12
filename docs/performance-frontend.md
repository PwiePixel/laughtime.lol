## Performance im Browser (v2)

LaughTime v2 lädt spürbar schneller – ohne dass du etwas einstellen musst. Es gibt keine neuen Umgebungsvariablen.

### Was passiert automatisch?

- **Keine doppelten Anfragen:** Öffentliche Daten (Live-Zahlen, Quellen, Bestenlisten, Galerie, Profile, Packs, Studio-Suche) laufen über einen kleinen Zwischenspeicher im Browser (`lib/fetchCache.js`). Gleiche Anfragen werden zusammengelegt, Antworten bleiben kurz gültig (10 Sekunden bis 5 Minuten, je nach Art) und werden im Hintergrund aufgefrischt. Wer zurück auf eine Seite geht, sieht sie sofort.
- **Pause im Hintergrund:** Regelmäßige Abfragen (Spieler online, Admin-Dashboard, Meldungen) pausieren, solange der Tab nicht sichtbar ist, und holen beim Zurückkehren sofort nach.
- **Nach jeder Änderung frisch:** Jeder Schreibzugriff (Like, Pack speichern, Meme löschen …) verwirft die betroffenen Listen automatisch. Der Zwischenspeicher lebt nur im Arbeitsspeicher des Tabs – beim Neuladen ist er leer.
- **Suche beim Tippen:** Studio-Suche, Pack-Auswahl, Admin-Nutzersuche und Galerie-Filter schicken erst eine Anfrage, wenn kurz nichts mehr getippt bzw. geklickt wird (`lib/timing.js`).
- **Bilder in passender Größe:** Bilder aus dem Medien-Proxy werden mit `&w=<Breite>` in der Größe angefordert, in der sie angezeigt werden (160, 320, 480, 640, 960 oder 1280 px; das Format wählt der Server). Uploads, GIFs und Clips bleiben unverändert. **Download und GIF-Export nutzen immer das Original.**
- **Nichts springt:** Bilder und Clips haben von Anfang an ihren festen Platz, ein dezenter Schimmer hält ihn frei, das Medium blendet weich ein. Clips laden zuerst nur ihre Metadaten und spielen nur, solange sie im Bild sind.
- **Browser-Cache:** Bilder und Schriften aus `public/` dürfen 1 Tag gecacht werden (danach 30 Tage „alte Kopie zeigen, im Hintergrund neu holen“). Dateien unter `/_next/static` sind dauerhaft cachebar, weil ihr Name sich bei jeder Änderung ändert. Im Entwicklungsmodus (`--dev`) ist das abgeschaltet.
- **Schwere Teile nur bei Bedarf:** Meme-Export samt GIF-Encoder, die Admin-Diagramme und das Discord-SDK werden erst geladen, wenn sie wirklich gebraucht werden.

### Bilder in `public/` austauschen

Wenn du ein Bild in `public/` ersetzt (z. B. ein Maskottchen in `public/images/mascots/`), danach einmal ausführen:

```bash
node scripts/optimize-assets.mjs
```

Das Skript

- fasst nur PNGs an, die die Seite wirklich verwendet (alles andere wird nur aufgelistet),
- packt PNGs verlustfrei kleiner (gleiche Pixel, kleinere Datei) und
- schreibt daneben `.avif` und `.webp` – die Seite lädt diese modernen Formate, das PNG bleibt als Fallback.

`public/banner.png` (Vorschaubild für Discord, WhatsApp & Co.) bleibt immer ein PNG mit 1200 × 630 Pixeln.

| Aufruf | Wirkung |
| --- | --- |
| `node scripts/optimize-assets.mjs` | schreibt, was fehlt oder veraltet ist |
| `node scripts/optimize-assets.mjs --force` | schreibt alles neu |
| `node scripts/optimize-assets.mjs --check` | ändert nichts, meldet nur (Exit-Code 1, wenn etwas zu tun ist) |

Die erzeugten Dateien gehören ins Repository – der Server wandelt zur Laufzeit nichts um. `npm test` prüft, ob die modernen Varianten der Maskottchen vorhanden und aktuell sind.

### Für Entwickler

```js
import { useCachedFetch, cachedGet, invalidateCache } from '@/lib/fetchCache';
import { useDebouncedValue } from '@/lib/timing';
import { mediaSrc, responsiveImage, preloadMedia, originalSrc } from '@/lib/media';

// Daten mit Cache; refreshMs pausiert automatisch im Hintergrund-Tab
const { data, loading, error, refresh } = useCachedFetch('/api/leaderboard?metric=points&period=week', { ttl: 30_000 });

// Suche beim Tippen
const term = useDebouncedValue(query, 300);

// Schreibzugriffe über api() räumen den Cache selbst auf; nur bei eigenem fetch/Upload nötig:
invalidateCache('/api/packs');

// Bildvariante, Vorladen, Original
mediaSrc(media.src, 320);            // …&w=320 (nur Proxy-Bilder, sonst unverändert)
preloadMedia(media.src, { width: 640 });
originalSrc(src);                    // immer die unveränderte Datei
```

`MemeCanvas` kennt drei neue, optionale Angaben: `priority` (das eine Bild, auf das gerade geschaut wird – lädt zuerst), `lazy` (Bild weiter unten in einer Liste) und `sizes`. Ohne diese Angaben verhält sich die Komponente wie bisher.
