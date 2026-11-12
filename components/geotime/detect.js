'use client';

/**
 * Ampel-Prüfung auf dem Gerät.
 *
 * Idee: Wer einen Begriff abhakt, macht einen Schnappschuss der aktuellen
 * Ansicht. Das Bild bleibt auf dem Gerät – zum Server geht nur eine Zahl
 * zwischen 0 und 1. Erkennt das Modell den Begriff sicher, zählt das Feld
 * sofort; ist es unsicher, entscheidet am Rundenende das gegnerische Team.
 *
 * Das Modell (MobileNet über TensorFlow.js) wird bei Bedarf vom CDN geladen.
 * Klappt das nicht – kein Netz, blockiert, kein lesbares Bild – gibt es 0.5
 * zurück: dann landet der Fund im Tribunal. Das Spiel läuft also immer,
 * die automatische Prüfung ist nur die Abkürzung.
 */
const TF = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const NET = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';

/** Bingo-Begriff -> Wörter, die MobileNet dafür ausgibt */
const HINTS = {
  Ampel: ['traffic light', 'traffic signal', 'stoplight'],
  Bushaltestelle: ['bus', 'trolleybus', 'minibus', 'streetcar'],
  Briefkasten: ['mailbox', 'letter box', 'postbox'],
  Kirche: ['church', 'bell cote', 'monastery', 'dome'],
  Tankstelle: ['gas pump', 'petrol pump', 'gasoline pump'],
  Brücke: ['steel arch bridge', 'suspension bridge', 'viaduct', 'pier'],
  Baustelle: ['crane', 'bulldozer', 'steam shovel', 'forklift'],
  Supermarkt: ['grocery store', 'supermarket', 'shopping cart'],
  Fahrrad: ['bicycle', 'mountain bike', 'tricycle', 'unicycle'],
  Hydrant: ['fire hydrant'],
  Bahnübergang: ['electric locomotive', 'freight car', 'passenger car'],
  Windrad: ['windmill', 'wind turbine'],
  Straßenbahn: ['streetcar', 'trolleybus', 'electric locomotive'],
  Kreisverkehr: ['traffic circle', 'roundabout'],
  Denkmal: ['obelisk', 'monument', 'megalith', 'triumphal arch'],
  Solaranlage: ['solar dish', 'solar collector', 'solar panel'],
  Schule: ['school bus', 'library', 'campus'],
  Fluss: ['lakeside', 'river', 'canal', 'dock', 'boathouse'],
  Traktor: ['tractor', 'thresher', 'harvester', 'plow'],
  Parkbank: ['park bench', 'bench'],
  Leuchtturm: ['beacon', 'lighthouse'],
  Fußgängerzone: ['street sign', 'plaza', 'pedestrian'],
  Tunnel: ['tunnel', 'subway train'],
  Hotel: ['hotel', 'restaurant', 'lobby'],
  Wasserturm: ['water tower'],
};

let model = null;
let loading = null;

const script = (src) =>
  new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Modell nicht erreichbar'));
    document.head.appendChild(el);
    return undefined;
  });

async function load() {
  if (model) return model;
  if (!loading) {
    loading = (async () => {
      await script(TF);
      await script(NET);
      model = await window.mobilenet.load({ version: 2, alpha: 0.5 });
      return model;
    })().catch(() => null);
  }
  return loading;
}

/** Läuft die automatische Prüfung überhaupt? (nur zur Anzeige) */
export const detectorReady = () => Boolean(model);

/**
 * Wie sicher ist das Modell, dass `term` im Bild ist?
 * @param {HTMLCanvasElement|HTMLImageElement|null} frame Schnappschuss der Ansicht
 * @param {string} term Bingo-Begriff
 * @returns {Promise<number>} 0…1 – 0.5 heißt "weiß nicht, ab ins Tribunal"
 */
export async function confidenceFor(frame, term) {
  const hints = HINTS[term];
  if (!frame || !hints) return 0.5;
  const net = await load();
  if (!net) return 0.5;
  let guesses;
  try {
    guesses = await net.classify(frame, 10);
  } catch {
    return 0.5;
  }
  let best = 0;
  for (const g of guesses || []) {
    const label = String(g.className || '').toLowerCase();
    if (hints.some((h) => label.includes(h))) best = Math.max(best, Number(g.probability) || 0);
  }
  // nichts gefunden heißt nicht "falsch" – dann entscheidet das Tribunal
  return best > 0 ? Math.min(1, best) : 0.5;
}
