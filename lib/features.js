// Release channels & feature toggles (plain ESM, shared by browser and server).
//
// laughtime.lol and the beta page run on ONE instance. A request belongs to the
// "beta" channel when it arrives on a beta host (e.g. beta.laughtime.lol) or
// when the visitor opted in on /beta (cookie). Everything else is "stable".
//
// A feature is   'stable' -> on for everybody
//                'beta'   -> on in the beta channel only
//                'off'    -> switched off everywhere
// Game modes use the same idea through `beta: true` in GAME_MODES (lib/shared.js).
//
// Promoting a feature: change its stage here (code) or, without a release,
// through the setting FEATURE_FLAGS="key=stable,other=off".

export const CHANNELS = ['stable', 'beta'];
export const DEFAULT_CHANNEL = 'stable';
export const STAGES = ['stable', 'beta', 'off'];
export const BETA_COOKIE = 'lt_beta';
export const BETA_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // seconds

// who may use the beta channel (setting BETA_ACCESS)
//   open     -> everybody
//   accounts -> logged-in players
//   admins   -> the team only (ADMIN_USERNAMES)
export const BETA_ACCESS = ['open', 'accounts', 'admins'];
export const DEFAULT_BETA_ACCESS = 'open';

export const FEATURES = {
  // key: { stage: 'stable' | 'beta' | 'off' }
  // texts for the beta page: beta.feature.<key>.title / .text (lib/locales/beta.js)

  // live numbers (players, rooms, media sources) on the beta page
  liveStatus: { stage: 'beta' },
};

export const normalizeChannel = (v) => (CHANNELS.includes(v) ? v : DEFAULT_CHANNEL);

// --- FEATURE_FLAGS -------------------------------------------------------------

const NO_OVERRIDES = Object.freeze({});

/**
 * Reads the setting FEATURE_FLAGS, e.g. "liveStatus=stable, newLobby=off".
 * Entries that name an unknown feature or stage are skipped and reported in
 * `errors`, so a typo can never switch something on by accident.
 */
export function parseFeatureFlags(value, known = Object.keys(FEATURES)) {
  const overrides = {};
  const errors = [];
  const byLowerCase = new Map(known.map((key) => [key.toLowerCase(), key]));
  for (const part of String(value ?? '').split(/[,;\n]/)) {
    const entry = part.trim();
    if (!entry) continue;
    const i = entry.indexOf('=');
    if (i < 1) {
      errors.push(`"${entry}": expected key=stage`);
      continue;
    }
    const key = byLowerCase.get(entry.slice(0, i).trim().toLowerCase());
    const stage = entry.slice(i + 1).trim().toLowerCase();
    if (!key) {
      errors.push(`"${entry}": unknown feature (known: ${known.join(', ') || 'none'})`);
      continue;
    }
    if (!STAGES.includes(stage)) {
      errors.push(`"${entry}": unknown stage (use ${STAGES.join(', ')})`);
      continue;
    }
    overrides[key] = stage;
  }
  return { overrides, errors };
}

// The server knows FEATURE_FLAGS from its environment; the browser gets the
// parsed overrides from <Providers>. Both then answer featureEnabled() alike.
let browserOverrides = null;
let envRaw = '';
let envOverrides = NO_OVERRIDES;

/** called by <Providers> with the overrides the server rendered the page with */
export function setFeatureOverrides(overrides) {
  browserOverrides = overrides && typeof overrides === 'object' ? overrides : null;
}

export function activeOverrides() {
  const raw = typeof process !== 'undefined' ? process.env?.FEATURE_FLAGS : undefined;
  if (raw === undefined || raw === null) return browserOverrides || NO_OVERRIDES;
  if (raw !== envRaw) {
    envRaw = raw;
    envOverrides = parseFeatureFlags(raw).overrides;
  }
  return envOverrides;
}

// --- features -----------------------------------------------------------------

/** 'stable' | 'beta' | 'off' – unknown features are off */
export function featureStage(key, overrides = activeOverrides()) {
  if (!Object.hasOwn(FEATURES, key)) return 'off';
  const stage = (Object.hasOwn(overrides, key) && overrides[key]) || FEATURES[key].stage;
  return STAGES.includes(stage) ? stage : 'off';
}

export function featureEnabled(key, channel = DEFAULT_CHANNEL, overrides = activeOverrides()) {
  const stage = featureStage(key, overrides);
  if (stage === 'stable') return true;
  return stage === 'beta' && normalizeChannel(channel) === 'beta';
}

export function enabledFeatures(channel = DEFAULT_CHANNEL, overrides = activeOverrides()) {
  return Object.keys(FEATURES).filter((key) => featureEnabled(key, channel, overrides));
}

/** features that are only on in the beta channel right now (for the beta page) */
export function betaFeatures(overrides = activeOverrides()) {
  return Object.keys(FEATURES).filter((key) => featureStage(key, overrides) === 'beta');
}

// --- hosts ----------------------------------------------------------------------

/** "Beta.LaughTime.lol:443" -> "beta.laughtime.lol" (first entry of a list, no port, no trailing dot) */
export function hostName(value) {
  const host = String(value ?? '').split(',')[0].trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1); // IPv6 literal
  return host.replace(/:\d*$/, '').replace(/\.$/, '');
}

/**
 * The host a request was made for. A forwarded host is only believed when the
 * app sits behind a proxy we trust (TRUST_PROXY) – otherwise anybody could
 * claim to be on the beta host.
 */
export function requestHost({ host = '', forwardedHost = '', trustProxy = false } = {}) {
  return hostName((trustProxy && forwardedHost) || host);
}

/** beta hosts from the settings: BETA_HOSTS, or "beta." + the host of PUBLIC_URL */
export function betaHostsFromEnv(env = {}) {
  const listed = String(env.BETA_HOSTS || '')
    .split(',')
    // forgiving: "https://beta.example.org/" works as well
    .map((h) => hostName(h.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0]))
    .filter(Boolean);
  if (listed.length) return [...new Set(listed)];
  try {
    const main = new URL(env.PUBLIC_URL || 'https://laughtime.lol').hostname.toLowerCase().replace(/^www\./, '');
    return [`beta.${main}`];
  } catch {
    return [];
  }
}

export const betaEnabledFromEnv = (env = {}) => !['false', '0', 'no', 'off'].includes(String(env.BETA_ENABLED ?? 'true').trim().toLowerCase());

/**
 * BETA_ACCESS from the settings. Anything we do not understand closes the beta
 * for everybody but the team instead of opening it.
 */
export function betaAccessFromEnv(env = {}) {
  const value = String(env.BETA_ACCESS ?? '').trim().toLowerCase();
  if (!value) return DEFAULT_BETA_ACCESS;
  if (BETA_ACCESS.includes(value)) return value;
  if (value === 'account') return 'accounts';
  return 'admins';
}

/** link for feedback on the beta page (BETA_FEEDBACK_URL) – web and mail links only */
export function feedbackUrlFromEnv(env = {}) {
  const value = String(env.BETA_FEEDBACK_URL ?? '').trim();
  return /^(https?:\/\/|mailto:)\S+$/i.test(value) ? value : '';
}

// --- channel ------------------------------------------------------------------

export function mayJoinBeta(access = DEFAULT_BETA_ACCESS, { loggedIn = false, admin = false } = {}) {
  if (access === 'open') return true;
  if (access === 'accounts') return Boolean(loggedIn || admin);
  return Boolean(admin);
}

/**
 * Everything about a request and the beta:
 *   host       the host the request was made for (see requestHost)
 *   optedIn    true when the visitor switched the beta on (cookie)
 *   betaHosts  hosts that always show the beta, e.g. ['beta.laughtime.lol']
 *   enabled    false switches the beta channel off completely
 *   access     'open' | 'accounts' | 'admins'
 *   loggedIn / admin   who is asking
 *   activity   true inside the Discord Activity (always stable)
 *
 * Returns { channel, onBetaHost, optedIn, allowed, gate } – `gate` names the
 * access rule that keeps the visitor out on a beta host (the app then shows a
 * notice instead of quietly serving the stable page), otherwise it is null.
 */
export function resolveBeta({
  host = '',
  optedIn = false,
  betaHosts = [],
  enabled = true,
  access = DEFAULT_BETA_ACCESS,
  loggedIn = false,
  admin = false,
  activity = false,
} = {}) {
  const name = hostName(host);
  const onBetaHost = Boolean(name) && betaHosts.includes(name);
  const off = { channel: DEFAULT_CHANNEL, onBetaHost, optedIn: Boolean(optedIn), allowed: false, gate: null };
  if (!enabled || activity) return off;
  const allowed = mayJoinBeta(access, { loggedIn, admin });
  return {
    ...off,
    allowed,
    channel: allowed && (onBetaHost || optedIn) ? 'beta' : DEFAULT_CHANNEL,
    gate: onBetaHost && !allowed ? access : null,
  };
}

/** Which channel a request belongs to (see resolveBeta for the options). */
export function resolveChannel(options = {}) {
  return resolveBeta(options).channel;
}
