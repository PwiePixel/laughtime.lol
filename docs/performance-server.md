## Performance & API-Schutz (v2)

LaughTime v2 liefert Bilder und Clips deutlich schneller aus und sorgt dafür, dass keine der externen Quellen (GIPHY, KLIPY, Reddit, Imgflip) in ein Rate-Limit läuft – egal wie viele Leute gleichzeitig suchen oder wie oft der Server neu startet. Du musst dafür nichts einstellen, alle Werte haben sinnvolle Standards.

### Bilder in passender Größe

Der Medien-Proxy kennt jetzt zwei Varianten derselben Adresse:

| Adresse | Antwort |
| --- | --- |
| `/api/media?u=<url>` | das unveränderte Original (wird für Meme-Export und GIF-Download gebraucht) |
| `/api/media?u=<url>&w=<breite>` | verkleinerte Variante in `160`, `320`, `480`, `640`, `960` oder `1280` px |

- Andere Breiten werden auf den nächsten erlaubten Wert gerundet, vergrößert wird nie.
- Das Format richtet sich nach dem `Accept`-Header des Browsers: AVIF (bei kleinen Bildern), sonst WebP, sonst das Originalformat.
- Animierte GIFs bleiben animiert (als animiertes WebP). Klappt die Umwandlung nicht oder wäre das Ergebnis größer, kommt das Original.
- Videos ignorieren `w`; Range-Anfragen (Vorspulen) funktionieren wie bisher.
- Jede Variante wird genau einmal erzeugt und liegt danach im Cache unter `data/cache/` neben dem Original. Sie zählt zu `CACHE_MAX_MB` und wird zusammen mit dem Original aufgeräumt.
- Alle Antworten tragen `ETag`, `Last-Modified` und einen langen `Cache-Control` – der Browser lädt nichts doppelt.

### Suche ohne API-Spam

- Suchergebnisse (GIF Hunt, Tauschrunde, Studio) werden pro Suchbegriff 15 Minuten gemerkt, „nichts gefunden“ 3 Minuten.
- Suchen mehrere Leute gleichzeitig dasselbe, geht nur eine Anfrage raus.
- Fällt eine Quelle aus oder bremst sie (HTTP 429), wird sie für eine wachsende Pause übersprungen. Die Suche antwortet dann mit den übrigen Quellen und dem eigenen Vorlagen-Pool.
- Pro Stunde gehen höchstens `GIPHY_HOURLY_LIMIT` / `KLIPY_HOURLY_LIMIT` Anfragen an die APIs (Standard 90, passend zu kostenlosen Schlüsseln). **Mit einem Produktionsschlüssel kannst du die Werte hochsetzen, `0` schaltet die Grenze ab.**

### Vorlagen-Pool übersteht Neustarts

- Der Pool wird weiterhin alle 30 Minuten aufgefrischt, jetzt pro Quelle leicht versetzt.
- Eine Quelle mit Fehlern wird immer seltener probiert (5, 10, 20 … Minuten, höchstens alle 6 Stunden), statt alle 5 Minuten alles neu zu laden.
- Der letzte gute Stand liegt in `data/cache/pool.json`. Nach einem Neustart sind die Medien sofort da, ohne eine einzige API-Anfrage – auch bei einer Neustart-Schleife.
- Verbrauchte Stundenkontingente und laufende Pausen stehen in `data/cache/outbound.json` und überleben Neustarts ebenfalls.
- Beide Dateien darfst du jederzeit löschen; der Server lädt dann einmal frisch.

### Schnellere Antworten

- Häufig abgefragte öffentliche Daten (`/api/sources`, `/api/showcase`, `/api/community`, Bestenlisten, öffentliche Galerie- und Pack-Listen) werden für wenige Sekunden im Speicher gehalten und mit `ETag` beantwortet. Unveränderte Antworten kosten nur noch ein `304`.
- Persönliche Antworten (alles mit Login, `/api/me`) werden nie zwischengespeichert.
- Größere JSON-Antworten werden mit Brotli oder gzip komprimiert.
- Eigene Uploads und Vorschaubilder haben `ETag`/`304`. Sie sind immer `private` (kein Proxy oder CDN speichert sie), Beweiskopien gemeldeter Uploads samt Vorschaubild sehen nur Admins.

### Überwachung

`/api/status` hat zwei neue Schlüssel:

- `outbound` – pro Host: Anfragen, Rate-Limits (429), Wiederholungen, Fehler, Warteschlange, laufende Pause und verbrauchtes Stundenkontingent.
- `caches` – Suche (Treffer, geteilte Anfragen, Zustand der Quellen), Pool, Medien-Proxy (Cache-Größe, erzeugte Varianten, Warteschlange), API-Cache.

### Einstellungen (alle optional)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `GIPHY_HOURLY_LIMIT` | `90` | max. Anfragen pro Stunde an GIPHY (`0` = unbegrenzt) |
| `KLIPY_HOURLY_LIMIT` | `90` | max. Anfragen pro Stunde an KLIPY (`0` = unbegrenzt) |
| `IMGFLIP_HOURLY_LIMIT` | `600` | max. Seitenabrufe pro Stunde bei imgflip.com (`0` = unbegrenzt) |
| `SEARCH_CACHE_MINUTES` | `15` | wie lange Suchergebnisse gemerkt werden |
| `SEARCH_CACHE_ENTRIES` | `500` | wie viele verschiedene Suchen gemerkt werden |
| `IMAGE_VARIANTS` | `true` | verkleinerte AVIF/WebP-Varianten (`false` = immer das Original) |
| `IMAGE_AVIF` | `true` | AVIF für kleine Bilder (`false` = nur WebP, spart CPU) |
| `IMAGE_WORKERS` | `2` | gleichzeitige Bildumwandlungen (1–8) |
| `WS_COMPRESSION` | `false` | WebSocket-Nachrichten komprimieren – lohnt sich nur bei teurem Traffic |

### Tests

`npm test` prüft Such-Cache, Pool-Zeitplan und -Speicherung, Bildvarianten und HTTP-Cache gegen lokale Test-Server – es geht keine Anfrage ins Internet.
