## Design v2: Bewegung, Tiefe und Feinschliff

Der Look von LaughTime bleibt, wie er ist: dunkles Lila, cremefarbene Karten, 3px-Konturen, harte Schatten, Gelb/Pink/Cyan/Grün, Fredoka + Anton und das hüpfende LoL-Logo. Version 2 legt Bewegung, Glas und Glow darüber.

### Was neu ist

- **Bewegung:** Karten, Listen, Dialoge, Menüs und Toasts kommen mit einer kurzen Animation ins Bild. Jeder Button reagiert auf Druck: Er sinkt wie bisher in seinen Schatten und federt zurück. Hover-Effekte gibt es nur auf Geräten mit Zeiger.
- **Seitenwechsel:** Seiten blenden weich ineinander über (View Transitions). Browser ohne diese Funktion wechseln wie bisher.
- **Glas und Glow:** Ab 961px Breite bleibt die Kopfzeile auf den Stöberseiten (Start, Memes, Bestenliste, Profil, Konto, Rechtliches) oben stehen und wird beim Scrollen zu Milchglas. In Spielräumen, im Studio und im Adminbereich scrollt sie wie bisher mit. Dialoge legen auf Desktop-Geräten einen unscharfen Schleier über die Seite, auf Handys einen einfarbigen. Hauptaktionen, der aktive Menüpunkt und Gewinner leuchten in ihrer Farbe.
- **Hintergrund:** Punkte und Farbverläufe liegen in einer festen Ebene. Auf großen Bildschirmen ziehen zwei Farbwolken langsam durchs Bild.
- **Formulare:** Passwort anzeigen/verbergen, Hinweis bei aktiver Feststelltaste, Live-Prüfung der Passwort-Wiederholung, Zeichenzähler für die Profilbeschreibung, klare Zustände für Fehler, „gültig“ und „deaktiviert“.
- **Lade- und Leerzustände:** Platzhalter mit Schimmer statt „Lädt…“, eine neue 404-Seite.
- **Barrierefreiheit:** Fokusring in Markenfarben (Cyan auf dunklem Grund, kräftiges Pink auf Karten), Dialoge halten den Fokus und geben ihn beim Schließen zurück, Avatar-Bilder und -Farben haben vorlesbare Namen, Textfarben auf Karten erreichen 4,5:1.
- **Weniger Bewegung:** Mit der Systemeinstellung „Bewegung reduzieren“ entfallen Animationen, Seitenübergänge, Konfetti und Hintergrundbewegung.

### Für Entwickler

Alle Tokens und Hilfsklassen stehen im Kommentarblock am Anfang von `app/v2.css`. Die wichtigsten:

| Zweck | Klassen / Tokens |
| --- | --- |
| Einblenden | `.v2-rise`, `.v2-pop`, `.v2-fade`, `.v2-stagger` (Kinder nacheinander) |
| Druck / Hover | `.v2-press`, `.v2-lift` |
| Glas | `.v2-glass`, `.v2-glass-bar` (mit Ersatzfarbe ohne `backdrop-filter`) |
| Glow | `.v2-glow-yellow`, `-pink`, `-cyan`, `-green`, `.v2-live-dot` |
| Ladeplatzhalter | `.skeleton`, dazu `.skeleton-text`, `.skeleton-circle`, `.skeleton-block` |
| Zahlen / Text | `.tnum` (gleich breite Ziffern), `.balance` |
| Tooltip | `data-tip="Text"` (optional `data-tip-pos="bottom"`) |
| Formulare | `.input-wrap` + `.input-action`, `.input.is-invalid`, `.input.is-valid`, `aria-invalid` |
| Bewegung | `--ease-out`, `--ease-spring`, `--ease-in`, `--dur-fast`, `--dur`, `--dur-slow`, `--stagger` |
| Abstände / Radien | `--space-1` … `--space-7`, `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius`, `--radius-pill` |
| Feste Kopfzeile | `--sticky-top` (Höhe der Kopfzeile, sonst `0px`), z. B. `top: calc(var(--sticky-top) + 12px)` |

Regeln für eigene Animationen:

- Nur `transform`, `translate`, `scale`, `rotate` und `opacity` animieren. Einzige Ausnahme ist der harte Schatten eines gedrückten Buttons.
- Hover-Effekte gehören in `@media (hover: hover)`.
- Um „Bewegung reduzieren“ muss sich niemand selbst kümmern, das erledigen `globals.css` und `v2.css` zentral.

Dialoge bekommen Fokusfalle, Escape, Fokus-Rückgabe und Schließ-Animation über den Hook `components/ui/useDialog.js`:

```jsx
const { ref, closing, close } = useDialog(onClose);

<div className={`modal-backdrop ${closing ? 'is-closing' : ''}`} onClick={close} role="presentation">
  <div ref={ref} className="card modal" role="dialog" aria-modal="true" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
    …
  </div>
</div>
```

Icons kommen weiterhin über `components/Icon.jsx`. Die Strichstärke passt sich der Größe an. Mit `label` wird ein Icon vorgelesen und bekommt einen Tooltip, ohne `label` ist es Dekoration.

Neue Umgebungsvariablen gibt es nicht.
