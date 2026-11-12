## LaughTime als App (PWA)

laughtime.lol lässt sich auf dem Handy wie eine App installieren: eigenes Icon auf dem Homescreen, Start ohne Browserleiste, Hochformat.

### Was Spieler davon haben

- **Installieren:** Android/Chrome zeigt nach ein paar Seitenaufrufen einen kleinen Hinweis „App installieren“ (wegklickbar, kommt frühestens nach 30 Tagen wieder und nach drei Mal gar nicht mehr). iOS/Safari bekommt die Kurzanleitung „Teilen → Zum Home-Bildschirm“. Die Seite `/install` erklärt alle Wege.
- **Schneller Start:** Programmdateien, Schriften, Logos und zuletzt gesehene Meme-Vorlagen liegen im Gerätespeicher.
- **Offline-Hinweis:** Ohne Netz erscheint eine eigene Seite mit „Erneut versuchen“ statt der Browser-Fehlermeldung.
- **Bildschirm bleibt an:** Während eines Spiels (`/room`, `/play`) geht das Display nicht aus.
- **Updates ohne Überraschung:** Eine neue Version wartet im Hintergrund; ein kleiner Hinweis bietet „Neu laden“ an. Mitten im Spiel wird nie von selbst neu geladen.
- **Handy-Feinschliff:** Sichere Bereiche (Notch, Home-Balken), größere Touch-Flächen, kein Zoom beim Tippen in Eingabefelder, kein versehentliches „Pull to refresh“ im Spiel.

In der Discord-Activity ist all das abgeschaltet – dort gibt es keinen Service Worker und keinen Installationshinweis.

### Dateien

| Datei | Zweck |
| --- | --- |
| `public/manifest.json` | Name, Farben, Icons, Kurzbefehle (Schnelles Spiel, Privates Spiel, Beste Memes), Screenshots für den Installationsdialog |
| `public/sw.js` | Service Worker (von Hand geschrieben, kein Build-Schritt) |
| `public/icons/`, `public/screenshots/` | App-Icons (normal, maskable, einfarbig) und Screenshots |
| `components/v2/PwaBoot.jsx`, `components/pwa/` | Registrierung, Installationshinweis, Update-Hinweis, Bildschirm-Sperre |
| `app/install/`, `app/offline/` | Seiten „App holen“ und „Offline“ |
| `app/pwa.css` | Handy-Anpassungen |
| `scripts/generate-icons.mjs` | erzeugt alle Icons neu aus dem Logo: `node scripts/generate-icons.mjs` |

### Was der Service Worker speichert – und was nie

- **Gespeichert:** die Offline-Seite, `/_next/static/*` und Schriften, Bilder der Seite, bis zu 120 Meme-Vorlagen aus `/api/media` (nur Bilder).
- **Nie gespeichert:** alle anderen `/api/*`-Antworten (Konten, Sitzungen, Räume, Uploads), Seiten selbst, Videos und Range-Anfragen, alles außer GET, der WebSocket, fremde Adressen.

Alle Caches alter Versionen wegwerfen: in `public/sw.js` die Konstante `VERSION` erhöhen.

### Testen

Der Service Worker läuft nur im Produktions-Build und nicht auf `localhost`. Zum Testen lokal bauen und starten (`node index.js`) und die Seite einmal mit `?pwa_debug=1` öffnen (wird auf dem Gerät gemerkt, `?pwa_debug=0` schaltet es wieder ab). `/sw.js` und `/manifest.json` werden mit `Cache-Control: no-cache` ausgeliefert, damit Browser immer die neueste Fassung holen.
