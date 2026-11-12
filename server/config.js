import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const list = (v, fallback) =>
  String(v ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const bool = (v, fallback) => (v === undefined || v === '' ? fallback : !['false', '0', 'no', 'off'].includes(String(v).toLowerCase()));
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : fallback);

let cached;
export function getConfig() {
  if (cached) return cached;
  const e = process.env;
  cached = {
    port: num(e.SERVER_PORT, num(e.PORT, 3000)),
    host: e.HOST || e.SERVER_IP || '0.0.0.0',
    publicUrl: e.PUBLIC_URL || 'https://laughtime.lol',
    trustProxy: bool(e.TRUST_PROXY, true),

    imgflipEnabled: bool(e.IMGFLIP_ENABLED, true),
    imgflipPages: Math.max(1, Math.min(20, num(e.IMGFLIP_PAGES, 6))),
    giphyKey: e.GIPHY_API_KEY || '',
    giphyApiBase: e.GIPHY_API_URL || '',
    klipyApiBase: e.KLIPY_API_URL || '',
    klipyKey: e.KLIPY_API_KEY || '',
    klipyCustomerId: e.KLIPY_CUSTOMER_ID || 'laughtime-server',
    klipyLocale: e.KLIPY_LOCALE || 'en_US',
    klipyTypes: list(e.KLIPY_TYPES, 'clips,gifs').filter((t) => t === 'clips' || t === 'gifs'),
    redditEnabled: bool(e.REDDIT_ENABLED, true),
    redditClientId: e.REDDIT_CLIENT_ID || '',
    redditClientSecret: e.REDDIT_CLIENT_SECRET || '',
    redditUserAgent: e.REDDIT_USER_AGENT || 'web:laughtime.lol:v1.0.0 (meme party game)',
    redditVideoSubs: list(e.REDDIT_VIDEO_SUBS, 'MemeVideos,dankvideos,Funnymemes'),
    redditImageSubs: list(e.REDDIT_IMAGE_SUBS, 'MemeTemplatesOfficial,memetemplates'),
    searchTerms: list(
      e.SEARCH_TERMS,
      'reaction,fail,shocked,awkward,dance,cat,dog,facepalm,confused,laughing,cringe,celebrate,nope,surprised,eye roll,waiting,panic,sad,thumbs up,mind blown',
    ),
    contentRating: ['g', 'pg', 'pg-13', 'r'].includes(String(e.CONTENT_RATING).toLowerCase())
      ? String(e.CONTENT_RATING).toLowerCase()
      : 'pg-13',
    maxVideoSeconds: num(e.MAX_VIDEO_SECONDS, 30),
    blockedWords: list(e.BLOCKED_WORDS, 'nsfw,nude,porn,hitler,nazi,9/11,isis,rape').map((w) => w.toLowerCase()),

    cacheDir: path.join(ROOT, 'data', 'cache'),
    cacheMaxBytes: num(e.CACHE_MAX_MB, 800) * 1024 * 1024,

    maxRooms: num(e.MAX_ROOMS, 300),
    minPlayers: Math.max(1, num(e.MIN_PLAYERS, 2)),

    // public matchmaking ("Quick play")
    matchMin: Math.max(2, num(e.MATCH_MIN_PLAYERS, 4)),
    matchMax: Math.max(2, Math.min(16, num(e.MATCH_MAX_PLAYERS, 8))),
    matchWaitMs: Math.max(0, num(e.MATCH_WAIT_SECONDS, 8)) * 1000,
    // after this many seconds of waiting, a match also starts with MATCH_RELAX_PLAYERS (0 = never)
    matchRelaxMs: Math.max(0, num(e.MATCH_RELAX_SECONDS, 60)) * 1000,
    matchRelaxMin: Math.max(2, num(e.MATCH_RELAX_PLAYERS, 2)),

    // own uploads (Meme Studio packs + swap rounds)
    uploadMaxBytes: Math.max(1, Math.min(50, num(e.UPLOAD_MAX_MB, 8))) * 1024 * 1024,
    uploadsPerUser: Math.max(0, num(e.UPLOADS_PER_USER, 200)),

    // "GIF Hunt" mode: searches per player per round
    huntSearches: Math.max(1, Math.min(10, num(e.HUNT_SEARCHES, 2))),
  };
  return cached;
}
