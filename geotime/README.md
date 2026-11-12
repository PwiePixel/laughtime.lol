# GeoTime.lol (im LaughTime-Projekt)

Zweites Spiel der Spielwelt: Street-View-Bingo. Es läuft **im selben Prozess und
im selben Docker-Container wie LaughTime** – `index.js` bleibt die einzige
Startdatei. Getrennt sind: Port, Datenbank, Discord-App, Update-Kanal und
Oberfläche.

| | LaughTime | GeoTime |
|---|---|---|
| Port | `SERVER_PORT` | `PORT_GEOTIME` (+ Beta-Ports) |
| Datenbank | `data/laughtime.db` | `data/geotime.db` |
| WebSocket | `/ws` | `/geotime-ws` |
| API | `/api/…` | `/geotime-api/…` |
| Seiten | `/` … | `/geotime` (nur über den GeoTime-Port erreichbar) |
| Discord | eigene App | **eigene** App (`GEOTIME_DISCORD_*`) |

Auf laughtime.lol gibt es keinen Hinweis auf GeoTime: `proxy.js` liefert
`/geotime` nur aus, wenn die Anfrage über einen GeoTime-Port kommt – sonst 404.

## Eigene Domain einrichten

GeoTime läuft unter **geotime.lol**, nicht unter laughtime.lol/geotime. Im
Browser steht immer nur `geotime.lol/…`; dass die Seiten intern im gemeinsamen
Next.js-Build unter `/geotime` liegen, sieht man von außen nirgends.

**1. DNS:** `geotime.lol` (und optional `www`) auf die IP des Servers zeigen
lassen – dieselbe IP wie laughtime.lol.

**2. .env:**

```ini
PORT_GEOTIME=3001
GEOTIME_PUBLIC_URL=https://geotime.lol
GEOTIME_DOMAINS=www.geotime.lol
```

Danach einmal neu bauen, weil die Domain in den Seiten steckt:
`node index.js --rebuild`.

**3. Reverse Proxy** (nginx auf dem Host, vor Pterodactyl):

```nginx
server {                       # laughtime.lol -> unverändert
  server_name laughtime.lol www.laughtime.lol;
  location / {
    proxy_pass http://127.0.0.1:3000;        # SERVER_PORT
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;   # WebSocket /ws
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {                       # geotime.lol -> eigener Port
  server_name geotime.lol www.geotime.lol;
  location / {
    proxy_pass http://127.0.0.1:3001;        # PORT_GEOTIME
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;   # WebSocket /geotime-ws
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Zertifikat für beide Domains getrennt (z. B. `certbot --nginx -d geotime.lol -d
www.geotime.lol`). Mit Cloudflare davor: beide Domains als Proxy-Eintrag, SSL
auf „Full (strict)".

**Was dafür sorgt, dass nichts durcheinandergerät**

| | |
|---|---|
| fremder Host auf dem GeoTime-Port | 301 auf `GEOTIME_PUBLIC_URL` |
| `laughtime.lol/geotime` | 404, wie jede andere unbekannte Adresse |
| Kopf- und Fußzeile von LaughTime | werden auf GeoTime gar nicht erst gerendert |
| Logo, Favicon, Apple-Icon, OG-Bild | eigene Dateien aus `geotime/assets/` (LoL mit Nadel statt Emote) |
| Instanz, Port, Update-Stand | stehen nirgends auf der Seite – nur unter `/admin` mit Token |
| `robots.txt`, `sitemap.xml` | eigene, mit der eigenen Domain |
| 404- und Fehlerseiten | eigene GeoTime-Seite, nie die von LaughTime |
| Beta-Instanzen | immer `Disallow: /` in der robots.txt |

Die Kopfzeile fällt serverseitig weg: der GeoTime-Port setzt den Header
`x-geotime-instance`, und `app/layout.jsx` liefert daraufhin eine nackte Hülle
(`<html><body>{children}</body></html>`) statt Header, Footer und
Konten-Kontext. Fehlt der Header – also bei jeder normalen LaughTime-Anfrage –
läuft dort alles unverändert weiter.

Zum lokalen Testen stört die Umleitung nicht: `localhost` und IP-Adressen sind
immer erlaubt. Ganz abschalten lässt sie sich mit `GEOTIME_ENFORCE_DOMAIN=false`.

### Design

GeoTime benutzt **direkt das Design von LaughTime** – nicht nachgebaut, sondern
dieselben Dateien und dieselben Klassen: `app/globals.css`, `app/community.css`
und `app/modes.css` liegen im gemeinsamen Build, also nimmt GeoTime `.header`,
`.main-nav`, `.hero`, `.card`, `.btn`, `.input`, `.mode-tile`, `.footer` usw.
einfach mit. Kopfzeile, Startseite und Impressum sind im Aufbau 1:1 dieselben,
nur mit GeoTime-Inhalten (zwei Spielarten statt Meme-Räume, kein "Best memes").

`app/geotime/theme.css` ergänzt **nur**, was es bei LaughTime nicht gibt:
Straßenansicht, Bingo-Feld, Ratekarte, Tribunal und die Farben dafür
(Team A/B, Ampel). Keine einzige LaughTime-Datei wird verändert.

Auch die Bausteine kommen direkt von drüben: `components/Icon.jsx` für die
Zeichen, dieselbe Schrift, dieselben Abstände.

### Logo

`geotime/assets/logo-mark.svg` ist das **LoL-Logo der Spielwelt** – beide L
unverändert wie bei LaughTime, nur ist das **O die lachende Standort-Nadel**
statt des Lach-Emotes. Auf der Seite hüpft es genauso:
`components/geotime/GeoLogo.jsx` mit den Animationen in
`app/geotime/theme.css` (`.geo-anim`, eigene Kopie von `.lol-anim`).

Daraus erzeugt: `logo.png` (mit Schriftzug geotime.lol), `icon.svg`,
`icon-192.png`, `apple-icon.png`, `favicon-48.png`, `opengraph-image.png`.

### Sprache und Konten

Standardsprache ist **Englisch**, umschaltbar über EN/DE in der Kopfzeile
(`gt_lang`-Cookie, bei angemeldeten Spielern am Konto gespeichert). Die Texte
stehen in `lib/geotime/i18n.js` – eine eigene Datei, LaughTimes `lib/i18n.js`
bleibt unberührt.

GeoTime hat **eigene Konten** in der eigenen Datenbank: Benutzername, Passwort
(scrypt-Hash), Anzeigename, Sprache. Mit Konto zählen die Ergebnisse für die
Bestenliste, ohne Konto kann man trotzdem spielen. Das Impressum liegt unter
`/legal` und hat denselben Aufbau wie das von LaughTime
(`lib/geotime/legal.js`).

### Die fünf Spielarten

| | Klassisch | Bingo | GeoHunt | Deathmatch | Geo Star |
|---|---|---|---|---|---|
| Ziel | Wo bin ich? Auf der Karte tippen | Begriffe im Bild abhaken | zum Zielfoto hinlaufen | überleben | so viele Orte wie möglich |
| Punkte | nach Entfernung (bis 5000, wie bei GeoGuessr) | 100 je Feld, 500 je Reihe | nach Restzeit, erster bekommt am meisten | nach Entfernung | nach Entfernung, summiert |
| Spieler | allein oder im Raum | Team A gegen Team B | im Raum | im Raum (ab 2) | allein oder im Raum |
| Uhr | `GEOTIME_CLASSIC_SECONDS` (120) je Runde | `GEOTIME_BINGO_SECONDS` (600) | `GEOTIME_HUNT_SECONDS` (240) | wie Klassisch | `GEOTIME_STAR_SECONDS` (300) fürs ganze Spiel |
| Ende | `GEOTIME_CLASSIC_ROUNDS` (5) Runden | eine lange Runde + Tribunal | 5 Runden | wenn nur noch einer übrig ist | wenn die Uhr abläuft |

**GeoHunt** – jeder sieht oben das Zielfoto und startet 0,8–2,5 km entfernt in
der Straßenansicht. Beim Laufen sagt eine Ampel nur *wärmer/kälter*
(`Brennheiß · Heiß · Warm · Kalt · Eiskalt`) und ein Pfeil die Richtung –
**nie** die Entfernung in Metern, sonst wäre es kein Suchen mehr. Wer meint, da
zu sein, drückt „Hier!“: innerhalb von 150 m (`HUNT_RADIUS_M`) zählt es als
gefunden, und die Punkte richten sich nach der Restzeit und dem Platz.

**Deathmatch** – gespielt wird wie Klassisch, aber am Rundenende fliegt der
schlechteste Tipp raus (kein Tipp abgegeben = zuerst raus). Wer draußen ist,
sieht weiter zu, kann aber nicht mehr tippen. Vorbei ist es, wenn nur noch eine
Person übrig ist oder die Runden alle sind.

**Geo Star** – eine Uhr für alle, aber jeder bekommt eigene Orte. Tipp abgeben →
Punkte → sofort der nächste Ort, ohne auf die anderen zu warten. Wer am Ende
vorne liegt, ist der **Geo Star**.

### Woher die Straßenbilder kommen

| | Panoramax | Mapillary |
|---|---|---|
| Anmeldung | **keine** | kostenloses Konto |
| Schlüssel | **keiner** | Token in `GEOTIME_MAPILLARY_TOKEN` |
| Abdeckung | Europa sehr gut, Nordamerika und Japan gut | weltweit mehr |
| Lizenz | CC-BY-SA 4.0 | Bedingungen von Mapillary |
| Viewer | eigener 360°-Viewer (`PanoPsv.jsx`) | mapillary-js (`Pano.jsx`) |

**So ist es eingestellt:** steht kein Token in der `.env`, nimmt GeoTime
Panoramax – es läuft also sofort mit echten Straßenansichten, ohne dass
irgendwo ein Konto angelegt werden muss. Sobald ein Mapillary-Token da ist,
schaltet GeoTime automatisch um (`GEOTIME_PANO_PROVIDER` erzwingt eine Quelle:
`panoramax`, `mapillary` oder `demo`).

Bei Panoramax werden zuerst **Rundumbilder (360°)** gesucht – die sehen als
Straßenansicht am besten aus. Gibt es in mehreren Gegenden keine, tut es auch
ein normales Foto; das liegt dann unscharf vergrößert hinter sich selbst,
damit im Hochformat keine schwarzen Balken stehen.

**Der Viewer darf nicht neu aufgebaut werden.** Die Uhr im Spiel rendert die
Seite zweimal pro Sekunde neu. Hinge der Viewer an einer Funktion, die dabei
jedes Mal neu entsteht (`onView`), würde er ständig weggeworfen und neu
gestartet – man sieht dann ewig „Straßenansicht lädt…", obwohl alle Anfragen
klappen. Darum liegt die Rückmeldung in beiden Viewern hinter einer Ref
(`viewRef`), und die Effekte hängen nur an Bild-ID und Quelle.

**Laufen wie bei Street View:** Im Rundumbild liegen Pfeile auf dem Boden – in
der Richtung, in die es weitergeht, mit der Entfernung daneben. Anklicken =
dorthin laufen, Pfeiltaste nach oben läuft dorthin, wohin man gerade schaut.
Unten steht dieselbe Auswahl noch einmal als Leiste, falls ein Weg hinter einem
liegt.

**Wenn Mapillary hakt:** Zeitüberschreitungen und 500er kommen dort vor. GeoTime
versucht es dann in mehreren Gegenden erneut und holt das Bild notfalls von
Panoramax – die Runde startet also trotzdem. Welcher Viewer gebraucht wird,
steht bei jedem Bild dabei (`source`), darum klappt auch eine gemischte Partie.
Der Token gehört übrigens in die Kopfzeile der Anfrage (`Authorization: OAuth
MLY|…`) und nicht in die Adresse – so macht es `askMapillary()`.

**Laufen ohne Koordinaten:** Panoramax-Bilder laufen über den eigenen Server
(`geotime/pano.js`, Route `/geotime-api/pano/<id>`). Der Browser bekommt die
Bildadresse, die Blickrichtung und die Nachbarbilder – Letztere nur mit
*relativer* Angabe („30 m nach Nordost"). Länge und Breite bleiben auf dem
Server. Für GeoHunt schickt der Browser nur die Bild-ID; der Server schlägt die
Position nach und antwortet mit „wärmer/kälter". Bei Mapillary kennt der Viewer
die Koordinaten selbst, dort läuft es wie gehabt.

Die **Karte zum Raten** kommt von OpenFreeMap (OpenStreetMap-Daten), die
**Satellitenansicht** von Esri World Imagery – beides ohne Schlüssel. Kein
Google, keine Kosten.

Zum Ausprobieren ganz ohne Netz: `GEOTIME_PANO_PROVIDER=demo` – dann steht
statt der Straßenansicht ein Platzhalter, der Rest des Spiels läuft normal.

### Karte zum Raten

Die Karte besteht aus **Kachelbildern von Esri** (World Street Map) – Straßen
und Namen sind ins Bild gebacken. Kostenlos, kein Schlüssel, kein Konto. Eine
Satellitenansicht gibt es bewusst nicht: beim Raten hilft sie kaum und sie
lenkt nur ab.

> **Warum keine Vektorkarte?** Vektorkacheln rechnet maplibre in einem Web
> Worker aus. Next legt dessen Datei beim Bauen unter einem neuen Namen ab,
> passt aber den Import *innerhalb* der Datei nicht an – der Arbeiter stirbt
> still beim Start, die Karte fordert nie Kacheln an und bleibt als blasses
> Relief stehen. Kachelbilder brauchen keinen Arbeiter und können so nicht
> kaputtgehen. `geotime/nextassets.js` flickt den Namen trotzdem (liefert die
> Datei unter dem Namen ohne Prüfcode aus), damit eine eigene Vektorkarte über
> `GEOTIME_MAP_STYLE` weiter funktioniert.

In der Auswertung läuft von jedem Tipp eine gestrichelte Linie in Teamfarbe zur
echten Position, mit der **Entfernung als Schild in der Mitte** („1,4 km",
„230 m"). Linien und Schilder liegen als SVG über der Karte und nicht als
Kartenebene darin – so sehen sie immer gleich aus, egal wie weit der Kartenstil
geladen ist.

Der Nachweis-Kasten von maplibre ist ausgeschaltet, weil er auf dem Handy die
halbe Karte zudeckt. Die Nachweise (Panoramax, Mapillary, OpenStreetMap,
OpenFreeMap, Esri) stehen stattdessen in der Fußzeile jeder Seite und im
Impressum.

### Nach einem Verbindungsabriss

Ein Wackler im WLAN, ein Tunnel oder ein Neuladen mitten in der Runde soll das
Spiel nicht beenden:

* Jeder Spieler bekommt beim Beitreten ein Kennwort. Zusammen mit Raumcode und
  Spieler-ID steht es im `sessionStorage` des Tabs (`geotime-seat`).
* Beim Verbinden schickt der Browser zuerst `rejoin` – der Server setzt den
  Spieler zurück auf seinen Platz und schickt Raum, laufende Runde, Bild, Feld
  bzw. den eigenen Ort bei Geo Star hinterher (`sendCurrent()`).
* Ein Raum, in dem gerade niemand verbunden ist, bleibt noch **90 Sekunden**
  stehen (`GRACE_MS`), bevor er wirklich zu Ende ist.
* Fehlt trotzdem einmal das Bild, fragt der Browser alle vier Sekunden mit
  `sync` nach – statt ewig „Straßenansicht lädt…" anzuzeigen.

### Lobby und Spielseite

Beides ist im Aufbau 1:1 die Lobby von LaughTime, nur mit GeoTime-Inhalt:

* **Startseite** – wie bei LaughTime: Name, Bildchen (`AvatarPicker` von
  LaughTime) und **zwei** Kacheln, „Schnelles Spiel" und „Privates Spiel".
  Ein Klick öffnet das Auswahlfenster (`GeoGamePicker.jsx`, Klassen wie
  LaughTimes `GamePicker`) mit den Spielarten – schnell geht alles, was allein
  spielbar ist, privat alle fünf. Danach geht es direkt los bzw. in die Lobby.
  Darunter steht „So funktioniert's" in denselben drei nummerierten Karten.
* **`/play` ist nur die Runde.** Wer ohne Wahl dort landet, wird auf die
  Startseite zurückgeschickt – es gibt keine Zwischenseite mehr.
* **Lobby** (`components/geotime/GeoLobby.jsx`) – Einladungskarte mit den fünf
  Code-Kästchen, Link zum Kopieren und **Streamer-Modus** (Code und Link werden
  zu `•••••`, die Kopierknöpfe gehen weiter), Einstellungen für Spielart,
  Teamgröße und Rundenzahl (nur der Host, Nachricht `settings`), Spielerliste
  mit Bildchen und Host-Abzeichen, Startleiste.
* **Laufende Runde** – Vollbild: Kopf- und Fußzeile gehen aus. Das Spiel setzt
  dafür `geo-in-round` auf den `<body>`, der Rest steht in `theme.css`.

### Bingo am Handy und am PC

Das Feld liegt als Leiste am unteren Rand und lässt sich über die Zeile
„Bingo · x/y" ein- und ausklappen – zugeklappt sieht man die ganze
Straßenansicht. Auf großen Bildschirmen steht es rechts daneben. Die eigenen
Felder haben einen dunklen Innenrahmen, vergebene Felder die Teamfarbe, Felder
fürs Tribunal sind gelb.

Lange deutsche Begriffe werden über `lib/geotime/hyphen.js` sinnvoll getrennt
(„Bushalte-stelle" statt „Bushaltestell-e"). Die Schriftgröße richtet sich nach
der Feldgröße, damit auch das 5x5-Feld auf einem 360 Pixel breiten Handy passt.

Am PC ist das Feld eine eigene LaughTime-Karte rechts oben: heller Kasten,
dicker Rahmen, Schlagschatten, und jedes Feld noch einmal als kleine Karte
darin. Im Kopf stehen der Teamstand (A/B als Chips) und „Fertig". Der Kasten
lässt sich über den Pfeil zuklappen, wenn die Straßenansicht ganz zu sehen sein
soll.

### Betriebsansicht (Instanzen)

Instanz, Port und Update-Stand sind Betriebsdaten und stehen **nirgends auf der
öffentlichen Seite**. Zu sehen sind sie nur an zwei Stellen:

```bash
node geotime/cli.js list          # Konsole
```

und unter `https://geotime.lol/admin` – dort fragt die Seite nach dem Token aus
`GEOTIME_ADMIN_TOKEN` (liegt nur im sessionStorage des Tabs) und zeigt dann die
laufenden Instanzen, kann Betas starten und stoppen. Ohne Token zeigt die Seite
nichts, und die API gibt auch nichts heraus:

| Route | ohne Token | mit Token |
|---|---|---|
| `GET /geotime-api/status` | `{"ok":true}` | Instanz, Port, Hot-Updates |
| `GET /geotime-api/config` | Spielmodi, Rundenlänge | dasselbe |
| `GET /geotime-api/instances` | 401 | alle Instanzen |
| `POST /geotime-api/instances` | 401 | Beta starten/stoppen |

Die Seite steht in `robots.txt` auf `Disallow` und ist `noindex`. Im
Admin-Bereich von LaughTime taucht GeoTime bewusst **nicht** auf – die Projekte
bleiben auch dort getrennt.

### Links in GeoTime-Seiten

Ganz normal ohne Präfix: `<Link href="/play">`. Wer den aktuellen Pfad braucht,
nimmt `useGeoPath()` aus `components/geotime/usePath.js` statt `usePathname()` –
das liefert immer den Pfad, der im Browser steht.

## Ordner

```
geotime/
  boot.js          wird von index.js aufgerufen, startet die Instanzen
  instances.js     Instanzen = zusätzliche Ports im selben Prozess
  config.js        liest die gemeinsame .env (nur GEOTIME_*-Schlüssel)
  db.js            eigene SQLite-Datei je Instanz
  ws.js            WebSocket-Hub (überlebt Hot-Updates)
  api.js           /geotime-api/status, /config, /pano, /instances, Discord
  pano.js          Panoramax: Bilder suchen, Nachbarn, Koordinaten nachschlagen
  discord.js       Slash-Command /beta inkl. Signaturprüfung
  cli.js           Konsolenbefehle (reden per HTTP mit dem laufenden Server)
  instances.json   Ports, Beta-Regeln, Timeouts
  game/            Spiellogik – austauschbar ohne Neustart
    rooms.js       Räume, Runden, Punkte (alle fünf Spielarten)
    rules.js       Punkteformel, Bingo-Begriffe, Ampel-Schwellen (warm/kalt)
    locations.js   Gegenden + Bildsuche bei Mapillary
  api/routes.js    zusätzliche API-Routen – austauschbar ohne Neustart
  site.js          eigene Domain, eigene Dateien, robots.txt, Fehlerseiten
  nextassets.js    flickt Arbeiterdateien aus dem Next-Build (siehe Karte)
  accounts.js      eigene Konten (Passwort-Hash, Sitzungen)
  stats.js         Ergebnisse + Bestenliste
  assets/          Logo, Icons, OG-Bild (NICHT in LaughTimes public/)
  game/locations.js Fundorte + Mapillary-Suche (hot)
  updates/
    production/    Updates für die Produktionsinstanz
    beta/          Updates für Beta-Instanzen
app/geotime/       Oberfläche (theme.css ergänzt nur das Spiel)
  page.jsx         Startseite (Aufbau wie LaughTimes Startseite)
  play/            die Runde (Vollbild)
  leaderboard/     Bestenliste
  login/           Anmelden / Konto anlegen
  legal/           Impressum
  admin/           Betriebsansicht (nur mit Token)
  not-found.jsx    eigene 404-Seite
components/geotime/
  GeoHome.jsx      Startseite
  GeoGamePicker.jsx Auswahlfenster für die Spielart
  GeoLobby.jsx     Lobby (Einladung, Streamer-Modus, Einstellungen, Spieler)
  GeoHeader.jsx    Kopfzeile (LaughTime-Klassen)
  GeoFooter.jsx    Fußzeile
  GeoLogo.jsx      hüpfendes Logo (LoL mit lachender Nadel)
  PlayClient.jsx   das Spiel (alle fünf Arten)
  Pano.jsx         Straßenansicht (Mapillary)
  PanoPsv.jsx      Straßenansicht (Panoramax, eigener 360°-Viewer)
  GuessMap.jsx     Ratekarte (OpenFreeMap + Satellit, Linien, Entfernung)
  BingoBoard.jsx   Bingo-Feld über dem Bild
  HuntPanel.jsx    GeoHunt: Zielfoto, Ampel, „Hier!“
  Tribunal.jsx     Abstimmung am Rundenende
  detect.js        Ampel-Prüfung auf dem Gerät
  Leaderboard.jsx  Bestenliste
  LoginForm.jsx    Anmelden
  AdminPanel.jsx   Instanzen, Betas starten/stoppen
lib/geotime/
  format.js        Entfernungen in Meter/Kilometer
  i18n.js          Texte EN/DE
  legal.js         Impressum-Texte
  operator.js      Betreiberangaben
data/geotime.db    eigene Datenbank
```

## Starten

Nichts Zusätzliches: `node index.js` startet LaughTime und – wenn
`PORT_GEOTIME` gesetzt ist – GeoTime gleich mit. Ohne diesen Schlüssel läuft
nur LaughTime, genau wie vorher.

In Pterodactyl je eine zusätzliche **Allocation** anlegen: eine für
`PORT_GEOTIME`, je eine für die Beta-Ports aus `GEOTIME_BETA_PORTS`.

## Beta-Instanzen

Eine Beta ist ein weiterer Port im selben Prozess, mit eigener Datenbank
(`data/geotime-beta-1.db`) und eigenem Update-Kanal.

```bash
node geotime/cli.js beta          # startet beta-1 auf dem nächsten freien Port
node geotime/cli.js list
node geotime/cli.js stop beta-1
```

In Discord (eigene GeoTime-App): `/beta start`, `/beta list`, `/beta stop id:beta-1`.
Interactions Endpoint URL im Developer Portal:
`https://geotime.lol/geotime-api/discord/interactions`.
Nötig dafür: `GEOTIME_DISCORD_PUBLIC_KEY`, `GEOTIME_DISCORD_BOT_TOKEN`,
`GEOTIME_DISCORD_ADMINS`. Für die CLI: `GEOTIME_ADMIN_TOKEN`.

## Updates ohne Neustart

```
geotime/updates/production/game/rules.js   -> neue Bingo-Begriffe, sofort aktiv
geotime/updates/production/api/routes.js   -> neue API-Route, sofort aktiv
geotime/updates/production/public/bild.png -> Datei wird sofort ausgeliefert
geotime/updates/production/config/x.json   -> Konfiguration, sofort gelesen
```

Der Watcher wartet, bis die Datei fertig geschrieben ist, lädt das Modul mit
neuer Versionsnummer (umgeht den Node-Cache), ruft `onUnload`/`onLoad` auf und
übernimmt den Zustand laufender Runden. WebSockets bleiben offen; die Clients
bekommen `{"t":"update"}`. Ist eine Datei kaputt, bleibt die alte Version aktiv
und der Fehler steht in `/geotime-api/status`.

**Zurücknehmen:** Datei aus `updates/<kanal>/` einfach löschen – die Instanz
schaltet sofort wieder auf das Original in `geotime/` zurück, ebenfalls ohne
Neustart.

**Kanäle sind getrennt:** Jede Instanz hat ihre eigene Hot-Registry und ihren
eigenen Zustand. Ein Update in `updates/beta/` erreicht die Produktion nie –
auch nicht, weil beide im selben Node-Prozess laufen.

Nicht hot: die React-Seiten unter `app/geotime/` – die brauchen einen Build
(`node index.js --rebuild`). Alles, was sich oft ändert, liegt deshalb in
`geotime/game/`, `geotime/api/` oder `public/`.

## Stand

**Fertig:** fünf Spielarten spielbar (Klassisch allein und im Raum, Bingo mit
Tribunal, GeoHunt, Deathmatch, Geo Star), Straßenansicht über Mapillary, Ratekarte über OpenFreeMap, eigene
Konten mit Bestenliste, EN/DE, Design 1:1 von LaughTime inklusive Impressum,
eigene Domain mit eigenen Icons, robots.txt, Sitemap und Fehlerseiten,
Betriebsansicht unter `/admin` (nur mit Token), Instanzen (Produktion + Beta
über CLI, `/beta` und `/admin`), Hot-Updates, eigene Datenbank.

**Als Nächstes:** Discord-Activity mit Login über das Embedded App SDK, mehr
Bingo-Begriffe und Gegenden, Profilseiten, eigene Bestenlisten je Spielart.
