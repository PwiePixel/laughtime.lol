# Hot-Updates für GeoTime

Dateien hier drin werden **ohne Neustart** von der laufenden Instanz übernommen.

```
updates/
  production/   für die Produktionsinstanz (PORT_GEOTIME)
    game/…      Spiellogik      -> Modul wird neu geladen
    api/…       API-Routen      -> Modul wird neu geladen
    public/…    Dateien         -> werden sofort ausgeliefert
    config/…    JSON            -> wird neu eingelesen
  beta/         dasselbe für Beta-Instanzen (/beta)
```

Beispiel: `updates/production/game/rules.js` mit neuen Bingo-Begriffen kopieren –
laufende Runden bleiben bestehen, das nächste Spielfeld nutzt die neue Liste.

**Update zurücknehmen:** Datei hier einfach löschen – die Instanz benutzt
sofort wieder das Original aus `geotime/`, ohne Neustart.

**Kanäle stören sich nicht:** `beta/` gilt nur für Beta-Instanzen,
`production/` nur für die Produktion – auch wenn beide im selben Prozess laufen.
