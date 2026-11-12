// Legal notice, disclaimer and privacy text for /legal (English + German).

export const LEGAL = {
  en: {
    title: 'Legal Notice & Privacy',
    contactTitle: 'Contact Information',
    labels: {
      platform: 'Platform Name',
      operator: 'Operator',
      location: 'Location / Jurisdiction',
      email: 'Primary Email',
    },
    note:
      'Please note: LaughTime is operated by OnYourSite strictly as an independent, non-commercial hobbyist service. We do not sell physical goods or digital assets, and we do not charge for playing the game. Therefore, under applicable jurisdiction, a physical address is not provided.',
    sections: [
      {
        title: 'General Disclaimer',
        paragraphs: [
          'All information and services on LaughTime are provided "as is" and without any warranties of any kind, whether express or implied. LaughTime does not warrant or guarantee that the game will be error-free, constantly available, or completely secure against unauthorized access or malicious attacks.',
          'We explicitly disclaim any liability for damages, whether direct, indirect, incidental, or consequential, arising from the use or inability to use this platform. Use of LaughTime is entirely at your own risk.',
        ],
      },
      {
        title: 'Liability for User-Generated Content',
        paragraphs: [
          'LaughTime lets players choose a nickname and write captions that are shown to the other players in the same game room. Players with an account also have a public profile, and the winning meme of each round they win is published in the public gallery, where other users can like it.',
          'We do not pre-screen, monitor, or endorse the names, profile texts and captions entered by players. Therefore, we cannot assume any liability for this content. Each player is solely legally responsible for the content they publish. Players can delete their own memes and their whole account at any time.',
          'If we are made aware of any concrete legal violations (such as copyright infringement, hate speech, or illicit material), we will promptly investigate and remove or block the offending content or player without prior notice. Please use our contact email to report any such violations.',
        ],
      },
      {
        title: 'Third-Party Content & External Links',
        paragraphs: [
          'Meme templates and short clips are loaded automatically from third-party services (Imgflip, GIPHY, KLIPY and Reddit). They remain the property of their respective owners, and the terms of these services apply. If you want specific content to be removed from the game, please contact us.',
          'LaughTime contains links to external third-party websites, for example to the media sources in the footer. We have no control over the content or security of these external sites. As such, we cannot assume any liability for the content or privacy practices of these linked sites. The provider or operator of the respective external site is always responsible for its content. A permanent control of the linked pages is unreasonable without concrete evidence of a violation of the law.',
        ],
      },
      {
        title: 'Copyright & Trademarks',
        paragraphs: [
          'The overall design, architecture, branding (including the LaughTime logo), and structural code of LaughTime are protected by copyright law. Reproduction, editing, distribution, or any kind of exploitation outside the limits of copyright law require the written consent of OnYourSite.',
          'Captions written by players remain the intellectual property of the respective player. Furthermore, players are strictly prohibited from using brand names or trademarks owned by third parties as their nickname in order to impersonate others. We reserve the right to remove such players from the game.',
        ],
      },
      {
        title: 'Privacy',
        paragraphs: [
          'You can play as a guest without an account. Guest nicknames and avatars are stored only in your browser (local storage) and on the game server for as long as your game room exists. Rooms are deleted automatically a few minutes after everyone has left.',
          'If you create an account, we store your username, display name, avatar, profile text, a securely hashed password (scrypt – we never see your password), your game results (points, wins, rounds), the memes you won rounds with, including likes, and the meme packs you build in the Meme Studio (name, description, links to the chosen templates and GIFs and the pictures you upload yourself). Your profile and statistics are public; your round-winning memes only if you switch on “Show my memes”. Packs with your own uploads are only public after an admin approved them. Pictures uploaded during a swap round are only shown to the players of that room and are deleted when the game or room ends. Only upload pictures you are allowed to use. If you log in with Discord, we only receive your Discord user ID and name (scope "identify"); the Discord privacy policy applies to the login on their side. If you play LaughTime as a Discord Activity, you are logged in the same way with your Discord account; Discord forwards the game through its own proxy, so we do not see your IP address there, and we use your Discord language setting and show your game status (round, game mode, number of players) in Discord.',
          'You can change your data in the account settings and delete your account at any time – this removes your profile, statistics, memes and likes immediately.',
          'Cookies: one cookie stores your language choice; when you log in, a session cookie keeps you logged in (30 days, HttpOnly); during a Discord login a short-lived security cookie is used. There is no tracking and there are no ads.',
          'Meme templates and clips are loaded through our own server, so your browser does not connect to Imgflip, GIPHY, KLIPY or Reddit and your IP address is not shared with them.',
          'The web server processes technically necessary data such as your IP address to deliver the website and to prevent abuse (rate limiting). Your IP address is never stored in plain text.',
          'Reports and moderation: you can report players, names and memes. We store the report (reason, optional comment, the reported name, the meme or picture concerned, the room code and a copy of a reported swap-round picture), who sent it and a one-way hash of the IP addresses involved, so our team can check it in the admin area – there are no emails. Handled reports and their pictures are deleted after 90 days. If a player is banned or restricted, we store the reason, the duration and, for guests, the browser ID and the IP hash so the block cannot be avoided by picking a new name; the IP hash is removed 90 days after the block has ended. IP blocks only ever affect guests, never logged-in accounts. We also keep anonymous usage counts (players online, rounds per game mode) for our statistics.',
          'For any privacy questions, please contact us by email.',
        ],
      },
    ],
  },
  de: {
    title: 'Impressum & Datenschutz',
    contactTitle: 'Kontaktinformationen',
    labels: {
      platform: 'Name der Plattform',
      operator: 'Betreiber',
      location: 'Standort / Gerichtsstand',
      email: 'E-Mail',
    },
    note:
      'Hinweis: LaughTime wird von OnYourSite ausschließlich als unabhängiges, nicht-kommerzielles Hobbyprojekt betrieben. Wir verkaufen keine physischen Waren oder digitalen Güter und verlangen kein Geld für das Spiel. Nach dem geltenden Recht wird deshalb keine Postanschrift angegeben.',
    sections: [
      {
        title: 'Allgemeiner Haftungsausschluss',
        paragraphs: [
          'Alle Informationen und Dienste auf LaughTime werden „wie besehen“ und ohne jegliche ausdrückliche oder stillschweigende Gewährleistung bereitgestellt. LaughTime garantiert nicht, dass das Spiel fehlerfrei, jederzeit verfügbar oder vollständig vor unbefugtem Zugriff oder Angriffen geschützt ist.',
          'Wir schließen ausdrücklich jede Haftung für direkte, indirekte, zufällige oder Folgeschäden aus, die aus der Nutzung oder der Nichtverfügbarkeit dieser Plattform entstehen. Die Nutzung von LaughTime erfolgt auf eigenes Risiko.',
        ],
      },
      {
        title: 'Haftung für Inhalte der Spieler',
        paragraphs: [
          'Bei LaughTime wählen Spieler einen Namen und schreiben Texte, die den anderen Spielern im selben Raum angezeigt werden. Spieler mit Konto haben zusätzlich ein öffentliches Profil, und das Sieger-Meme jeder Runde, die sie gewinnen, wird in der öffentlichen Galerie veröffentlicht, wo andere es liken können.',
          'Wir prüfen, überwachen oder billigen die von Spielern eingegebenen Namen, Profiltexte und Meme-Texte nicht vorab. Deshalb können wir für diese Inhalte keine Haftung übernehmen. Für ihre Inhalte sind allein die jeweiligen Spieler rechtlich verantwortlich. Spieler können ihre eigenen Memes und ihr ganzes Konto jederzeit löschen.',
          'Sobald uns konkrete Rechtsverstöße bekannt werden (z. B. Urheberrechtsverletzungen, Hassrede oder illegale Inhalte), prüfen wir diese umgehend und entfernen oder sperren die Inhalte bzw. den Spieler ohne Vorankündigung. Bitte melde solche Verstöße über unsere Kontakt-E-Mail.',
        ],
      },
      {
        title: 'Inhalte Dritter & externe Links',
        paragraphs: [
          'Meme-Vorlagen und kurze Clips werden automatisch von Drittanbietern geladen (Imgflip, GIPHY, KLIPY und Reddit). Sie bleiben Eigentum der jeweiligen Rechteinhaber, und es gelten die Bedingungen dieser Dienste. Wenn bestimmte Inhalte aus dem Spiel entfernt werden sollen, kontaktiere uns bitte.',
          'LaughTime enthält Links zu externen Websites Dritter, zum Beispiel zu den Medienquellen im Footer. Auf Inhalt und Sicherheit dieser Seiten haben wir keinen Einfluss und übernehmen daher keine Haftung für deren Inhalte oder Datenschutzpraktiken. Verantwortlich ist stets der jeweilige Anbieter oder Betreiber der verlinkten Seite. Eine ständige Kontrolle der verlinkten Seiten ist ohne konkrete Hinweise auf einen Rechtsverstoß nicht zumutbar.',
        ],
      },
      {
        title: 'Urheberrecht & Marken',
        paragraphs: [
          'Das Design, die Architektur, das Branding (einschließlich des LaughTime-Logos) und der Programmcode von LaughTime sind urheberrechtlich geschützt. Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechts bedürfen der schriftlichen Zustimmung von OnYourSite.',
          'Von Spielern geschriebene Texte bleiben geistiges Eigentum des jeweiligen Spielers. Spielern ist es außerdem untersagt, Markennamen oder geschützte Kennzeichen Dritter als Spielernamen zu verwenden, um sich als jemand anderes auszugeben. Wir behalten uns vor, solche Spieler aus dem Spiel zu entfernen.',
        ],
      },
      {
        title: 'Datenschutz',
        paragraphs: [
          'Du kannst ohne Konto als Gast spielen. Name und Avatar von Gästen werden nur in deinem Browser (Local Storage) und auf dem Spielserver gespeichert, solange dein Raum existiert. Räume werden wenige Minuten, nachdem alle gegangen sind, automatisch gelöscht.',
          'Wenn du ein Konto erstellst, speichern wir Benutzername, Anzeigename, Avatar, Profiltext, ein sicher gehashtes Passwort (scrypt – dein Passwort selbst sehen wir nie), deine Spielergebnisse (Punkte, Siege, Runden), die Memes, mit denen du Runden gewonnen hast, inklusive Likes, sowie die Meme-Packs aus dem Meme Studio (Name, Beschreibung, Verweise auf die gewählten Vorlagen und GIFs und die Bilder, die du selbst hochlädst). Profil und Statistiken sind öffentlich, deine Sieger-Memes nur, wenn du „Meine Memes zeigen“ einschaltest. Packs mit eigenen Uploads werden erst nach Freigabe durch einen Admin öffentlich. Bilder aus einer Tausch-Runde sehen nur die Spieler in diesem Raum; sie werden gelöscht, sobald das Spiel bzw. der Raum endet. Lade nur Bilder hoch, die du verwenden darfst. Bei der Anmeldung mit Discord erhalten wir nur deine Discord-ID und deinen Namen (Berechtigung „identify“); für die Anmeldung bei Discord gilt deren Datenschutzerklärung. Wenn du LaughTime als Discord-Activity spielst, wirst du genauso mit deinem Discord-Konto angemeldet; Discord leitet das Spiel über einen eigenen Proxy, deshalb sehen wir dort deine IP-Adresse nicht. Wir übernehmen deine Discord-Spracheinstellung und zeigen deinen Spielstatus (Runde, Spielmodus, Spielerzahl) in Discord an.',
          'Deine Daten kannst du in den Kontoeinstellungen ändern und dein Konto jederzeit löschen – dabei werden Profil, Statistiken, Memes und Likes sofort entfernt.',
          'Cookies: Ein Cookie speichert deine Sprachauswahl; nach dem Anmelden hält dich ein Sitzungs-Cookie eingeloggt (30 Tage, HttpOnly); während einer Discord-Anmeldung wird kurz ein Sicherheits-Cookie genutzt. Es gibt kein Tracking und keine Werbung.',
          'Meme-Vorlagen und Clips werden über unseren eigenen Server geladen. Dein Browser verbindet sich also nicht mit Imgflip, GIPHY, KLIPY oder Reddit, und deine IP-Adresse wird nicht an sie weitergegeben.',
          'Der Webserver verarbeitet technisch notwendige Daten wie deine IP-Adresse, um die Website auszuliefern und Missbrauch zu verhindern (Rate-Limiting). Deine IP-Adresse wird nie im Klartext gespeichert.',
          'Meldungen und Moderation: Du kannst Spieler, Namen und Memes melden. Wir speichern die Meldung (Grund, optionaler Kommentar, der gemeldete Name, das betroffene Meme bzw. Bild, der Raumcode und eine Kopie eines gemeldeten Bildes aus einer Tausch-Runde), wer sie geschickt hat und einen Einweg-Hash der beteiligten IP-Adressen, damit unser Team sie im Admin-Bereich prüfen kann – es werden keine E-Mails verschickt. Bearbeitete Meldungen und ihre Bilder werden nach 90 Tagen gelöscht. Wird ein Spieler gebannt oder gesperrt, speichern wir Grund, Dauer und bei Gästen die Browser-ID und den IP-Hash, damit die Sperre nicht mit einem neuen Namen umgangen werden kann; der IP-Hash wird 90 Tage nach Ende der Sperre entfernt. IP-Sperren betreffen immer nur Gäste, nie angemeldete Konten. Außerdem zählen wir anonym, wie viele Spieler online sind und wie viele Runden pro Spielmodus gespielt werden (Statistik).',
          'Bei Fragen zum Datenschutz schreib uns gerne eine E-Mail.',
        ],
      },
    ],
  },
};
