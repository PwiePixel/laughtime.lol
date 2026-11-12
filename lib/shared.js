// Shared between the browser and the game server (plain ESM, no imports).

// avatar = "<icon>|<color index>" – icon names are mapped to SVG icons in components/Icon.jsx
export const AVATAR_ICONS = [
  'cat', 'dog', 'bird', 'fish', 'rabbit', 'squirrel', 'turtle', 'snail',
  'bug', 'ghost', 'skull', 'bot', 'rocket', 'crown', 'pizza', 'ice-cream',
  'cookie', 'donut', 'popcorn', 'gamepad', 'headphones', 'flame', 'zap', 'star',
];
export const AVATAR_COLORS = ['#FFD23F', '#FF4FA3', '#35E0FF', '#7CFF6B', '#FF8A3D', '#B18CFF', '#FF5C5C', '#FFFFFF'];

export const DEFAULT_SETTINGS = {
  game: 'classic',
  rounds: 3,
  captionTime: 90,
  voteTime: 12,
  uploadTime: 60,
  mode: 'mixed',
  rerolls: 2,
  maxPlayers: 10,
  pack: null,
  // GIF Hunt: searches per player and round, 0 = the server default (HUNT_SEARCHES)
  searches: 0,
};
export const SETTING_OPTIONS = {
  game: ['classic', 'hunt', 'swap', 'same'],
  uploadTime: [30, 45, 60, 90, 120],
  rounds: [1, 2, 3, 4, 5, 6, 8, 10],
  captionTime: [30, 45, 60, 90, 120, 180],
  voteTime: [8, 10, 12, 15, 20],
  mode: ['mixed', 'images', 'videos'],
  rerolls: [0, 1, 2, 3, 5],
  maxPlayers: [4, 6, 8, 10, 12, 16],
  searches: [0, 1, 2, 3, 4],
};

// game modes:
//   classic = random template/clip
//   hunt    = players search their own GIF (limited tries), every search deals a hand to pick from
//   swap    = everybody brings a picture/GIF, gets two from other players and captions one (private rooms only)
//   same    = everybody captions the same picture (beta channel, private rooms only)
// `beta: true` = only offered and creatable in the beta channel (see lib/features.js)
export const GAME_MODES = [
  { id: 'classic', icon: 'image', color: '#FFD23F' },
  { id: 'hunt', icon: 'search', color: '#35E0FF' },
  { id: 'swap', icon: 'swap', color: '#7CFF6B', privateOnly: true },
  { id: 'same', icon: 'copy', color: '#FF4FA3', privateOnly: true, beta: true },
];
export const GAME_IDS = GAME_MODES.map((g) => g.id);
// quick play queues and /play
export const PUBLIC_GAME_IDS = GAME_MODES.filter((g) => !g.privateOnly && !g.beta).map((g) => g.id);

/** may this game mode be offered / created here? */
export function gameAllowed(id, { channel = 'stable', isPublic = false } = {}) {
  const mode = GAME_MODES.find((g) => g.id === id);
  if (!mode) return false;
  if (mode.beta && channel !== 'beta') return false;
  return !(isPublic && mode.privateOnly);
}

/** the game modes of a release channel (`isPublic`: quick play) */
export const gamesFor = (ctx = {}) => GAME_MODES.filter((g) => gameAllowed(g.id, ctx));

// Classic keeps its rules exactly. The other modes are "paced": away players,
// last call, tie-break (see server/game/rules.js).
export const isPaced = (game) => game !== 'classic';

/** default settings for a new room of the given game mode */
export function presetFor(game) {
  if (game === 'hunt') return { ...DEFAULT_SETTINGS, game: 'hunt', mode: 'videos', rerolls: 0 };
  if (game === 'swap') return { ...DEFAULT_SETTINGS, game: 'swap', mode: 'mixed', rerolls: 0 };
  if (game === 'same') return { ...DEFAULT_SETTINGS, game: 'same', mode: 'images', rerolls: 0, captionTime: 60 };
  return { ...DEFAULT_SETTINGS };
}

export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// --- moderation ---------------------------------------------------------------
// what players can report
export const REPORT_REASONS = ['name', 'meme', 'upload', 'harassment', 'spam', 'other'];
// preset reasons for bans / restrictions (texts in lib/i18n.js: mod.reason.*)
export const MOD_REASONS = [
  'offensive_name',
  'offensive_content',
  'inappropriate_upload',
  'harassment',
  'spam',
  'cheating',
  'ban_evasion',
  'other',
];
// ban   = locked out completely (no login, no playing)
// restrict = only private rooms (no quick play, uploads, name/profile changes, public memes)
export const SANCTION_TYPES = ['ban', 'restrict'];
export const SANCTION_DURATIONS = { '1h': 3600e3, '24h': 86400e3, '3d': 3 * 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3, perm: null };

export const PACK_LIMITS = { packs: 20, items: 100, minItems: 4, name: 40, description: 160 };
export const SEARCH_LIMITS = { min: 2, max: 40 };

export const RATINGS = [
  { score: 1, icon: 'meh' },
  { score: 2, icon: 'smile' },
  { score: 3, icon: 'laugh' },
  { score: 4, icon: 'party' },
  { score: 5, icon: 'skull' },
];
export const REACTIONS = ['laugh', 'skull', 'flame', 'heart', 'thumbs-up', 'party', 'frown', 'zap'];
export const REACTION_COLORS = {
  laugh: '#FFD23F',
  skull: '#FFFFFF',
  flame: '#FF8A3D',
  heart: '#FF4FA3',
  'thumbs-up': '#35E0FF',
  party: '#7CFF6B',
  frown: '#B18CFF',
  zap: '#FFD23F',
};

export const LIMITS = { name: 20, captionText: 140, captions: 6 };
export const CAPTION_COLORS = ['#FFFFFF', '#000000', '#FFD23F', '#FF4FA3', '#35E0FF', '#7CFF6B'];

// control characters (built at runtime so the source file stays plain text)
const ch = (n) => String.fromCharCode(n);
const CTRL_ALL = new RegExp(`[${ch(0)}-${ch(31)}${ch(127)}<>]`, 'g');
const CTRL_KEEP_NEWLINE = new RegExp(`[${ch(0)}-${ch(9)}${ch(11)}-${ch(31)}${ch(127)}]`, 'g');

export function sanitizeName(v) {
  return String(v ?? '')
    .replace(CTRL_ALL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.name);
}

export function sanitizeAvatar(v) {
  const [e, c] = String(v ?? '').split('|');
  const icon = AVATAR_ICONS.includes(e) ? e : AVATAR_ICONS[0];
  const ci = Math.max(0, Math.min(AVATAR_COLORS.length - 1, Number.parseInt(c, 10) || 0));
  return `${icon}|${ci}`;
}

export function randomAvatar() {
  const e = AVATAR_ICONS[Math.floor(Math.random() * AVATAR_ICONS.length)];
  return `${e}|${Math.floor(Math.random() * (AVATAR_COLORS.length - 1))}`;
}

export function parseAvatar(v) {
  const [icon, c] = sanitizeAvatar(v).split('|');
  return { icon, color: AVATAR_COLORS[Number(c)] };
}

const clamp = (n, a, b, d) => (n !== null && n !== '' && Number.isFinite(Number(n)) ? Math.max(a, Math.min(b, Number(n))) : d);

export function newCaption(y = 50, text = '') {
  return { text, x: 50, y, w: 92, size: 8, color: '#FFFFFF', upper: true };
}

export function defaultCaptions() {
  return [newCaption(12)];
}

// where the next added text box goes (top, bottom, middle, …)
const NEXT_Y = [12, 88, 50, 30, 70, 40];
export function nextCaptionY(count) {
  return NEXT_Y[count] ?? 50;
}

export function sanitizeCaptions(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, LIMITS.captions).map((c) => ({
    text: String(c?.text ?? '').replace(CTRL_KEEP_NEWLINE, '').slice(0, LIMITS.captionText),
    x: clamp(c?.x, 0, 100, 50),
    y: clamp(c?.y, 0, 100, 50),
    w: clamp(c?.w, 20, 100, 92),
    size: clamp(c?.size, 3, 18, 8),
    color: CAPTION_COLORS.includes(c?.color) ? c.color : '#FFFFFF',
    upper: c?.upper !== false,
  }));
}

export const hasText = (captions) => Array.isArray(captions) && captions.some((c) => String(c.text || '').trim());

/** `ctx.channel`: release channel of the room - beta modes cannot be chosen elsewhere */
export function sanitizeSettings(input, current = DEFAULT_SETTINGS, ctx = {}) {
  const out = { ...DEFAULT_SETTINGS, ...current };
  for (const [k, opts] of Object.entries(SETTING_OPTIONS)) {
    if (input && opts.includes(input[k])) out[k] = input[k];
  }
  if (out.game !== current.game && !gameAllowed(out.game, { channel: ctx.channel })) out.game = current.game;
  // switching the game mode applies its sensible defaults
  if (out.game !== current.game) {
    const preset = presetFor(out.game);
    if (input?.mode === current.mode) out.mode = preset.mode;
    if (input?.rerolls === current.rerolls) out.rerolls = preset.rerolls;
    // only "One for All" has its own caption time
    if ((out.game === 'same' || current.game === 'same') && input?.captionTime === current.captionTime) out.captionTime = preset.captionTime;
  }
  // "pack" (own meme pack) is validated by the server separately and kept as is
  out.pack = current.pack ?? null;
  return out;
}

/**
 * The tray of the caption phase (`state.caption.hand`) can be large and changes
 * rarely: the server sends it once per connection and afterwards only its
 * `handKey`. This puts the remembered tray back into a state that came without
 * it. `cache` belongs to one connection; the return value is the cache to keep.
 */
export function restoreHand(state, cache = null) {
  const cap = state?.caption;
  if (!cap || cap.spectator) return cache;
  if (Array.isArray(cap.hand)) return cap.handKey ? { key: cap.handKey, hand: cap.hand } : cache;
  cap.hand = cache && cache.key === cap.handKey ? cache.hand : [];
  return cache;
}

export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
