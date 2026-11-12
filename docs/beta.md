## Hauptseite und Beta auf einer Instanz

Früher lief die Beta als zweite, getrennt gepflegte Installation. Ab v2 gibt es **eine Instanz und ein Backend** für beides. Jede Anfrage gehört zu einem Kanal:

- **stable** – der Normalfall.
- **beta** – wenn die Seite über einen Beta-Host aufgerufen wird (Standard: `beta.` + Host aus `PUBLIC_URL`, also `beta.laughtime.lol`) **oder** wenn der Besucher auf `/beta` „Beta beitreten“ gewählt hat (Cookie `lt_beta`, 1 Jahr).

Der Kanal schaltet nur Funktionen frei. Konten, Räume, Bestenlisten und Memes sind dieselben; Beta-Spieler und alle anderen können im selben Raum spielen.

### Was Besucher sehen

- `/beta`: Erklärung, aktueller Kanal, Schalter „Beta beitreten / Zurück zu Stable“, Liste der Funktionen und Spielmodi, die gerade in der Beta sind, Version und (optional) ein Feedback-Link.
- Im Beta-Kanal steht neben dem Logo ein kleines **BETA**-Schild.
- Beta-Hosts werden mit `X-Robots-Tag: noindex` ausgeliefert und landen nicht in Suchmaschinen.

### Einstellungen (alle optional)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `BETA_ENABLED` | `true` | `false` schaltet den Beta-Kanal komplett ab |
| `BETA_HOSTS` | `beta.<Host aus PUBLIC_URL>` | Hosts, die immer die Beta zeigen (Komma-getrennt) |
| `BETA_ACCESS` | `open` | wer beitreten darf: `open` (alle), `accounts` (nur angemeldet), `admins` (nur `ADMIN_USERNAMES`) |
| `BETA_FEEDBACK_URL` | leer | Link für Feedback auf der Beta-Seite, z. B. euer Discord-Server |
| `FEATURE_FLAGS` | leer | einzelne Funktionen umschalten, z. B. `liveStatus=stable` oder `liveStatus=off` |

### beta.laughtime.lol auf dieselbe Instanz zeigen lassen

`install.sh` trägt `beta.<domain>` automatisch als weiteren Hostnamen in denselben Cloudflare Tunnel ein (abschaltbar mit `--no-beta`). Von Hand: im Tunnel einen zweiten Hostnamen auf denselben Dienst (`http://localhost:<port>`) legen. Die App unterscheidet beide Adressen am `Host`-Header – deshalb muss `TRUST_PROXY=true` gesetzt bleiben.

Anmeldung: Die Beta-Adresse hat eigene Cookies. Wer sich dort mit Discord anmeldet, wird über die Hauptadresse geführt (dort steht die Redirect-URL der Discord-App) und mit einem einmaligen, eine Minute gültigen Code zurück zur Beta-Adresse übergeben. Im Discord Developer Portal ist dafür nichts Zusätzliches nötig.

### Eine Funktion in die Beta geben und später freischalten

1. In `lib/features.js` einen Eintrag anlegen: `meinFeature: { stage: 'beta' }`.
2. Im Code abfragen – im Browser `useApp().hasFeature('meinFeature')`, auf dem Server `requestHasFeature(req, 'meinFeature')` aus `server/channel.js`.
3. Texte für die Beta-Seite in `lib/locales/beta.js`: `beta.feature.meinFeature.title` und `.text`.
4. Freischalten für alle: `stage: 'stable'` setzen – oder ohne Code-Änderung in der `.env`: `FEATURE_FLAGS=meinFeature=stable`. Abschalten: `meinFeature=off`.

Spielmodi funktionieren genauso über `beta: true` in `GAME_MODES` (`lib/shared.js`): Solche Modi werden nur im Beta-Kanal angeboten und lassen sich nur dort starten. Zum Freischalten die Zeile `beta: true` entfernen.
