// Central Discord REST client – every server-side call to Discord goes through
// this file (and through server/lib/outbound.js underneath), so Discord's API is
// never hit harder than necessary:
//
//   exchangeCode()          OAuth2 code -> access token (website login + activity)
//   fetchUser()             users/@me for an access token
//   activityInstanceUsers() who is inside an activity instance (cached, de-duplicated)
//   parseWebhookUrl()       validates a webhook URL (Discord hosts only)
//   executeWebhook()        posts a message to a validated webhook
//
// outboundFetch() queues the requests per host, backs off on HTTP 429
// (Retry-After / X-RateLimit-*) and repeats only GETs after other failures:
// a token exchange (POST) is never sent twice unless Discord answered 429,
// which means it did not process the request.

import crypto from 'node:crypto';
import { createTtlCache, dedupe, outboundFetch } from './lib/outbound.js';

const DEFAULT_API_URL = 'https://discord.com/api';
const TIMEOUT_MS = 10_000;

/** Base URL of Discord's API (DISCORD_API_URL points tests at a local fake). */
export function discordApiUrl() {
  return (process.env.DISCORD_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
}

export class DiscordError extends Error {
  /** status: HTTP status of Discord's answer (0 = no answer at all) */
  constructor(message, status = 0) {
    super(message);
    this.name = 'DiscordError';
    this.status = status;
  }
}

const shortHash = (value) => crypto.createHash('sha256').update(String(value)).digest('base64url').slice(0, 22);

async function readJson(res, what) {
  try {
    return await res.json();
  } catch {
    // status 0: callers treat this like "no usable answer from Discord"
    throw new DiscordError(`${what}: invalid answer`, 0);
  }
}

// --- OAuth2 ------------------------------------------------------------------------

/**
 * Exchanges an authorization code for an access token.
 * Throws DiscordError (with Discord's HTTP status) when Discord refuses the code.
 * The same code arriving twice at the same moment shares one request – a code
 * is only valid once, a second request could only fail.
 */
export function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
  });
  // the activity flow has no redirect; the website flow must repeat its redirect URI
  if (redirectUri) body.set('redirect_uri', redirectUri);
  return dedupe(`discord:token:${shortHash(`${clientId}:${redirectUri || ''}:${code}`)}`, async () => {
    const res = await outboundFetch(`${discordApiUrl()}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      timeout: TIMEOUT_MS,
    });
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      throw new DiscordError(`token ${res.status}`, res.status);
    }
    const tok = await readJson(res, 'token');
    if (!tok?.access_token) throw new DiscordError('token: no access token', res.status);
    return tok;
  });
}

/** The Discord profile that belongs to an access token (scope "identify"). */
export async function fetchUser(accessToken) {
  const res = await outboundFetch(`${discordApiUrl()}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    timeout: TIMEOUT_MS,
  });
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new DiscordError(`me ${res.status}`, res.status);
  }
  return readJson(res, 'me');
}

// --- activity instances ---------------------------------------------------------------

const INSTANCE_TTL_MS = 30_000;
// an instance Discord does not know (yet): ask again soon, but not on every click
const INSTANCE_MISSING_TTL_MS = 3_000;
// a "fresh" lookup still accepts an answer that is at most this old
const INSTANCE_REFRESH_GAP_MS = 2_000;
// Discord is down or refuses the bot token: do not hammer it
const INSTANCE_ERROR_TTL_MS = 2_000;

const instances = createTtlCache({ ttlMs: INSTANCE_TTL_MS, max: 2000 });
const instanceErrors = createTtlCache({ ttlMs: INSTANCE_ERROR_TTL_MS, max: 500 });

/**
 * User ids inside an activity instance (needs the bot token of the app).
 * Returns a Set, or null when Discord does not know the instance.
 *   fresh: do not use an answer older than two seconds (somebody just joined)
 * Answers are cached for 30 s (unknown instances for 3 s) and parallel lookups
 * of the same instance share one request.
 */
export async function activityInstanceUsers({ clientId, botToken, instanceId, fresh = false }) {
  const key = `${clientId}:${instanceId}`;
  const hit = instances.get(key);
  if (hit && (!fresh || Date.now() - hit.at < INSTANCE_REFRESH_GAP_MS)) return hit.users;
  const failed = instanceErrors.get(key);
  if (failed) throw new DiscordError(failed.message, failed.status);

  const entry = await dedupe(`discord:instance:${key}`, async () => {
    let res;
    try {
      res = await outboundFetch(`${discordApiUrl()}/applications/${clientId}/activity-instances/${encodeURIComponent(instanceId)}`, {
        headers: { Authorization: `Bot ${botToken}`, Accept: 'application/json' },
        timeout: TIMEOUT_MS,
      });
    } catch (err) {
      instanceErrors.set(key, { message: err.message, status: 0 });
      throw new DiscordError(err.message, 0);
    }
    if (res.status === 404) {
      res.body?.cancel().catch(() => {});
      return instances.set(key, { at: Date.now(), users: null }, { ttlMs: INSTANCE_MISSING_TTL_MS });
    }
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      const message = `activity-instances ${res.status}`;
      instanceErrors.set(key, { message, status: res.status });
      throw new DiscordError(message, res.status);
    }
    const data = await readJson(res, 'activity-instances');
    const users = new Set((Array.isArray(data?.users) ? data.users : []).map(String));
    return instances.set(key, { at: Date.now(), users });
  });
  return entry.users;
}

// --- webhooks -------------------------------------------------------------------------

const WEBHOOK_HOSTS = new Set([
  'discord.com',
  'ptb.discord.com',
  'canary.discord.com',
  'discordapp.com',
  'ptb.discordapp.com',
  'canary.discordapp.com',
]);
const WEBHOOK_PATH_RE = /^\/api(?:\/v\d{1,2})?\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,200})\/?$/;

/**
 * Checks a webhook URL and returns { id, token, threadId } – or null for
 * anything that is not a real Discord webhook (other hosts, http, extra path
 * parts, credentials or ports). Only id and token are used afterwards.
 */
export function parseWebhookUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!WEBHOOK_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = WEBHOOK_PATH_RE.exec(url.pathname);
  if (!match) return null;
  const thread = url.searchParams.get('thread_id') || '';
  return { id: match[1], token: match[2], threadId: /^\d{5,25}$/.test(thread) ? thread : null };
}

/**
 * Posts a message to a webhook from parseWebhookUrl(). The request always goes
 * to Discord's API (never to a host taken from the configured URL) and is not
 * repeated unless Discord answered 429. Throws DiscordError on failure.
 */
export async function executeWebhook(webhook, payload) {
  if (!webhook?.id || !webhook?.token) throw new DiscordError('webhook: not configured', 0);
  const query = webhook.threadId ? `?thread_id=${webhook.threadId}` : '';
  let res;
  try {
    res = await outboundFetch(`${discordApiUrl()}/webhooks/${webhook.id}/${webhook.token}${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // never ping anybody, whatever the text contains
      body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    // the URL contains the secret token: keep it out of every message
    throw new DiscordError(`webhook: ${err?.name === 'TimeoutError' ? 'timeout' : 'no connection'}`, 0);
  }
  res.body?.cancel().catch(() => {});
  if (!res.ok) throw new DiscordError(`webhook ${res.status}`, res.status);
}

/** only for tests */
export function resetDiscordCaches() {
  instances.clear();
  instanceErrors.clear();
}
