# LaughTime – laughtime.lol

Mehrspieler-Meme-Partyspiel im Stil von „Make It Meme“ – mit Bildvorlagen **und kurzen Videoclips**.
Alle Inhalte werden automatisch aus dem Internet gezogen, es muss nichts hochgeladen werden – eigene Bilder/GIFs sind aber möglich (Meme Studio, Tausch-Runde).

- Next.js 16 (App Router, `page.jsx`), React 19, ein eigener Node-Server mit WebSocket
- Nur 8 Abhängigkeiten: `next`, `react`, `react-dom`, `ws`, `sharp` (Bildvarianten), `lucide-react` (Icons), `gifenc` (GIF-Download), `@discord/embedded-app-sdk` (Discord-Activity)
- Konten, Bestenlisten und Meme-Galerie mit der **in Node.js eingebauten SQLite-Datenbank** (`node:sqlite`) – kein Datenbankserver, nichts zu kompilieren. Datei: `data/laughtime.db`
- Laufende Räume leben im Arbeitsspeicher
- Englisch als Hauptsprache, Deutsch per Umschalter (EN | DE oben rechts)
- **`install.sh` richtet einen Server mit einem Befehl ein** (Pakete, Node.js, Build, Dienst, Cloudflare Tunnel); **`index.js` startet alles** (installieren → bauen → Server starten) und reicht für Pterodactyl weiterhin allein

---

## Neu in LaughTime v2

| Bereich | Was sich getan hat | Details |
| --- | --- | --- |
| **Tempo** | Bilder in passender Größe als AVIF/WebP, Vorladen, Browser- und Server-Caches, schlankere Seiten | [Server](docs/performance-server.md) · [Browser](docs/performance-frontend.md) |
| **API-Schutz** | Such-Cache, geteilte Anfragen, Warteschlange und Stundenbudget pro Quelle, automatisches Zurückhalten bei HTTP 429 – auch für Discord | [docs/performance-server.md](docs/performance-server.md) |
| **Design** | Gleicher Look, mehr Feinschliff: flüssige Animationen, Glas und Glow, klares Feedback bei jedem Klick | [docs/design.md](docs/design.md) |
| **App fürs Handy** | Installierbar (PWA), Hochformat, Offline-Hinweis, Bildschirm bleibt im Spiel an | [docs/pwa.md](docs/pwa.md) |
| **Spielmodi** | Klassisch bleibt Klassisch; GIF-Jagd und Tausch-Runde neu aufgebaut; neuer Modus in der Beta | [So läuft ein Spiel](#so-läuft-ein-spiel) |
| **Discord** | Activity für Desktop und Handy überarbeitet, zentrale Discord-Anbindung, optionale Webhooks | [Discord-Activity](#laughtime-als-discord-activity) |
| **Eine Instanz** | Hauptseite und Beta laufen über dasselbe System (`/beta`, `beta.laughtime.lol`) | [docs/beta.md](docs/beta.md) |
| **News** | Neuigkeiten und Changelog direkt auf der Seite (`/news`) | [docs/news.md](docs/news.md) |
| **Server-Setup** | `bash install.sh` inklusive Cloudflare Tunnel | [docs/installation.md](docs/installation.md) |

Alle neuen Einstellungen sind optional und stehen am Ende der `.env.example`. Eine bestehende `.env` aus v1 funktioniert unverändert weiter.

---

## So läuft ein Spiel

Auf der Startseite gibt es zwei große Knöpfe, beide öffnen ein kleines Fenster zur **Spielauswahl** (Klassisch, GIF-Jagd, Tausch-Runde – die Tausch-Runde nur privat; auf dem Beta-Kanal zusätzlich „Eins für alle“):

- **Schnelles Spiel** – öffentliches Matchmaking (`/play?game=classic|hunt`): Zufällige Spieler werden zusammengewürfelt. Während der Suche läuft ein Ladebildschirm mit dem animierten LoL-Logo. Sobald genug Spieler da sind (Standard 4, höchstens 8), zählt ein kurzer Countdown herunter und das Spiel startet von selbst. Öffentliche Räume haben keinen Host: niemand kann Einstellungen ändern, kicken oder überspringen, und nach dem Finale startet automatisch das nächste Spiel. Wer später sucht, wird in offene öffentliche Räume mit freien Plätzen gesetzt.
- **Privates Spiel** – eigener Raum mit Link / 5-stelligem Code für Freunde.

Jede Runde läuft gleich ab: **Text schreiben → Memes bewerten → Rundenergebnis**, am Ende folgt das **Finale**.

1. Der Host (nur private Räume) wählt Spielmodus, Meme-Pack, Runden, Zeiten und Inhalte (Memes, Clips oder gemischt) und startet.
2. **Schreibphase:** Alle schreiben Texte auf ihr Bild bzw. ihren Clip und ziehen sie an die richtige Stelle. Woher das Bild kommt, hängt vom Spielmodus ab.
3. **Abstimmung:** Die Memes erscheinen nacheinander ohne Namen. Alle bewerten mit 1 bis 5 Punkten („Naja“ bis „Ich bin tot“, am Desktop auch mit den Tasten 1–5). Nach jedem Meme werden die Punkte und die **Verteilung der Stimmen** gezeigt. **Wer welches Meme gemacht hat, bleibt bis zum Ende der Runde geheim** – auch die Punkte in der Spielerleiste ändern sich erst dann, damit nichts verraten wird. Reaktionen fliegen live über das Bild.
4. **Rundenergebnis:** „Wer hat was gemacht?“ – die Namen werden nacheinander aufgedeckt, dazu die Rangliste. Wer mehrere Runden in Folge gewinnt, bekommt eine Serien-Flamme.
5. **Finale:** Das Podest steigt von Platz 3 bis 1 auf, danach folgen die besten Memes und (ab drei Mitspielern) bis zu vier Auszeichnungen.

Die Punkte eines Memes sind immer die Summe aller Bewertungen. Auf dem Handy sitzt die wichtigste Aktion (Fertig, Starten, Nochmal spielen) zusammen mit Uhr und Fortschritt in einer Leiste am unteren Rand und bleibt auch über der Bildschirmtastatur erreichbar. Die Spielerleiste zeigt live, wer sucht, wer fertig ist und wer abwesend ist – wer schon abgestimmt hat, wird nie pro Spieler angezeigt, nur die Anzahl der Stimmen.

### Spielmodus „Klassisch“

Alle bekommen eine zufällige Meme-Vorlage oder einen Clip und schreiben den lustigsten Text dazu. Mit „Neue Vorlage“ kann neu gewürfelt werden (Anzahl pro Runde einstellbar), der getippte Text bleibt erhalten. Öffentlich und privat spielbar.

**In v2 unverändert:** Regeln, Phasen, Zeiten, Punkte, Einstellungen, Standardwerte und Anonymität – ein automatischer Test (`test/game-classic.test.js`) spielt ein komplettes Spiel durch und hält genau das fest. Neu ist nur die Darstellung, die alle Modi bekommen haben (Stimmenverteilung, Serien-Flamme, Auszeichnungen, Aktionsleiste auf dem Handy).

### Spielmodus „GIF-Jagd“

Niemand bekommt eine Vorlage zugeteilt – jeder sucht sich sein GIF selbst.

- Suchwort eintippen (z. B. „wütende Katze“) oder einen der drei **Ideen-Chips** der Runde antippen. **Jede Suche bringt vier GIFs**, das erste ist vorausgewählt.
- Frühere Funde bleiben in der eigenen **Ablage**. Bis zum Abschicken kann beliebig gewechselt werden, der Text bleibt dabei stehen.
- Einmal pro Runde gibt es den **Glücksgriff**: vier zufällige GIFs, kostet keine Suche.
- Eine Suche ohne Treffer kostet nichts.
- Suchen pro Runde: in privaten Räumen 1 bis 4 oder „Standard“; öffentliche Räume nutzen immer den Server-Standard (`HUNT_SEARCHES`, Voreinstellung 2).
- Das Suchwort bleibt beim Bewerten verdeckt und wird erst mit dem Ergebnis des Memes eingeblendet.
- Gesucht wird bei Imgflip (GIF-Vorlagen, ohne Schlüssel), GIPHY und KLIPY (mit Schlüssel); über „Inhalte“ lässt sich auch auf Bilder oder gemischt umstellen. Gesperrte Wörter (`BLOCKED_WORDS`) werden abgelehnt. Gleiche Suchen werden zwischengespeichert und belasten die Anbieter nicht erneut.
- Öffentlich und privat spielbar.

### Spielmodus „Tausch-Runde“ (nur private Räume)

- **Mitbringen** (Zeit einstellbar, Standard 60 s): Jeder bringt ein Bild oder GIF mit – hochladen (PNG, JPG, GIF, WebP, max. 8 MB – per Auswählen, Ziehen oder Einfügen), suchen (höchstens 6 Suchen pro Runde) oder „Überraschung“. Die Auswahl lässt sich ändern, solange die Phase läuft. Wer nichts wählt, bekommt automatisch eine Vorlage. Sind alle fertig, wird nach 2,5 Sekunden getauscht.
- **Auswählen und beschriften:** Jeder bekommt **zwei Bilder von anderen Spielern** (nie das eigene), wählt eins und schreibt den Text dazu. Zu zweit gibt es nur ein Bild.
- **Bild-Bonus:** Wer ein eigenes Bild hochgeladen oder gesucht hat, bekommt **+1 Punkt für jede 4 oder 5**, die ein Meme mit diesem Bild erhält. Die eigene Stimme zählt dabei nicht, Überraschungsbilder bringen keinen Bonus.
- Von wem ein Bild stammt, wird erst im Rundenergebnis gezeigt. Wird dasselbe Bild zweimal beschriftet, laufen beide Memes direkt hintereinander („Gleiches Bild, zweiter Versuch“). Bilder, die niemand genommen hat, erscheinen im Rundenergebnis unter „Liegen geblieben“.
- Am besten ab 3 Spielern – zu zweit gibt es keine Auswahl und keinen Bild-Bonus.

Hochgeladene Bilder liegen nur in `data/uploads/rooms/`, sind nur für die Spieler im Raum sichtbar, landen nie in der Galerie und werden gelöscht, sobald ein neues Spiel startet oder der Raum geschlossen wird (spätestens nach 6 Stunden). Upload-Anfragen werden über Spieler-ID + Geheimnis geprüft und pro IP begrenzt.

### Spielmodus „Eins für alle“ (Beta, nur private Räume)

Alle beschriften in jeder Runde **dasselbe Bild**. Es gibt keinen Vorlagenwechsel; eigene Meme-Packs funktionieren. Ablauf und Wertung wie Klassisch, Standard-Schreibzeit 60 Sekunden. Der Modus ist nur auf dem Beta-Kanal sichtbar und erstellbar (siehe [docs/beta.md](docs/beta.md)), nicht im Schnellspiel und nicht in der Discord-Activity.

### Tempo-Regeln (GIF-Jagd, Tausch-Runde, Eins für alle – nicht Klassisch)

- **Letzte Chance:** Sind fast alle fertig (ab 3 Spielern), wird die Zeit für die Letzten verkürzt – beim Schreiben und Mitbringen nie unter die Hälfte der eingestellten Zeit, beim Bewerten auf 4 Sekunden.
- **Abwesend:** Wer eine ganze Runde nichts tut oder zwei Abstimmungen verpasst, bekommt ein Mond-Symbol, und die Runde wartet nicht mehr auf ihn. Jede Eingabe hebt das sofort wieder auf.
- **Gleichstand:** Bei gleicher Punktzahl entscheiden zuerst die gewonnenen Runden, dann das beste einzelne Meme. (Klassisch: Gleichstand bleibt wie bisher ein Unentschieden.)
- **Später einsteigen:** In GIF-Jagd und Tausch-Runde spielt man mit, wenn noch mindestens 30 Sekunden Schreibzeit übrig sind (Klassisch und Eins für alle: 15 Sekunden). Sonst schaut man die Runde zu und stimmt mit ab.

### Auszeichnungen im Finale

Ab drei Mitspielern gibt es bis zu vier Auszeichnungen. Sie bringen keine Punkte.

| Auszeichnung | Wofür | Modus |
| --- | --- | --- |
| Meme des Spiels | bestes einzelnes Meme | alle |
| On Fire | längste Serie gewonnener Runden | alle |
| Publikumsliebling | meiste Reaktionen auf die eigenen Memes | alle |
| Dauerbrenner | bester Durchschnitt | alle |
| Bester Lieferant | meister Bild-Bonus | Tausch-Runde |
| Volltreffer | bestes Meme mit nur einer Suche | GIF-Jagd |

### Streamer-Modus

Schalter in der Lobby, in der Spielerleiste (Augen-Symbol) und in den Kontoeinstellungen, gilt pro Gerät. Raum-Code und Einladungslink werden als Punkte angezeigt, der Code verschwindet auch aus der Adresszeile (`/room`, ein Neuladen führt zurück in denselben Raum) und aus dem Tab-Titel. „Link kopieren“ und „Code kopieren“ funktionieren weiterhin.

### Einladungslinks

Geteilte Raum-Links (`/room/CODE`) zeigen in Discord, WhatsApp usw. den Titel **„LaughTime – party room invite“** (ohne Code) mit dem Banner als Vorschaubild.

### Meme Studio (`/studio`)

Wie bei Make It Meme: Angemeldete Spieler suchen Vorlagen und GIFs direkt im Studio **oder laden eigene Bilder und GIFs hoch** (max. 8 MB) und sammeln sie in eigenen **Meme-Packs** (bis 20 Packs mit je 100 Memes). Das Studio steht im Kontomenü oben rechts neben „Einstellungen“.

**Freigabe:** Packs, die nur aus unseren Quellen bestehen, können sofort öffentlich sein. Packs mit eigenen Uploads kann der Ersteller sofort privat spielen; „Öffentlich“ stellt eine **Freigabe-Anfrage**. Admins (`ADMIN_USERNAMES`) prüfen die Bilder unter **`/admin`** (Link im Kontomenü) und geben frei oder lehnen mit Hinweis ab. Kommt später ein neuer Upload dazu, wird das Pack wieder privat, bis erneut freigegeben wurde. Uploads von Admins sind automatisch freigegeben. Hochgeladene GIFs werden beim Download als animiertes GIF gespeichert (Chrome/Edge; andere Browser speichern ein PNG). Das erste Pack wird automatisch angelegt. Packs sind öffentlich oder privat, haben eine eigene Seite zum Teilen (`/packs/<id>`) und lassen sich mit „Pack spielen“ direkt in einem privaten Raum starten. In der Lobby wählt der Host über „Pack wählen“ zwischen *Offiziell*, *Meine Packs* und *Community* (ab 4 Memes spielbar). Gespeichert werden nur Verweise auf die Quellen – der Server nimmt nur Einträge an, die er vorher selbst gefunden hat.

**Download:** Jedes Meme hat unten rechts einen Download-Knopf. Die Datei enthält die Texte und unten rechts das LoL-Logo von LaughTime (Bild als PNG, Clip als animiertes **GIF**). Das GIF wird direkt im Browser erstellt (Paket `gifenc`): max. 10 Sekunden, 12,5 Bilder pro Sekunde, 480 px breit, mit gemeinsamer Farbpalette gegen Flackern. Während der Erstellung zeigt der Knopf den Fortschritt in Prozent.

**Schnelles Laden:** Von jedem Upload legt der Server beim Speichern zusätzlich
eine kleine Vorschau an (`server/thumbs.js`, WebP, max. 400 px, ca. 5–10 % der
Originalgröße). Im Studio, in der Pack-Übersicht und in der Admin-Freigabe wird
nur diese Vorschau geladen – das Original erst, wenn das Meme wirklich gespielt
oder heruntergeladen wird. Vorschauen älterer Uploads entstehen beim ersten
Abruf von selbst, es muss also nichts nachgeholt werden. Adresse:
`/api/uploads/t/<ordner>/<id>.webp`. Fehlt `sharp` (kommt normalerweise mit
Next.js mit), wird einfach das Original ausgeliefert.

Die Oberfläche nutzt durchgehend SVG-Icons (Lucide) statt Emojis – auch für Avatare, Bewertungen und Reaktionen.

Weitere Details: Wiederverbinden nach Verbindungsabbruch, Host-Übergabe, Spieler entfernen, spätes Beitreten, Zuschauer-Modus, Handy-Layout.

---

## Konten, Bestenlisten & Galerie

- **Anmelden** unter `/login`: mit Benutzername + Passwort oder mit **Discord**. Gäste können weiterhin ohne Konto spielen.
- **Profil** unter `/u/<name>`: Avatar, Bio, Punkte, Siege, Siegquote, Rundensiege, Likes, bestes Spiel, Platz in der Bestenliste und die Ruhmeshalle mit den eigenen Sieger-Memes.
- **Einstellungen** unter `/account`: Anzeigename, Bio, Avatar, Passwort setzen/ändern, Discord verbinden/trennen, Konto löschen.
- **Bestenliste** unter `/leaderboard`: nach Punkten, Siegen, Rundensiegen, Likes oder Spielen – für diese Woche, diesen Monat oder insgesamt.
- **Beste Memes** unter `/memes`: Das Sieger-Meme jeder Runde wird gespeichert, wenn der Gewinner eingeloggt ist (mind. 2 Spieler, mind. 1 Stimme). **Öffentlich angezeigt wird es nur, wenn der Spieler in den Einstellungen „Meine Memes in ‚Beste Memes‘ zeigen“ einschaltet (standardmäßig aus).** Der Schalter wirkt auch rückwirkend; auf dem eigenen Profil sieht man seine Memes immer (mit Hinweis „Nur du“). Andere Konten können liken, jedes Meme hat eine eigene Seite (`/m/<id>`) zum Teilen. Memes mit Bildern aus Tausch-Runden oder nicht freigegebenen Uploads werden nie gespeichert.
- Im Spiel übernimmt ein eingeloggter Spieler automatisch Namen und Avatar seines Kontos (grüner Haken in der Lobby, Name verlinkt aufs Profil). Ergebnisse werden am Spielende gespeichert – nur für Spieler mit Konto und nur, wenn mindestens 2 Leute mitgespielt haben.
- Die Startseite zeigt die Top-Memes und Top-Spieler der Woche.

**Sicherheit:** Passwörter mit scrypt gehasht, Sitzungen als zufälliger Token (in der Datenbank nur als SHA-256-Hash) im HttpOnly-Cookie, Schutz gegen fremde Seiten (Origin-Prüfung), Rate-Limits für Login, Registrierung und Likes, gesperrte Namen wie `admin`.

**Backup:** Alles Dauerhafte steht in `data/laughtime.db` (plus `-wal`/`-shm`), `data/uploads/packs/` (eigene Uploads im Studio), `data/uploads/reports/` (Beweisbilder zu Meldungen) und `data/.moderation-salt` (siehe unten). Diese regelmäßig sichern.

### Discord-Login einrichten (optional)

1. https://discord.com/developers/applications → *New Application*
2. *OAuth2* → *Redirects* → `https://laughtime.lol/api/auth/discord/callback` eintragen (muss exakt zu `PUBLIC_URL` passen)
3. *Client ID* und *Client Secret* in die `.env` als `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`, Server neu starten
4. Der Knopf „Weiter mit Discord“ erscheint automatisch. Es wird nur die Berechtigung `identify` abgefragt (ID + Name).

---

## Admin-Bereich, Meldungen & Sperren

Benutzernamen in `ADMIN_USERNAMES` sehen im Konto-Menü den Punkt **Admin** (mit rotem Zähler, wenn etwas zu tun ist). Unter `/admin` gibt es sechs Reiter (`/admin?tab=…`):

| Reiter | Inhalt |
|---|---|
| **Übersicht** (`dashboard`) | Live-Zahlen (Spieler online, laufende Spiele, Matchmaking, offene Meldungen, aktive Sperren, Packs zur Prüfung, Konten) und Diagramme für 24 Stunden / 7 Tage / 30 Tage: Spieler online, gestartete Runden pro Spielmodus, laufende Spiele, Spielmodi, neue Konten, Meldungen. Jedes Diagramm hat Tooltips und „Als Tabelle anzeigen“. Aktualisiert sich alle 30 Sekunden. |
| **Meldungen** (`reports`) | Meldungen gruppiert nach Spieler, mit Grund, Kommentar, Raum, gemeldetem Meme/Bild, Online-Status und früheren Sperren. Direkt-Knöpfe: **Namen zurücksetzen**, **Benutzernamen zurücksetzen** (nur Konten), **Rauswerfen**, **Sperren…**, **Bannen…**, **Verwerfen**. |
| **Nutzer** (`users`) | Konten suchen, Detailansicht mit Statistiken, Sperr-Verlauf, Meldungen, denselben Knöpfen und „Konto löschen“. |
| **Banns & Sperren** (`sanctions`) | Aktive bzw. alle Banns und Sperren, jederzeit **aufheben**. |
| **Pack-Freigaben** (`packs`) | Packs mit eigenen Uploads freigeben oder ablehnen (mit Notiz). |
| **Protokoll** (`log`) | Wer hat wann was gemacht (Banns, Sperren, Aufheben, Namen zurücksetzen, Rauswürfe, Freigaben, gelöschte Konten). |

**Melden (für Spieler):** Fahne neben Spielern in der Lobby und in der Spielerleiste, „Melden“ unter Memes bei der Abstimmung (der Autor bleibt dabei geheim), in den Ergebnissen, auf Profilen und in der Galerie. Gründe: anstößiger Name, anstößiges Meme, unangemessenes Bild, Beleidigung, Spam, Sonstiges + optionaler Kommentar. Meldungen landen **nur im Admin-Bereich**, es werden keine E-Mails verschickt. Schutz: max. 8 Meldungen pro 10 Minuten, dieselbe Meldung zählt 30 Minuten lang nur einmal.

**Bann vs. Sperre** – beide mit Dauer (1 Std., 24 Std., 3 Tage, 7 Tage, 30 Tage, dauerhaft) und vorgefertigtem Grund (anstößiger Name, anstößige Inhalte, unangemessene Uploads, Beleidigung, Spam, Schummeln, Sperre umgehen, Sonstiges – bei „Sonstiges“ ist eine Notiz Pflicht). Die Notiz sieht der Spieler.

- **Bann** = komplett raus: Der Spieler fliegt sofort aus seinem Raum/der Warteschlange und sieht auf jeder Seite nur noch den Sperrhinweis (Grund, Notiz, Ende). Kein Spielen, keine Änderungen, keine Likes.
- **Sperre** = nur noch private Räume: kein Schnelles Spiel, keine Uploads (Studio + Tausch-Runde), keine Namens-/Profiländerung, keine öffentlichen Packs, seine Memes erscheinen nicht in „Beste Memes“. Oben auf der Seite steht ein Hinweis.
- **Namen zurücksetzen** setzt den Anzeigenamen auf „Player ####“ (bei Konten wird auch die Bio geleert) – live im laufenden Spiel. **Benutzernamen zurücksetzen** vergibt `player_######` (Konten).
- **Gäste** werden über ihre Browser-ID gesperrt, optional (standardmäßig an) zusätzlich über ihre IP. **IP-Sperren gelten nur für Gäste** – eingeloggte Konten im selben Netzwerk (WG, Schule, Mobilfunk) sind nie betroffen. Admins können nicht gesperrt werden.

**Datenschutz:** IP-Adressen werden nie im Klartext gespeichert, nur als HMAC-Hash. Der geheime Schlüssel dafür steht in `MODERATION_SALT` oder wird beim ersten Start zufällig in `data/.moderation-salt` erzeugt – **mitsichern**, sonst greifen bestehende IP-Sperren nach einem Umzug nicht mehr. Bearbeitete Meldungen (inkl. Beweisbilder) werden nach 90 Tagen gelöscht, der IP-Hash abgelaufener Sperren nach 90 Tagen entfernt, Statistik-Messpunkte nach 35 Tagen. Hinter einem Proxy (Nginx/Cloudflare) muss `TRUST_PROXY=true` bleiben, damit die echte Besucher-IP ankommt; ohne Proxy auf `false` stellen, sonst kann die IP gefälscht werden.

**Galerie:** Admins können außerdem jedes Meme in „Beste Memes“ löschen.

---

## LaughTime als Discord-Activity

LaughTime läuft zusätzlich **direkt in Discord** – im Sprachkanal über das Raketen-Symbol (Activities/App Launcher). Es ist dieselbe App wie die Website, mit angepasster Oberfläche. Die Website selbst lädt nichts davon: Der Activity-Code und Discords SDK stecken in eigenen Paketen, die nur im Discord-Fenster nachgeladen werden.

**So funktioniert es**

- **Ein Raum pro Call:** Alle im selben Sprachkanal, die LaughTime starten, landen automatisch im selben Raum (Discord-`instanceId`). Wer zuerst startet, ist Host. Kein Code, kein Link. Die Räume sind privat.
- **Automatische Anmeldung mit Discord:** Beim ersten Start fragt Discord einmal nach der Erlaubnis (nur `identify` und `rpc.activities.write` – beides ohne Freigabe durch Discord). Das Discord-Konto ist mit dem LaughTime-Konto verknüpft; Punkte, Profil, Banns und Sperren gelten genauso wie auf der Website.
- **Start in drei Schritten:** „Discord → Anmeldung → Raum“ wird sichtbar angezeigt. Jeder Schritt hat eine Zeitgrenze und wird bei vorübergehenden Fehlern automatisch wiederholt (1 s, 2 s, 4 s). Klappt es nicht, erscheint ein Fehlerbild mit Klartext, Fehlercode, „Nochmal versuchen“ (kurz gesperrt, damit niemand hämmert) und „Activity schließen“.
- **Neu laden ohne neue Anmeldung:** Lädt Discord das Fenster neu oder reißt die Verbindung ab, landet der Spieler wieder im selben Raum – ohne neue Rückfrage. Die Anmeldung liegt dafür im `sessionStorage` des Activity-Fensters und endet mit dem Discord-Fenster.
- **Bild-im-Bild:** Zeigt Discord die Activity nur als kleine Kachel, gibt es statt des gequetschten Spiels eine kompakte Ansicht: Phase, Runde, Restzeit, Spielerzahl und „Öffnen zum Spielen“ bzw. „Du bist dran“. Das Spiel läuft dahinter weiter.
- **Handy (iOS/Android):** Auf Telefonen wird das Hochformat festgehalten – ein Textspiel braucht die Tastatur, im Querformat bliebe kein Platz fürs Meme. Tablets bleiben frei drehbar. Safe-Areas werden beachtet, das Textfeld rutscht über die Bildschirmtastatur, Knöpfe sind mindestens 44 px groß, die Kopfzeile passt in eine Zeile.
- **Wer ist schon da?** Über dem Spiel steht, wer aus dem Call LaughTime gerade offen hat (Namen und Bilder kommen direkt aus Discord und bleiben im Fenster).
- **„Freunde einladen“** öffnet Discords Einladungsdialog; wo der nicht geht (z. B. DMs), den „Link teilen“-Dialog. Der Download-Knopf an Memes wird zu **„In Discord teilen“**.
- **Rich Presence:** Im Discord-Profil steht, was gerade läuft („Runde 2 von 5“, Spielmodus, Spielerzahl). Die Updates sind gedrosselt: nie zweimal dasselbe, höchstens eines alle 5 Sekunden.
- **Beste Memes, Bestenliste und Profile** öffnen sich in der Activity, alles andere nach Nachfrage im Browser. Kann ein älterer Discord-Client keine Links öffnen, wird die Adresse zum Abtippen angezeigt.
- **Ältere Discord-Clients:** Alle optionalen Funktionen (Sprache, Teilnehmer, Layout, Hochformat, Einladen, Teilen) haben eine Zeitgrenze und einen Ersatz – fehlt eine, startet das Spiel trotzdem.

**Einrichten im Discord Developer Portal** (dieselbe App wie der Discord-Login, also dieselbe `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`):

1. **OAuth2 → Redirects:** Der Website-Callback (`https://laughtime.lol/api/auth/discord/callback`) bleibt drin – Discord verlangt mindestens eine Redirect-URL, für die Activity selbst wird keine weitere gebraucht.
2. **Installation → Installation Contexts:** „User Install“ und „Guild Install“ anhaken.
3. **Activities → URL Mappings:** Root Mapping `PREFIX` = `/`, `TARGET` = `laughtime.lol` – **ohne** `https://`. Weitere Mappings sind nicht nötig: Alle Bilder und Clips laufen über unseren Medien-Proxy, Profilbilder der Teilnehmer kommen von Discords eigenem CDN.
   - **Beta:** Hauptseite und Beta laufen seit v2 in **einer** Instanz. Die Beta braucht deshalb kein eigenes Mapping-Ziel und keine zweite Discord-App mehr. In Discord entscheidet allein der Host des Mappings über den Kanal (das Beta-Cookie der Website zählt im Discord-Fenster nicht): Mit `laughtime.lol` läuft die Activity im stabilen Kanal. Wer Beta-Funktionen in Discord ausprobieren will, stellt das Ziel vorübergehend auf `beta.laughtime.lol` – gleicher Server, gleiche App, gleiche Konten.
4. **Activities → Settings:** „Enable Activities“ einschalten, Plattformen (Desktop/Web, iOS, Android) wählen. Discord legt dabei den Start-Befehl (Entry Point Command) an. Die Ausrichtung kann auf „unlocked“ bleiben – die Activity stellt sie auf Telefonen selbst ein.
5. **Optional, empfohlen – Bot → Token:** Token als `DISCORD_BOT_TOKEN` in die `.env`. Dann prüft der Server bei jedem Beitritt, ob die Activity-Sitzung echt ist und der Spieler wirklich darin ist. Die Antworten werden 30 Sekunden gemerkt, gleichzeitige Anfragen zusammengelegt.
6. Server neu starten. Kein neuer Build-Schritt nötig.

**„Auf Discord spielen“:** `/activity` im normalen Browser erklärt, wie man die Activity startet, und bietet „Auf Discord spielen“ (öffnet `https://discord.com/activities/<Client-ID>`) sowie „Im Browser spielen“ an. Der Knopf ist eine eigene Komponente (`components/PlayOnDiscord.jsx`) und zeigt sich nur, wenn die Activity eingeschaltet ist (`/api/activity/config`).

**Wer kann es starten?** Solange die App nicht von Discord verifiziert und für „Discovery“ freigeschaltet ist, können nur du, dein Developer-Team und eingeladene App-Tester die Activity starten – und nur in Servern mit weniger als 25 Mitgliedern.

**Technik:** Discord lädt `https://<client-id>.discordsays.com/?frame_id=…&instance_id=…` über seinen Proxy. Nur diese Adresse und `/activity` dürfen von Discord eingebettet werden (`frame-ancestors`); jede andere Adresse – auch mit angehängtem `frame_id` – bleibt gesperrt. Die Sitzung reist als `Authorization: Bearer …` bzw. als WebSocket-Subprotokoll und läuft nach 2 Tagen ab. Alle Server-Anfragen an Discord (Anmeldung, Profil, Sitzungsprüfung, Webhooks) gehen über `server/discord.js`: eine Warteschlange pro Host, Pause bei HTTP 429 (`Retry-After`), Wiederholungen nur für lesende Anfragen – ein Anmelde-Code wird nie zweimal geschickt.

**Lokal testen:** `DISCORD_API_URL` zeigt auf eine nachgebaute Discord-API, `ACTIVITY_DEV_FRAME=http://localhost:3333` erlaubt einer lokalen Testseite, `/activity` einzubetten (das SDK akzeptiert genau diese Adresse als Discord). `npm test` prüft Anmeldung, 429-Verhalten, Sitzungs-Cache, Webhooks und die Presence-Drossel gegen eine solche Attrappe.

### Discord-Webhooks (optional)

Beide sind aus, solange die Variable leer ist. Erlaubt sind nur echte Discord-Webhook-Adressen (`https://discord.com/api/webhooks/…`, auch `ptb.`/`canary.` und `discordapp.com`); alles andere wird ignoriert und einmal in der Konsole gemeldet. Die Adresse ist ein Geheimnis und wird nie ausgegeben. Ist Discord nicht erreichbar, passiert nichts weiter (eine Zeile im Log).

| Variable | Wofür |
|---|---|
| `DISCORD_WEBHOOK_URL` | Ankündigungen im Community-Kanal, z. B. nach einem Update |
| `DISCORD_MOD_WEBHOOK_URL` | Hinweis für die Moderatoren bei neuen Meldungen und Pack-Prüfungen |
| `DISCORD_WEBHOOK_LANG` | Sprache des Moderatoren-Hinweises (`en` oder `de`, Standard `en`) |

**Ankündigen** – der Server selbst schreibt beim Start nie etwas (eine Neustart-Schleife würde den Kanal fluten). Dafür gibt es ein Skript, das der Installer nach einem erfolgreichen Update aufruft:

```bash
node scripts/announce.mjs "LaughTime v2 ist da" "Neue Spielmodi!\nViel Spaß."
node scripts/announce.mjs "Titel" "Text" --url=https://laughtime.lol/news
```

- liest die `.env` wie `index.js` (echte Umgebungsvariablen gewinnen)
- dieselbe Ankündigung innerhalb von 10 Minuten wird übersprungen (`--force` schickt sie trotzdem)
- `--dry-run` prüft nur die Einstellungen, `--strict` beendet sich mit Fehlercode 1, wenn die Nachricht nicht ankam (sonst immer 0, damit ein Update nicht daran scheitert)
- `--mod-test` schickt eine Testnachricht an den Moderatoren-Kanal

**Moderatoren-Hinweis:** höchstens eine Nachricht pro Minute. Sie enthält nur Zahlen („3 neue Meldungen (2× Beleidigung, 1× Spam)“, „1 Pack wartet auf eine Prüfung“) und den Link zu `/admin` – keine Namen, keine Inhalte, keine Kommentare.

---

## Woher kommen die Inhalte?

| Quelle | Inhalt | Schlüssel nötig? |
|---|---|---|
| **Imgflip** | ~200 Bildvorlagen + ~240 GIF-Vorlagen (als MP4) | nein – läuft sofort |
| **GIPHY** | Reaktions-GIFs als MP4 | ja, kostenlos: https://developers.giphy.com/dashboard/ |
| **KLIPY** | kurze Film-/Serienclips + GIFs | ja, kostenlos: https://partner.klipy.com/api-keys |
| **Reddit** | Clips aus r/MemeVideos usw. + Vorlagen | optional (siehe unten) |

**Tenor wurde entfernt:** Google nimmt seit Januar 2026 keine neuen Tenor-API-Clients mehr an und hat die API zum 30. Juni 2026 ganz abgeschaltet. KLIPY ist der direkte Ersatz (gleiche Art von Inhalten, zusätzlich echte Kurzclips).

- Ohne Schlüssel funktioniert das Spiel schon komplett mit Imgflip.
- KLIPY-Testschlüssel erlauben 100 Anfragen pro Stunde. LaughTime braucht ca. 12 pro Stunde (alle 30 Minuten wird der Vorrat neu geladen). Vor dem Livegang in der KLIPY-Konsole einen Produktionsschlüssel beantragen.
- GIPHY und KLIPY verlangen eine Quellenangabe – die App zeigt im Footer „Powered by GIPHY / KLIPY“ an, sobald die Quelle aktiv ist.
- Reddit sperrt viele Server-IPs. Wenn in der Konsole `reddit…: HTTP 403` steht, unter https://www.reddit.com/prefs/apps eine App vom Typ **„script“** anlegen und `REDDIT_CLIENT_ID` (die Zeichenfolge unter dem App-Namen) / `REDDIT_CLIENT_SECRET` („secret“) eintragen – oder `REDDIT_ENABLED=false` setzen.
  - **redirect uri:** wird von LaughTime nicht benutzt (Anmeldung nur als App, ohne Reddit-Login der Spieler). Das Feld muss aber ausgefüllt sein – einfach `http://localhost:8080` eintragen.
  - `REDDIT_USER_AGENT` am besten mit deinem Reddit-Namen: `web:laughtime.lol:v1.0.0 (by /u/DEIN_NAME)`.
  - Seit Ende 2025 verlangt Reddit für neue API-Zugänge eine **Freigabe** (Responsible Builder Policy). Wird die App nicht sofort freigeschaltet, muss der Zugang über das Anfrageformular von Reddit beantragt werden. Reddit ist optional – das Spiel läuft auch nur mit Imgflip, GIPHY und KLIPY.

Alle Bilder und Videos laufen über den eigenen Server (`/api/media`) und werden auf der Festplatte zwischengespeichert (`data/cache`, Größe über `CACHE_MAX_MB`).
Vorteile: Die IP-Adressen der Spieler gehen nicht an Dritte (DSGVO), keine Hotlink-/CORS-Probleme, und der Download-Button funktioniert.
Dateien, die nicht geladen werden können, werden automatisch ausgetauscht.

Den Zustand aller Quellen sieht man unter **`/api/status`**.

---

## Installation auf einem eigenen Server (`install.sh`)

```bash
git clone https://github.com/PwiePixel/laughtime.lol.git
cd laughtime.lol
bash install.sh
```

Das Skript prüft das System, installiert fehlende Pakete und Node.js, legt bei Bedarf eine `.env` aus der Vorlage an (**eine vorhandene `.env` wird nie verändert**), baut die App, richtet einen Dienst mit automatischem Neustart ein (systemd, sonst PM2) und stellt die Seite über einen Cloudflare Tunnel unter `laughtime.lol`, `www.laughtime.lol` und `beta.laughtime.lol` online. Für die Freigabe der Domain zeigt es den Autorisierungs-Link von Cloudflare im Terminal an. Am Ende steht eine Statusübersicht; ist `DISCORD_WEBHOOK_URL` gesetzt, geht eine Meldung an den Discord-Kanal.

Erst ansehen, was passieren würde: `bash install.sh --dry-run`. Aktualisieren: `bash install.sh --update`. Alle Optionen, die einzelnen Schritte und Hilfe bei Problemen: **[docs/installation.md](docs/installation.md)**.

---

## Installation auf Pterodactyl

1. **Server anlegen** mit dem normalen **Node.js-Egg** (Generic Node.js).
   - Docker-Image: **Node 22** oder **Node 24** (mindestens Node 22.13 – wegen der eingebauten SQLite-Datenbank)
   - `MAIN_FILE` / Startdatei: **`index.js`**
   - RAM: mindestens **1,5 GB** für den ersten Build (danach reichen ~300 MB)
2. **Dateien hochladen:** Den Inhalt dieses Ordners (ohne `node_modules` und `.next`) ins Hauptverzeichnis `/home/container` legen.
3. **Starten.** Beim ersten Start macht `index.js` automatisch:
   - legt `.env` aus `.env.example` an
   - `npm install`
   - `next build`
   - startet den Server auf dem Port, den Pterodactyl vergibt (`SERVER_PORT`)
4. **Schlüssel eintragen:** In der Dateiverwaltung `.env` öffnen, `GIPHY_API_KEY` und `KLIPY_API_KEY` eintragen, Server neu starten.
5. Nach Code-Änderungen erkennt `index.js` das selbst und baut neu. Neubau erzwingen: `FORCE_BUILD=1` als Variable setzen oder `node index.js --rebuild`.

### Domain laughtime.lol (Reverse-Proxy)

Die Domain zeigt auf einen Nginx (oder Cloudflare/Caddy), der auf den Pterodactyl-Port weiterleitet.
**Wichtig:** WebSockets (`/ws`) brauchen die Upgrade-Header, sonst bleibt das Spiel bei „Verbinde…“ hängen.

```nginx
server {
    listen 443 ssl http2;
    server_name laughtime.lol www.laughtime.lol;
    # ssl_certificate …; ssl_certificate_key …;

    # eigene Uploads bis 8 MB (UPLOAD_MAX_MB) – sonst bricht Nginx mit "413 Request Entity Too Large" ab
    client_max_body_size 10m;

    location / {
        proxy_pass http://NODE_IP:PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

**Wichtig für Uploads:** `client_max_body_size` muss größer als `UPLOAD_MAX_MB` sein (Nginx erlaubt standardmäßig nur 1 MB). Cloudflare erlaubt im Free-Plan bis 100 MB.

Bei Cloudflare: WebSockets sind standardmäßig an. `TRUST_PROXY=true` lassen, damit die echte Besucher-IP für das Rate-Limit genutzt wird.
Wenn der Server **direkt** (ohne Proxy) erreichbar ist, `TRUST_PROXY=false` setzen.

---

## Lokal entwickeln

```bash
node index.js --dev     # mit Hot-Reload auf http://localhost:3000
node index.js           # Produktion (baut bei Bedarf)
```

Zum Testen allein: `MIN_PLAYERS=1` in der `.env` (für das schnelle Spiel `MATCH_MIN_PLAYERS=2` und zwei Browserfenster). Mehrere Spieler simuliert man mit mehreren Browsern bzw. einem privaten Fenster (der Spieler wird im Local Storage gemerkt).

---

## Einstellungen (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` / `SERVER_PORT` | 3000 | Port (Pterodactyl setzt `SERVER_PORT`) |
| `PUBLIC_URL` | https://laughtime.lol | für Vorschaubilder beim Teilen |
| `GIPHY_API_KEY` | – | GIPHY aktivieren |
| `KLIPY_API_KEY` | – | KLIPY aktivieren |
| `KLIPY_TYPES` | clips,gifs | welche KLIPY-Inhalte |
| `REDDIT_ENABLED` | true | Reddit an/aus |
| `SEARCH_TERMS` | reaction,fail,… | Suchwörter für GIPHY/KLIPY |
| `CONTENT_RATING` | pg-13 | Jugendschutzfilter (g, pg, pg-13, r) |
| `BLOCKED_WORDS` | nsfw,… | Vorlagen mit diesen Wörtern im Titel werden aussortiert |
| `MAX_VIDEO_SECONDS` | 30 | maximale Cliplänge |
| `CACHE_MAX_MB` | 800 | Größe des Medien-Caches |
| `MAX_ROOMS` | 300 | maximale Anzahl Räume |
| `MIN_PLAYERS` | 2 | Spieler zum Starten (private Räume) |
| `MATCH_MIN_PLAYERS` | 4 | Schnelles Spiel: ab so vielen Spielern startet der Countdown |
| `MATCH_MAX_PLAYERS` | 8 | Schnelles Spiel: Spieler pro öffentlichem Raum (bei so vielen startet es sofort) |
| `MATCH_WAIT_SECONDS` | 8 | Countdown, damit noch mehr Leute dazukommen |
| `MATCH_RELAX_SECONDS` | 60 | wenn so lange zu wenige suchen, reicht auch `MATCH_RELAX_PLAYERS` (0 = aus) |
| `MATCH_RELAX_PLAYERS` | 2 | Mindestzahl nach der Wartezeit |
| `HUNT_SEARCHES` | 2 | GIF-Jagd: Suchen pro Spieler und Runde |
| `UPLOAD_MAX_MB` | 8 | maximale Dateigröße für eigene Bilder/GIFs |
| `UPLOADS_PER_USER` | 200 | maximale Anzahl Uploads pro Konto (Studio) |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | – | Discord-Login aktivieren |
| `ADMIN_USERNAMES` | – | Admins (Admin-Bereich `/admin`: Übersicht, Meldungen, Sperren, Pack-Freigabe, Galerie-Memes löschen), durch Komma getrennt |
| `ACTIVITY_ENABLED` | true | Discord-Activity an/aus (braucht `DISCORD_CLIENT_ID`/`SECRET`) |
| `DISCORD_BOT_TOKEN` | – | optional: prüft Activity-Sitzungen über Discords API |
| `MODERATION_SALT` | zufällig | geheimer Schlüssel für IP-Hashes (sonst `data/.moderation-salt`) |
| `TRUST_PROXY` | true | Besucher-IP aus `X-Forwarded-For` lesen (nur hinter Nginx/Cloudflare auf `true`) |
| `COOKIE_SECURE` | false | Secure-Flag für Cookies erzwingen (hinter HTTPS-Proxy wird es automatisch erkannt) |

Neu in v2 (alle optional, Standardwerte im Code):

| Variable | Standard | Bedeutung |
|---|---|---|
| `BETA_ENABLED` | true | Beta-Kanal an/aus |
| `BETA_HOSTS` | `beta.<Host aus PUBLIC_URL>` | Hosts, die immer die Beta zeigen |
| `BETA_ACCESS` | open | wer der Beta beitreten darf: `open`, `accounts`, `admins` |
| `BETA_FEEDBACK_URL` | – | Feedback-Link auf der Beta-Seite |
| `FEATURE_FLAGS` | – | einzelne Funktionen freischalten/abschalten, z. B. `liveStatus=stable` |
| `GIPHY_HOURLY_LIMIT`, `KLIPY_HOURLY_LIMIT` | 90 | höchstens so viele API-Anfragen pro Stunde (0 = unbegrenzt; mit Produktionsschlüssel erhöhen) |
| `IMGFLIP_HOURLY_LIMIT` | 600 | Seitenabrufe pro Stunde bei imgflip.com |
| `SEARCH_CACHE_MINUTES`, `SEARCH_CACHE_ENTRIES` | 15 / 500 | wie lange und wie viele Suchergebnisse im Speicher bleiben |
| `IMAGE_VARIANTS` | true | verkleinerte AVIF/WebP-Varianten im Medien-Proxy |
| `IMAGE_AVIF` | true | AVIF für kleine Bilder (false = nur WebP, spart CPU) |
| `IMAGE_WORKERS` | 2 | gleichzeitige Bildumwandlungen (1–8) |
| `WS_COMPRESSION` | false | WebSocket-Nachrichten komprimieren |
| `DISCORD_WEBHOOK_URL` | – | Webhook für Ankündigungen (`install.sh`, `node scripts/announce.mjs "Titel" "Text"`) |
| `DISCORD_MOD_WEBHOOK_URL` | – | Webhook für Moderations-Hinweise (nur Anzahl und Kategorie, keine Namen) |
| `DISCORD_WEBHOOK_LANG` | en | Sprache der Moderations-Hinweise (`en`/`de`) |

---

## Ordnerstruktur

```
index.js                 Startdatei (auch für Pterodactyl); --build-only baut nur
install.sh               Server-Setup mit einem Befehl (Pakete, Node.js, Dienst, Cloudflare Tunnel)
deploy/                  Vorlagen: systemd-Units, cloudflared- und Nginx-Beispiel
docs/                    ausführliche Kapitel zu v2 (Installation, Performance, Design, PWA, Beta, News)
scripts/                 announce.mjs (Discord-Ankündigung), generate-icons.mjs, optimize-assets.mjs
test/                    automatische Tests (npm test)
server/
  server.js              HTTP-Server: Next.js + WebSocket + API
  api.js                 REST-API: Login, Discord, Profil, Bestenliste, Galerie, Likes, Studio/Packs, Admin
  channel.js, beta.js    Kanal einer Anfrage (stable/beta), Beta-API, Login-Übergabe an den Beta-Host
  discord.js             zentrale Discord-Anbindung (OAuth, Activity-Prüfung) mit Rate-Limit-Schutz
  webhook.js             optionale Discord-Webhooks (Ankündigungen, Moderations-Hinweise)
  moderation.js          Meldungen, Banns/Sperren, Admin-Protokoll, Statistik fürs Dashboard
  activity.js            Discord-Activity: Anmeldung per Discord, ein Raum pro Call
  matchmaking.js         Schnelles Spiel: Warteschlangen, Matches, öffentliche Räume
  packs.js               Meme Studio: Packs, eigene Uploads, Admin-Freigabe
  uploads.js             Upload-Prüfung (Dateiinhalt), Speichern & Ausliefern von Bildern/GIFs
  thumbs.js              kleine Vorschaubilder (WebP) für Studio, Packs und Admin
  accounts.js            Konten, Passwörter, Sitzungen
  stats.js               Spielergebnisse, Bestenlisten, Meme-Galerie
  db.js                  SQLite-Datenbank (node:sqlite)
  http.js                kleine HTTP-Helfer (Cookies, Rate-Limits)
  game.js, game/         Spiellogik (Räume, Runden, Abstimmung, Punkte) und die Regeln der Modi
  proxy.js               Medien-Proxy mit Festplatten-Cache und Bildvarianten (AVIF/WebP)
  config.js              liest die .env
  lib/                   outbound.js (Cache, Warteschlange, 429-Schutz für externe APIs),
                         respond.js (Micro-Cache, ETag, Kompression), work.js, sharp.js
  media/                 Quellen: imgflip.js, giphy.js, klipy.js, reddit.js, pool.js/index.js (Vorrat),
                         search.js (Freitext-Suche für GIF-Jagd und Studio)
app/
  layout.jsx             Grundgerüst, Sprache, Schriften, Kanal (stable/beta)
  page.jsx               Startseite (Schnelles Spiel / Privates Spiel)
  play/page.jsx          Matchmaking mit Ladebildschirm
  news/                  News & Changelog
  beta/page.jsx          Beta-Seite (beitreten / verlassen)
  install/, offline/     „App holen“ und Offline-Seite der Web-App
  studio/page.jsx        Meme Studio
  activity/page.jsx      Discord-Activity (auch „/“ mit frame_id, so öffnet Discord sie)
  admin/page.jsx         Admin-Bereich: Übersicht, Meldungen, Spieler, Sperren, Pack-Freigabe, Protokoll
  room/page.jsx          Raum ohne Code in der Adresszeile (Streamer-Modus)
  packs/[id]/page.jsx    öffentliche Pack-Seite
  room/[code]/page.jsx   Spielraum
  login/page.jsx         Anmelden / Registrieren
  account/page.jsx       Kontoeinstellungen
  u/[username]/page.jsx  öffentliches Profil
  leaderboard/page.jsx   Bestenliste
  memes/page.jsx         Galerie der besten Memes
  m/[id]/page.jsx        einzelnes Meme
  legal/page.jsx         Impressum, Haftungsausschluss & Datenschutz
  globals.css            Design (Spiel)
  community.css          Design (Navigation, Konten, Bestenliste, Galerie)
  modes.css              Design (Spielauswahl, Matchmaking, GIF-Jagd, Studio)
  v2.css                 v2: Tokens und Hilfsklassen (Bewegung, Glas, Glow) – oben dokumentiert
  modes-v2.css, news.css, pwa.css, beta.css, activity.css, media.css   v2-Bereiche
  icon.svg, apple-icon.png
  fonts/                 Fredoka + Anton (lokal, SIL OFL)
components/              Lobby, Schreibphase, Abstimmung, Rangliste, Finale, Meme-Anzeige,
                         Melden (ReportDialog), Sperrhinweis (SanctionGate) …
  admin/                 Dashboard + Diagramme (Charts.jsx), Meldungen, Spieler, Sperren, Protokoll
  game/                  Bausteine der Spielansichten (v2)
  news/, beta/, pwa/, ui/, v2/   News, Beta-Seite, Web-App, Dialog-Helfer, v2-Einstiegspunkte
lib/                     Übersetzungen (i18n.js + locales/), Betreiber (operator.js), Rechtstexte
                         (legal.js, Ergänzungen in legal-v2.js), gemeinsame Regeln (shared.js),
                         Kanäle & Feature-Schalter (features.js), News-Inhalte (news.js),
                         Browser-Cache (fetchCache.js), Bildvarianten (media.js), WebSocket-Hook, Download
public/                  Logo, Banner, manifest.json, sw.js (Service Worker), icons/, screenshots/
```

## Logo & Banner

`public/logo.svg` (mit Schriftzug), `public/logo-mark.svg` („LoL“ allein), `public/logo.png` (transparent) und `app/icon.svg` (App-Icon).
Eigenes Design im verspielten Party-Stil – das „o“ ist ein lachendes Gesicht.
`public/logo-mark.png` wird als kleines, leicht durchsichtiges Wasserzeichen (ca. 14 % der Bildbreite, max. 180 px, 78 % Deckkraft) unten rechts in heruntergeladene Memes gezeichnet – anpassbar in `lib/exportMeme.js` (`prepareWatermark`, `WATERMARK_ALPHA`).

Auf der Startseite ist das Logo als animiertes SVG eingebaut (`components/LolLogo.jsx`): jeder Buchstabe hüpft einzeln mit Squash & Stretch, das lachende Gesicht wackelt, die Sterne funkeln, und beim Drüberfahren macht ein Buchstabe einen Extra-Sprung. Die Animationen stehen in `app/community.css` (`.lol-anim`) und werden bei „Bewegung reduzieren“ im System automatisch abgeschaltet. Außerdem ist das Logo direkt ins Design eingebaut (Logo, Schriftzug laughtime.lol und Slogan als echte Seitenelemente).
`public/banner.png` (1200 × 630) ist das Vorschaubild beim Teilen (Open Graph / Twitter-Meta-Tags).

## Rechtliches

- Plattform: **LaughTime**, Betreiber: **OnYourSite** (Phoenix, Arizona, USA, contact@on-your.site). Die Angaben stehen zentral in `lib/operator.js` und erscheinen auf `/legal`.
- Die Texte für Impressum, Haftungsausschluss und Datenschutz (Englisch + Deutsch) liegen in `lib/legal.js`. Die Ergänzungen zu v2 (Web-App/Offline-Speicher, Beta-Cookie, Cloudflare, Discord) stehen getrennt in `lib/legal-v2.js` und erscheinen auf `/legal` als eigener Abschnitt unter dem bestehenden Text – `lib/legal.js` selbst ist unverändert. Sie beschreiben, was die App tatsächlich macht (kein Tracking, ein Sprach-Cookie, Medien über den eigenen Server). Bitte trotzdem von jemandem prüfen lassen, der sich damit auskennt.
- Meme-Vorlagen und Clips gehören ihren Rechteinhabern. Die Nutzungsbedingungen von GIPHY, KLIPY und Reddit gelten.
- Schriften: Fredoka und Anton unter SIL Open Font License (`app/fonts/OFL.txt`). Icons: Lucide (ISC-Lizenz).
