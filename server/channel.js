// Release channel of a request ("stable" or "beta") – main page and beta page
// are served by this one instance, see lib/features.js.
//
//   requestChannel(req)            'stable' | 'beta'
//   requestFeatures(req)           enabled feature keys for that request
//   requestHasFeature(req, key)    one feature
//
// Settings (all optional): BETA_ENABLED, BETA_HOSTS, BETA_ACCESS, FEATURE_FLAGS.
import {
  BETA_COOKIE,
  activeOverrides,
  betaAccessFromEnv,
  betaEnabledFromEnv,
  betaHostsFromEnv,
  enabledFeatures,
  featureEnabled,
  feedbackUrlFromEnv,
  hostName,
  parseFeatureFlags,
  requestHost,
  resolveBeta,
} from '../lib/features.js';
import { isAdmin, userFromRequest } from './accounts.js';
import { getConfig } from './config.js';
import { activityProxyHost, parseCookies } from './http.js';

// internal request headers that tell the Next.js layout what the server decided;
// they are overwritten on every request, so a visitor cannot send them in
export const CHANNEL_HEADER = 'x-lt-channel';
export const GATE_HEADER = 'x-lt-beta-gate';

// the settings are read on every call (cheap), parsed only when they change
const memo = (parse) => {
  let key;
  let value;
  return (...parts) => {
    const k = parts.join('\n');
    if (k !== key) {
      key = k;
      value = parse();
    }
    return value;
  };
};
const hostsMemo = memo(() => betaHostsFromEnv(process.env));

export const betaHosts = () => hostsMemo(process.env.BETA_HOSTS ?? '', process.env.PUBLIC_URL ?? '');
export const betaEnabled = () => betaEnabledFromEnv(process.env);
export const betaAccess = () => betaAccessFromEnv(process.env);
/** FEATURE_FLAGS overrides: { key: stage } */
export const featureFlags = () => activeOverrides();

/** the host a request was made for – a forwarded host only counts behind a trusted proxy */
export function requestHostName(req, trustProxy = getConfig().trustProxy) {
  return requestHost({ host: req.headers.host, forwardedHost: req.headers['x-forwarded-host'], trustProxy });
}

export const isBetaHost = (req) => betaHosts().includes(requestHostName(req));

const hostOf = (value) => {
  try {
    return new URL(String(value)).host.toLowerCase();
  } catch {
    return '';
  }
};

// The Discord Activity always plays on the stable channel: everybody in a voice
// call shares one room, the frame has no reliable cookies for an opt-in and the
// requests arrive through Discord's proxy, whatever host the mapping points to.
// (same test as isActivityRequest in activity.js, without importing the game)
function viaActivityProxy(req) {
  const proxyHost = activityProxyHost();
  if (!proxyHost) return false;
  if (req.headers['x-discord-proxy-payload']) return true;
  const origin = hostOf(req.headers.origin);
  if (origin) return origin === proxyHost;
  return hostOf(req.headers.referer) === proxyHost;
}

const states = new WeakMap(); // req -> result of requestBeta (asked several times per request)

/**
 * Channel, access and gate of a request (see resolveBeta in lib/features.js).
 * `user` may be handed in when the caller already knows it (null = guest);
 * otherwise the session is only looked up when the answer depends on it.
 * `optedIn` replaces the cookie (the answer right after the visitor switched).
 */
export function requestBeta(req, user, { optedIn = parseCookies(req.headers.cookie)[BETA_COOKIE] === '1' } = {}) {
  const known = user !== undefined;
  if (!known && states.has(req)) return states.get(req);
  const enabled = betaEnabled();
  const access = betaAccess();
  const host = requestHostName(req);
  const activity = viaActivityProxy(req);
  let who = known ? user : null;
  if (!known && enabled && !activity && access !== 'open' && (optedIn || betaHosts().includes(host))) {
    try {
      who = userFromRequest(req).user;
    } catch (err) {
      // no session lookup, no beta – the stable page still works
      console.warn('[beta] session lookup failed:', err.message);
    }
  }
  const state = {
    ...resolveBeta({ host, optedIn, betaHosts: betaHosts(), enabled, access, loggedIn: Boolean(who), admin: isAdmin(who), activity }),
    enabled,
    access,
    activity,
  };
  if (!known) states.set(req, state);
  return state;
}

export function requestChannel(req) {
  return requestBeta(req).channel;
}

/** keys of all features that are on for this request */
export function requestFeatures(req) {
  return enabledFeatures(requestChannel(req), featureFlags());
}

export function requestHasFeature(req, key) {
  return featureEnabled(key, requestChannel(req), featureFlags());
}

/** Search engines must never index a beta host: the main page is the only public address. */
export function markBetaHost(req, res) {
  if (isBetaHost(req)) res.setHeader('X-Robots-Tag', 'noindex');
}

/** Hands the decision to the Next.js layout (app/layout.jsx) – always overwrites what the client sent. */
export function tagRequest(req) {
  const state = requestBeta(req);
  req.headers[CHANNEL_HEADER] = state.channel;
  if (state.gate) req.headers[GATE_HEADER] = state.gate;
  else delete req.headers[GATE_HEADER];
  return state;
}

// --- logging in on the beta host ---------------------------------------------
// Session cookies are host-only, and Discord sends every login back to ONE
// address (the redirect URI on the main host). A login that was started on
// another host of this instance is therefore handed back to that host.

/** hosts this instance answers for: the main host and the beta hosts */
export function ownHosts() {
  const hosts = new Set(betaHosts());
  try {
    hosts.add(hostName(new URL(getConfig().publicUrl).host));
  } catch {
    /* PUBLIC_URL is not a URL: only the beta hosts count */
  }
  return hosts;
}

/**
 * Where a Discord login has to return to when it was not started on the host
 * of the redirect URI: { host, origin } – or null for the normal case and for
 * hosts that are not ours (never an open redirect).
 * The other host is expected on the same scheme and port as the redirect URI.
 */
export function loginReturn(req, redirectUri) {
  let target;
  try {
    target = new URL(redirectUri);
  } catch {
    return null;
  }
  const host = requestHostName(req);
  if (!host || host === hostName(target.host) || !ownHosts().has(host)) return null;
  return { host, origin: `${target.protocol}//${host}${target.port ? `:${target.port}` : ''}` };
}

// --- start-up check -------------------------------------------------------------

/** Problems in the beta settings, as readable lines (logged once when the server starts). */
export function betaSettingsWarnings(env = process.env) {
  const out = parseFeatureFlags(env.FEATURE_FLAGS).errors.map((e) => `FEATURE_FLAGS ${e} – entry ignored`);
  const access = String(env.BETA_ACCESS ?? '').trim().toLowerCase();
  if (access && betaAccessFromEnv(env) !== access) {
    out.push(`BETA_ACCESS "${env.BETA_ACCESS}" is not open, accounts or admins – using "${betaAccessFromEnv(env)}"`);
  }
  if (String(env.BETA_FEEDBACK_URL ?? '').trim() && !feedbackUrlFromEnv(env)) {
    out.push('BETA_FEEDBACK_URL must start with https://, http:// or mailto: – link hidden');
  }
  return out;
}

let warned = false;
export function logBetaSettings() {
  if (warned) return;
  warned = true;
  for (const line of betaSettingsWarnings()) console.warn(`[beta] ${line}`);
}
