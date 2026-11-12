## News & Changelog

Unter `/news` steht, was es Neues gibt. Der neueste Eintrag wird groß gezeigt (Hero, Highlight-Karten, Changelog), ältere Einträge folgen darunter als Zeitleiste. Jeder Eintrag hat zusätzlich eine eigene Seite (`/news/<id>`) und einen Anker (`/news#<id>`) zum Teilen. Auf der Startseite weist ein kompakter Banner unter der Spielkarte auf den neuesten Eintrag hin, und am Menüpunkt „News“ leuchtet ein kleiner Punkt, bis der Besucher den neuesten Eintrag geöffnet hat. In der Discord-Activity gibt es weder Banner noch Menüpunkt.

### Einen News-Eintrag hinzufügen

Alle Einträge stehen in `lib/news.js` im Array `NEWS` – **der neueste ganz oben**. Für eine neue Meldung reicht ein neues Objekt am Anfang des Arrays:

```js
{
  id: 'v2-1-sommer-update',        // eindeutig, nur a–z, 0–9 und Bindestriche (wird zur Adresse /news/<id>)
  date: '2027-06-01',              // ISO-Datum
  version: '2.1.0',                // zugehörige Version
  tag: 'update',                   // 'release' | 'update' | 'fix'
  title: { en: 'Summer update – new packs', de: 'Sommer-Update – neue Packs' },
  teaser: { en: 'The summer update is here', de: 'Das Sommer-Update ist da' }, // optional: kurze Zeile für den Banner auf der Startseite
  summary: { en: '…', de: '…' },   // ein bis zwei Sätze
  highlights: [
    { icon: 'package', title: { en: '…', de: '…' }, text: { en: '…', de: '…' } },
  ],
  sections: [
    {
      icon: 'zap',                 // optional
      title: { en: 'Speed', de: 'Tempo' },
      items: [
        { en: '…', de: '…' },
        { en: '…', de: '…', link: { href: '/beta', en: 'Open the beta page', de: 'Zur Beta-Seite' } }, // Link optional
      ],
    },
  ],
},
```

Gut zu wissen:

- **Beide Sprachen sind Pflicht** – jeder Text ist ein Paar `{ en, de }`.
- Steht im Titel ein Gedankenstrich (` – `), wird der Teil dahinter im Hero gelb hervorgehoben.
- **Icons** sind die Namen aus `components/Icon.jsx` (z. B. `zap`, `sparkles`, `gamepad`, `discord`, `rocket`).
- Die ersten vier Highlights werden automatisch zu den Chips im Banner auf der Startseite.
- Der Punkt am Menüpunkt „News“ erscheint bei allen Besuchern von selbst wieder, sobald ein neuer Eintrag oben steht.
- Der Hinweis „Jetzt live“ erscheint bei dem Release-Eintrag, dessen `version` zu `APP_VERSION` in `lib/version.js` passt. Der Titel dieses Eintrags muss mit dem Release-Namen (`APP_RELEASE`) beginnen.
- Feste Oberflächentexte (Überschriften, Buttons) stehen in `lib/locales/news.js`.

Danach `npm test` ausführen: Die Tests prüfen, ob jeder Text in beiden Sprachen da ist, die IDs eindeutig sind, die Daten stimmen (neuester Eintrag oben) und alle Icons existieren. Anschließend neu bauen bzw. den Server neu starten – fertig.
