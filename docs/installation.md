## Installation mit install.sh

Für einen eigenen Linux-Server (VPS, Root-Server, Raspberry Pi) gibt es `install.sh`. Ein Befehl richtet alles ein: Systempakete, Node.js, npm-Pakete, den Produktions-Build, einen Dienst mit automatischem Neustart und einen Cloudflare Tunnel, der die Instanz unter der eigenen Domain online bringt. Offene Ports, ein eigenes Zertifikat oder Nginx braucht es dafür nicht.

### Schnellstart

```bash
git clone <dein-repo> /opt/laughtime
cd /opt/laughtime
bash install.sh
```

Das Skript zeigt zuerst, was es vorhat, und fragt dann nach. Ohne Rückfragen:

```bash
bash install.sh --yes --domain example.com
```

**Voraussetzungen**

- Linux mit `bash`: Debian/Ubuntu, Fedora/RHEL/Alma/Rocky, Arch, openSUSE; Alpine nach bestem Bemühen.
- CPU: amd64, arm64 oder armhf.
- Root-Rechte oder `sudo`. Das Skript nutzt `sudo` nur, wenn es nicht als root läuft, und sagt das an.
- Für den Tunnel: Die Domain liegt bereits als Zone in deinem Cloudflare-Konto.
- Etwa 1,5 GB freier Arbeitsspeicher für den ersten Build. Bei weniger bietet das Skript eine vorübergehende Swap-Datei an.

**Tipp:** Lege das Projekt nicht unter `/root` ab, sondern z. B. unter `/opt/laughtime`. Unter `/root` kommt kein anderes Benutzerkonto an die Dateien, und die App müsste als root laufen. Das Skript warnt in diesem Fall.

### Optionen

| Option | Bedeutung |
| --- | --- |
| `-y`, `--yes` | keine Rückfragen, Standardwerte |
| `--domain <d>` | öffentliche Domain (Standard: Host aus `PUBLIC_URL` in `.env`, sonst `laughtime.lol`) |
| `--beta-domain <d>` | Beta-Adresse (Standard: `beta.<domain>`) |
| `--no-beta` | keine Beta-Adresse |
| `--no-www` | kein `www.<domain>` |
| `--port <n>` | Port der App (Standard: `SERVER_PORT` / `PORT` aus `.env`, sonst 3000) |
| `--tunnel-name <n>` | Name des Cloudflare Tunnels (Standard: `laughtime`) |
| `--no-tunnel` | keinen Tunnel einrichten (eigener Reverse-Proxy, siehe `deploy/nginx.example.conf`) |
| `--no-service` | keinen Dienst einrichten, nur installieren und bauen |
| `--pm2` | PM2 statt systemd verwenden |
| `--user <name>` | Benutzerkonto, unter dem die App läuft |
| `--no-announce` | am Ende nichts an den Discord-Webhook schicken |
| `--update` | `git pull` (nur bei sauberem Git-Checkout), Pakete neu installieren, neu bauen, neu starten |
| `--uninstall` | Dienste und Tunnel-Konfiguration entfernen; `.env` und `data/` bleiben |
| `--dry-run` | jede Aktion nur anzeigen, nichts verändern |
| `-h`, `--help` | Hilfe |

Das Skript merkt sich Domain, Port, Tunnel-Name und Benutzer in `data/install.state`. Spätere Aufrufe, auch `--update` und `--uninstall`, brauchen die Optionen deshalb nicht noch einmal.

### Was das Skript Schritt für Schritt macht

1. **System prüfen:** Distribution, CPU-Architektur, systemd ja/nein, freier Arbeitsspeicher und Plattenplatz.
2. **Systempakete:** `curl`, `ca-certificates`, `git`, `tar`, `gzip`. Installiert wird nur, was fehlt.
3. **Node.js:** Ein vorhandenes Node.js ab 22.13 wird übernommen, weil die App die eingebaute SQLite-Datenbank braucht. Sonst installiert das Skript die aktuelle LTS-Version über NodeSource. Klappt das nicht, lädt es das offizielle Paket von nodejs.org nach `/usr/local` und prüft die Prüfsumme. Danach testet es `require('node:sqlite')`.
4. **Projektdateien:**
   - Eine vorhandene `.env` wird **niemals** verändert, überschrieben, verschoben oder angezeigt, sondern nur gelesen.
   - Fehlt sie, wird `.env.example` nach `.env` kopiert (nur für den Besitzer lesbar).
   - `data/` wird angelegt. Bitte regelmäßig sichern: Dort liegen Datenbank und Uploads.
5. **Pakete und Build:** `npm ci`, danach `node index.js --build-only`. Das ist derselbe Build, den die App beim Start machen würde, deshalb startet der Dienst danach sofort.
6. **Dienst:**
   - Mit systemd wird `laughtime.service` eingerichtet (Neustart nach Absturz, Start beim Booten, Logs im Journal).
   - Ohne systemd oder mit `--pm2` läuft die App als PM2-Prozess `laughtime`.
   - Danach wartet das Skript, bis `http://127.0.0.1:<port>/api/status` antwortet.
7. **Cloudflare Tunnel:** `cloudflared` installieren, einmalig autorisieren, Tunnel anlegen, Konfiguration schreiben, DNS-Einträge setzen, Tunnel-Dienst starten, öffentliche Adresse prüfen.
8. **Zusammenfassung:** Was läuft wo, wo liegen die Logs, wie geht Update, Neustart und Deinstallation, und ob die öffentliche Adresse wirklich von dieser Instanz beantwortet wird.

Jeder Schritt prüft zuerst, was schon da ist. Du kannst das Skript jederzeit noch einmal starten. Ein zweiter Lauf startet laufende Dienste nicht neu, solange sich nichts geändert hat, es fliegt also niemand aus einer Runde. Bricht etwas ab, steht dabei, welcher Schritt es war und mit welchem Befehl es weitergeht. Das vollständige Protokoll liegt in `data/install.log`.

### Unter welchem Benutzer läuft die App?

| Aufruf | Benutzer |
| --- | --- |
| als normaler Benutzer | dieser Benutzer |
| mit `sudo` im Checkout eines Benutzers | der Besitzer des Ordners |
| als root in einem Ordner, der root gehört | Systembenutzer `laughtime` (wird angelegt, der Projektordner wird ihm übergeben) |
| als root unter `/root/…` | root, mit Warnung – besser nach `/opt/laughtime` umziehen |
| `--user <name>` | der angegebene Benutzer |

### Die Cloudflare-Autorisierung

Beim ersten Lauf muss Cloudflare den Server einmal freigeben:

1. Das Skript zeigt einen deutlich eingerahmten Link.
2. Öffne ihn in einem Browser. Das Gerät ist egal, es muss nicht der Server sein.
3. Melde dich bei Cloudflare an, wähle die Zone deiner Domain und klicke auf „Authorize“.
4. Das Skript macht von selbst weiter. Es wartet bis zu 10 Minuten.

Die Freigabe liegt danach in `~/.cloudflared/cert.pem`. Spätere Läufe überspringen den Schritt.

Der Tunnel bekommt eine eigene Konfiguration `/etc/cloudflared/<tunnel-name>.yml` und einen eigenen Dienst `cloudflared-<tunnel-name>.service`. Eine vorhandene `/etc/cloudflared/config.yml` eines anderen Tunnels bleibt unberührt. Ändert sich die Konfiguration, wird die alte Fassung mit Zeitstempel gesichert.

Hauptseite, `www` und Beta zeigen alle auf dieselbe Instanz. Die App unterscheidet sie am Host-Header. WebSockets funktionieren ohne weitere Einstellungen.

**Wichtig:**

- Hinter dem Tunnel muss `TRUST_PROXY=true` in `.env` gesetzt bleiben. Sonst haben alle Spieler dieselbe IP-Adresse (Rate-Limits, Sperren). Das Skript warnt, wenn es ausgeschaltet ist.
- `PUBLIC_URL` in `.env` sollte zur Domain passen. Das Skript ändert `.env` nicht, es weist nur darauf hin.
- Weicht die Beta-Adresse von `beta.<domain>` ab, gehört `BETA_HOSTS=<adresse>` in die `.env`.
- Ist die Domain selbst eine Subdomain (`spiel.example.com`), deckt das kostenlose Cloudflare-Zertifikat `www.spiel.example.com` und `beta.spiel.example.com` nicht ab. Dann: `--no-www --beta-domain beta-spiel.example.com`.

### Ohne Tunnel

```bash
bash install.sh --no-tunnel
```

Die App läuft dann als Dienst auf ihrem Port. Davor gehört ein eigener Reverse-Proxy. Ein Nginx-Beispiel mit den nötigen WebSocket-Headern liegt in `deploy/nginx.example.conf`.

### Update und Deinstallation

```bash
bash install.sh --update      # git pull, npm ci, Build, Neustart
bash install.sh --uninstall   # Dienste und Tunnel-Konfiguration entfernen
```

- `--update` zieht nur, wenn der Ordner ein Git-Checkout ohne lokale Änderungen ist. Sonst überspringt es den Pull und baut den vorhandenen Stand neu. Der Tunnel wird nicht angefasst.
- `--uninstall` entfernt die Dienste (systemd oder PM2), die Tunnel-Konfiguration des Skripts und seine Kopie der Tunnel-Zugangsdaten.
- **Nie gelöscht** werden `.env`, `data/`, Node.js, `cloudflared` und der Tunnel im Cloudflare-Konto. Den Tunnel löschst du mit `cloudflared tunnel delete <name>`, die DNS-Einträge im Cloudflare-Dashboard.

### Alltag

| Aufgabe | systemd | PM2 |
| --- | --- | --- |
| Logs ansehen | `sudo journalctl -u laughtime -f` | `pm2 logs laughtime` |
| Tunnel-Logs | `sudo journalctl -u cloudflared-laughtime -f` | `pm2 logs cloudflared-laughtime` |
| Neu starten (z. B. nach Änderungen an `.env`) | `sudo systemctl restart laughtime` | `pm2 restart laughtime` |
| Status | `systemctl status laughtime` | `pm2 status` |

### Wenn etwas nicht klappt

- **Vorher ansehen, was passieren würde:** `bash install.sh --dry-run`
- **Der Build bricht ab („Killed“):** Zu wenig Arbeitsspeicher. Skript erneut starten und die Swap-Datei erlauben.
- **Die App antwortet nicht:** Das Skript zeigt die letzten Log-Zeilen. Häufigste Ursache ist ein belegter Port, dann `--port <n>` verwenden.
- **Kein Link bei der Autorisierung oder Zeit abgelaufen:** Skript einfach noch einmal starten. Der Link kann auf jedem Gerät geöffnet werden.
- **„No DNS record for …“:** Die Freigabe gilt für genau eine Zone, nämlich die, die beim Login gewählt wurde. Liegt die Domain in einer anderen Zone oder einem anderen Konto, `~/.cloudflared/cert.pem` löschen, Skript neu starten und die richtige Zone wählen. Alternativ im Cloudflare-Dashboard von Hand anlegen: `CNAME <hostname> → <tunnel-id>.cfargotunnel.com` (proxied).
- **„answers, but not from this server yet“:** Die Domain wird noch von einem anderen Server beantwortet, z. B. durch einen alten DNS-Eintrag während eines Umzugs. Ein paar Minuten warten und das Skript erneut starten.
- **Die öffentliche Adresse antwortet noch nicht:** Neue DNS-Einträge brauchen manchmal ein paar Minuten. Prüfen mit `curl -I https://<domain>/api/status`.
- **Wechsel zwischen PM2 und systemd:** Erst `bash install.sh --uninstall`, dann neu installieren.

### Discord-Meldung

Ist `DISCORD_WEBHOOK_URL` in `.env` gesetzt, schickt das Skript am Ende „LaughTime v2 is live on <domain>“ (deutsch und englisch) an den Webhook. Das passiert nur, wenn die öffentliche Adresse wirklich von dieser Instanz beantwortet wird, und nur einmal pro Domain. Im interaktiven Modus fragt es vorher. Mit `--no-announce` unterbleibt die Meldung. Schlägt sie fehl, ist die Installation trotzdem in Ordnung.

### Pterodactyl

Pterodactyl funktioniert weiterhin wie bisher über `index.js` (siehe „Installation auf Pterodactyl“). `install.sh` wird dort nicht gebraucht. Neu ist nur `node index.js --build-only`: installieren und bauen wie bei einem normalen Start, aber ohne den Server zu starten.

### Dateien in `deploy/`

| Datei | Zweck |
| --- | --- |
| `laughtime.service` | systemd-Vorlage für die App |
| `cloudflared-laughtime.service` | systemd-Vorlage für den Tunnel |
| `cloudflared.example.yml` | Beispiel der Tunnel-Konfiguration |
| `nginx.example.conf` | Reverse-Proxy-Beispiel für den Betrieb ohne Tunnel |
