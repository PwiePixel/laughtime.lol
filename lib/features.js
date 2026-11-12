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

export const CHANNELS = ['stable', 'beta'];
export const DEFAULT_CHANNEL = 'stable';
export const BETA_COOKIE = 'lt_beta';

export const FEATURES = {
  // key: { stage: 'stable' | 'beta' | 'off' }
};

export const normalizeChannel = (v) => (CHANNELS.includes(v) ? v : DEFAULT_CHANNEL);

export function featureEnabled(key, channel = DEFAULT_CHANNEL) {
  const stage = FEATURES[key]?.stage;
  if (stage === 'stable') return true;
  return stage === 'beta' && normalizeChannel(channel) === 'beta';
}

export function enabledFeatures(channel = DEFAULT_CHANNEL) {
  return Object.keys(FEATURES).filter((key) => featureEnabled(key, channel));
}

/**
 * Which channel a request belongs to.
 *   host       the Host header (without scheme)
 *   optedIn    true when the visitor switched the beta on (cookie)
 *   betaHosts  hosts that always show the beta, e.g. ['beta.laughtime.lol']
 *   enabled    false switches the beta channel off completely
 */
export function resolveChannel({ host = '', optedIn = false, betaHosts = [], enabled = true } = {}) {
  if (!enabled) return DEFAULT_CHANNEL;
  const name = String(host).split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  if (name && betaHosts.includes(name)) return 'beta';
  return optedIn ? 'beta' : DEFAULT_CHANNEL;
}

/** beta hosts from the settings: BETA_HOSTS, or "beta." + the host of PUBLIC_URL */
export function betaHostsFromEnv(env = {}) {
  const listed = String(env.BETA_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (listed.length) return listed;
  try {
    const main = new URL(env.PUBLIC_URL || 'https://laughtime.lol').hostname.toLowerCase().replace(/^www\./, '');
    return [`beta.${main}`];
  } catch {
    return [];
  }
}

export const betaEnabledFromEnv = (env = {}) => !['false', '0', 'no', 'off'].includes(String(env.BETA_ENABLED ?? 'true').toLowerCase());
