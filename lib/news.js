// News & changelog of laughtime.lol (plain ESM, shared by the pages, the home
// teaser and the tests).
//
// To publish something new, add ONE object at the TOP of NEWS – the /news page,
// the teaser on the start page and the "new" dot in the navigation follow by
// themselves. Every text needs both languages ({ en, de }); icon names are the
// ones mapped in components/Icon.jsx. `npm test` checks all of that.
//
//   id          unique, URL-safe (deep link: /news/<id> and /news#<id>)
//   date        ISO day, e.g. '2026-11-12'
//   version     the release this entry belongs to
//   tag         'release' | 'update' | 'fix'
//   title       headline; the part after " – " is highlighted in the hero
//   teaser      optional short headline for the banner on the start page
//   summary     one or two sentences below the headline
//   highlights  cards with icon + title + text (the first four become the chips of the teaser)
//   sections    the changelog: { title, icon (optional), items: [{ en, de, link (optional) }] }
//               link = { href, en, de } adds a link behind the item

export const NEWS_TAGS = ['release', 'update', 'fix'];

export const NEWS = [
  {
    id: 'laughtime-v2',
    date: '2026-11-12',
    version: '2.0.0',
    tag: 'release',
    title: {
      en: 'LaughTime v2 – we are back',
      de: 'LaughTime v2 – wir sind zurück',
    },
    teaser: {
      en: 'LaughTime v2 is live',
      de: 'LaughTime v2 ist live',
    },
    summary: {
      en: 'laughtime.lol is back online, rebuilt from the ground up. Same party game, same look – only faster, sharper and now at home on your phone.',
      de: 'laughtime.lol ist wieder online, von Grund auf neu gebaut. Dasselbe Partyspiel, derselbe Look – nur schneller, schärfer und jetzt auch auf deinem Handy zu Hause.',
    },
    highlights: [
      {
        icon: 'zap',
        title: { en: 'Instant images & clips', de: 'Bilder & Clips ohne Warten' },
        text: {
          en: 'Modern formats, sizes that fit your screen and smart preloading: memes and clips show up right away.',
          de: 'Moderne Formate, passende Größen und cleveres Vorladen: Memes und Clips sind sofort da.',
        },
      },
      {
        icon: 'sparkles',
        title: { en: 'Same style, more shine', de: 'Gleicher Stil, mehr Glanz' },
        text: {
          en: 'The LaughTime look you know, polished: smoother animations, glass and glow, sharper icons.',
          de: 'Der LaughTime-Look, den ihr kennt, nur aufpoliert: flüssigere Animationen, Glas und Glow, schärfere Icons.',
        },
      },
      {
        icon: 'download',
        title: { en: 'An app for your phone', de: 'Als App aufs Handy' },
        text: {
          en: 'Put LaughTime on your home screen and play in portrait, like a native app.',
          de: 'Leg dir LaughTime auf den Homescreen und spiel im Hochformat wie in einer echten App.',
        },
      },
      {
        icon: 'gamepad',
        title: { en: 'Reworked game modes', de: 'Spielmodi überarbeitet' },
        text: {
          en: 'Classic stays Classic. GIF Hunt and the Swap round were rebuilt from the ground up.',
          de: 'Classic bleibt Classic. GIF-Jagd und Tausch-Runde haben wir von Grund auf neu gemacht.',
        },
      },
      {
        icon: 'discord',
        title: { en: 'Tuned for Discord', de: 'Für Discord abgestimmt' },
        text: {
          en: 'The Discord Activity was tuned for Discord on desktop and on mobile.',
          de: 'Die Discord-Activity ist jetzt auf Discord am Desktop und am Handy abgestimmt.',
        },
      },
      {
        icon: 'rocket',
        title: { en: 'Beta built in', de: 'Beta direkt dabei' },
        text: {
          en: 'Main page and beta share one home. Opt into upcoming features on /beta.',
          de: 'Hauptseite und Beta wohnen unter einem Dach. Kommende Features schaltest du auf /beta frei.',
        },
      },
    ],
    sections: [
      {
        icon: 'party',
        title: { en: 'We are back', de: 'Wir sind zurück' },
        items: [
          {
            en: 'laughtime.lol is back online. Open the page, start a room and play.',
            de: 'laughtime.lol ist wieder online. Seite öffnen, Raum starten, losspielen.',
          },
          {
            en: 'Under the name LaughTime v2 the whole site was rebuilt: same game, new foundation.',
            de: 'Unter dem Namen LaughTime v2 haben wir die ganze Seite neu aufgebaut: gleiches Spiel, neues Fundament.',
          },
        ],
      },
      {
        icon: 'zap',
        title: { en: 'Speed', de: 'Tempo' },
        items: [
          {
            en: 'Images and clips appear instantly: they arrive in modern formats (WebP/AVIF) and in a size that fits your screen.',
            de: 'Bilder und Clips sind sofort da: Sie kommen in modernen Formaten (WebP/AVIF) und in der Größe, die zu deinem Bildschirm passt.',
          },
          {
            en: 'Smart preloading and caching make sure media is ready when you need it, instead of loading in front of you.',
            de: 'Cleveres Vorladen und Caching sorgen dafür, dass Medien bereitliegen, wenn du sie brauchst, statt erst vor deinen Augen zu laden.',
          },
          {
            en: 'Pages open noticeably snappier, on a phone as well as on a desktop.',
            de: 'Die Seiten öffnen sich spürbar flotter, am Handy genauso wie am Desktop.',
          },
          {
            en: 'The server now protects itself against API rate limits, so searches keep working at peak times.',
            de: 'Der Server schützt sich jetzt selbst vor API-Limits. Die Suche läuft deshalb auch zu Stoßzeiten weiter.',
          },
        ],
      },
      {
        icon: 'sparkles',
        title: { en: 'New look', de: 'Neuer Look' },
        items: [
          {
            en: 'Still unmistakably LaughTime: thick outlines, bold colours, hard shadows – just more polished.',
            de: 'Unverkennbar LaughTime: dicke Outlines, kräftige Farben, harte Schatten – nur eben aufpoliert.',
          },
          {
            en: 'Animations run smoother, at 60 frames per second.',
            de: 'Animationen laufen flüssiger, mit 60 Bildern pro Sekunde.',
          },
          {
            en: 'Glass and glow accents add depth without stealing the show from the memes.',
            de: 'Glas- und Glow-Akzente bringen Tiefe rein, ohne den Memes die Show zu stehlen.',
          },
          {
            en: 'Sharper icons and better feedback on every tap: you notice right away that your input landed.',
            de: 'Schärfere Icons und besseres Feedback bei jedem Tipp: Du merkst sofort, dass deine Eingabe angekommen ist.',
          },
        ],
      },
      {
        icon: 'download',
        title: { en: 'App for your phone', de: 'App fürs Handy' },
        items: [
          {
            en: 'Install LaughTime on your home screen, straight from the browser.',
            de: 'Installier dir LaughTime auf den Homescreen, direkt aus dem Browser.',
          },
          {
            en: 'On a phone it plays in portrait and feels like a native app.',
            de: 'Am Handy spielst du im Hochformat, und es fühlt sich an wie eine echte App.',
          },
          {
            en: 'If your connection drops, LaughTime tells you instead of leaving you guessing.',
            de: 'Wenn die Verbindung weg ist, sagt dir LaughTime Bescheid, statt dich raten zu lassen.',
          },
          {
            en: 'Your screen stays awake during a game.',
            de: 'Während einer Partie bleibt dein Bildschirm an.',
          },
        ],
      },
      {
        icon: 'gamepad',
        title: { en: 'Game modes', de: 'Spielmodi' },
        items: [
          {
            en: 'Classic stays the Classic you know – just faster and prettier.',
            de: 'Classic bleibt das Classic, das ihr kennt – nur schneller und hübscher.',
          },
          {
            en: 'GIF Hunt was reworked from the ground up: better flow and pacing, clearer rules, new interactions.',
            de: 'Die GIF-Jagd haben wir von Grund auf überarbeitet: besserer Ablauf, besseres Tempo, klarere Regeln, neue Interaktionen.',
          },
          {
            en: 'The Swap round got the same treatment: better flow and pacing, clearer rules, new interactions.',
            de: 'Die Tausch-Runde hat dieselbe Kur bekommen: besserer Ablauf, besseres Tempo, klarere Regeln, neue Interaktionen.',
          },
          {
            en: 'On top of that, there are new things to try in the beta.',
            de: 'Dazu kommen neue Sachen zum Ausprobieren in der Beta.',
          },
        ],
      },
      {
        icon: 'discord',
        title: { en: 'Discord', de: 'Discord' },
        items: [
          {
            en: 'The Discord Activity was tuned for Discord on desktop and on mobile.',
            de: 'Die Discord-Activity ist jetzt auf Discord am Desktop und am Handy abgestimmt.',
          },
          {
            en: 'Not on Discord? The site still works on its own in any browser.',
            de: 'Kein Discord? Die Seite läuft weiterhin eigenständig in jedem Browser.',
          },
        ],
      },
      {
        icon: 'rocket',
        title: { en: 'Main page and beta under one roof', de: 'Hauptseite und Beta unter einem Dach' },
        items: [
          {
            en: 'The main page and the beta now share one home.',
            de: 'Hauptseite und Beta wohnen jetzt unter einem Dach.',
          },
          {
            en: 'Want upcoming features early? Opt in on /beta.',
            de: 'Lust auf kommende Features? Auf /beta schaltest du sie für dich frei.',
            link: { href: '/beta', en: 'Open the beta page', de: 'Zur Beta-Seite' },
          },
        ],
      },
      {
        icon: 'settings',
        title: { en: 'Under the hood', de: 'Unter der Haube' },
        items: [
          {
            en: 'The server is now set up with a single command.',
            de: 'Der Server ist jetzt mit einem einzigen Befehl eingerichtet.',
          },
          {
            en: 'Cloudflare Tunnel is supported for bringing the site online.',
            de: 'Cloudflare Tunnel wird unterstützt, um die Seite online zu bringen.',
          },
        ],
      },
    ],
  },
];

/** the newest entry (undefined while there is no news at all) */
export const latest = () => NEWS[0];

/** one entry by its id */
export const byId = (id) => NEWS.find((entry) => entry.id === id);

/** everything except the newest entry, newest first */
export const older = () => NEWS.slice(1);

/** picks the text of a { en, de } pair; English is the fallback */
export const pick = (text, lang) => text?.[lang] ?? text?.en ?? '';

/** "2026-11-12" -> "November 12, 2026" / "12. November 2026" (UTC, so server and browser agree) */
export function formatNewsDate(iso, lang = 'en') {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

/** splits "LaughTime v2 – we are back" into ['LaughTime v2', 'we are back'] for the two-line hero title */
export function splitTitle(title) {
  const [head, ...rest] = String(title).split(' – ');
  return rest.length ? [head, rest.join(' – ')] : [head];
}
