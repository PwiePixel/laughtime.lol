// Helpers around Discord's Embedded App SDK. Only the activity itself imports
// this file (and the SDK is loaded on demand), so nothing of it reaches the
// normal website.
//
// The SDK's commands never time out on their own: an old Discord client that
// does not know a command may simply not answer. Everything optional therefore
// runs through tryCommand(), which gives up after a few seconds and reports
// failure instead of throwing.

/** an error with a code, shaped like the ApiError of lib/api.js */
export const codedError = (code, status = 0) => Object.assign(new Error(code), { code, status });

// values of the SDK's LayoutModeTypeObject / OrientationLockStateTypeObject
// (output/schema/common.d.ts of the installed version, checked by a test)
export const LAYOUT = { FOCUSED: 0, PIP: 1, GRID: 2 };
export const ORIENTATION_LOCK = { UNLOCKED: 1, PORTRAIT: 2, LANDSCAPE: 3 };

// scopes that work without an approval by Discord: the name for the login and
// writing the own Rich Presence
export const SCOPES = ['identify', 'rpc.activities.write'];
export const PRESENCE_SCOPE = 'rpc.activities.write';

export const TIMEOUTS = {
  config: 10_000,
  ready: 15_000,
  // Discord may show its permission dialog here – give the player time to read it
  authorize: 5 * 60_000,
  token: 20_000,
  authenticate: 10_000,
  room: 20_000,
  optional: 5_000,
};

const sleepers = new WeakMap();

/** Rejects with an error carrying `code` when the promise takes longer than ms. */
export function withTimeout(promise, ms, code = 'timeout') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(codedError(code)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/** Waits ms; `signal` (an object from createCancel()) ends the wait early by rejecting. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.cancelled) {
      reject(codedError('cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      sleepers.get(signal)?.delete(stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(codedError('cancelled'));
    };
    if (signal) {
      if (!sleepers.has(signal)) sleepers.set(signal, new Set());
      sleepers.get(signal).add(stop);
    }
  });
}

/** A tiny cancel token for one start attempt: cancel() also ends its sleep()s. */
export function createCancel() {
  const token = {
    cancelled: false,
    cancel() {
      token.cancelled = true;
      const waiting = sleepers.get(token);
      if (waiting) for (const stop of [...waiting]) stop();
      sleepers.delete(token);
    },
  };
  return token;
}

/** Loads the SDK (its own chunk) and connects it to the Discord client. */
export async function loadSdk(clientId) {
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  // the override would send every console line to Discord
  return new DiscordSDK(clientId, { disableConsoleLogOverride: true });
}

/** true when the SDK refused to start because the page is not inside Discord */
export const isOutsideError = (err) => err instanceof Error && /frame_id|instance_id|platform/.test(err.message);

/**
 * Runs an optional SDK command: { ok: true, data } or { ok: false, code }.
 * Never throws and never waits longer than `timeout`.
 */
export async function tryCommand(sdk, name, args, timeout = TIMEOUTS.optional) {
  const fn = sdk?.commands?.[name];
  if (typeof fn !== 'function') return { ok: false, code: 'missing' };
  try {
    return { ok: true, data: await withTimeout(fn(args), timeout, 'timeout') };
  } catch (err) {
    return { ok: false, code: err?.code ?? 'failed' };
  }
}

/** Subscribes to an SDK event; resolves to an unsubscribe function (a no-op when it failed). */
export async function trySubscribe(sdk, event, listener, timeout = TIMEOUTS.optional) {
  try {
    await withTimeout(sdk.subscribe(event, listener), timeout, 'timeout');
    return () => {
      Promise.resolve()
        .then(() => sdk.unsubscribe(event, listener))
        .catch(() => {});
    };
  } catch {
    return () => {};
  }
}

// --- start-up errors --------------------------------------------------------------------

// worth another automatic attempt: the next one may simply work
const TRANSIENT = new Set(['network', 'timeout', 'discord_timeout', 'discord_unavailable', 'server_error', 'server_full']);
export const MAX_AUTO_RETRIES = 3;

/** The error code shown to the player (a key of activity.err.*). */
export function errorCode(err) {
  if (err && typeof err.code === 'string' && err.code) return err.code;
  return 'generic';
}

/** Should the step be repeated automatically? */
export function isTransient(err) {
  const code = errorCode(err);
  if (TRANSIENT.has(code)) return true;
  // our server could not reach Discord (502) – unlike a refused login (401)
  return code === 'discord_failed' && err?.status === 502;
}

/** Pause before automatic attempt number `attempt` (0-based): 1 s, 2 s, 4 s … plus jitter */
export function backoffDelay(attempt, random = Math.random) {
  return Math.min(8000, 1000 * 2 ** attempt) + Math.floor(random() * 400);
}

/** How long the "Try again" button stays locked after an error (no hammering). */
export function retryLockMs(code) {
  if (code === 'too_many_attempts') return 15_000;
  if (code === 'discord_denied' || code === 'banned' || code === 'activity_disabled') return 0;
  return 2000;
}

/**
 * Runs `step` and repeats it with a growing pause while it fails with a
 * transient error. onRetry({ attempt, delay, code }) is called before each pause.
 *   retryable(err)  replaces the default rule (isTransient) for this step
 */
export async function withRetries(step, { cancel, onRetry, retries = MAX_AUTO_RETRIES, retryable = isTransient } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (cancel?.cancelled) throw codedError('cancelled');
    try {
      return await step(attempt);
    } catch (err) {
      if (cancel?.cancelled) throw codedError('cancelled');
      if (attempt >= retries || !retryable(err)) throw err;
      const delay = backoffDelay(attempt);
      onRetry?.({ attempt: attempt + 1, retries, delay, code: errorCode(err) });
      await sleep(delay, cancel);
    }
  }
}

// --- login ------------------------------------------------------------------------------

// RPC error of the Discord client: the player closed the permission dialog
const RPC_OAUTH2_ERROR = 5000;

/**
 * Asks Discord for a one-time login code. Silent once the player has agreed
 * (prompt "none"); a client that cannot grant the presence scope still gets
 * the login with the name only.
 */
export async function authorizeCode(sdk, clientId) {
  const ask = (scope) =>
    withTimeout(
      sdk.commands.authorize({ client_id: clientId, response_type: 'code', state: '', prompt: 'none', scope }),
      TIMEOUTS.authorize,
      'discord_timeout',
    );
  let res;
  try {
    res = await ask(SCOPES);
  } catch (err) {
    if (err?.code === 'discord_timeout') throw err;
    if (err?.code === RPC_OAUTH2_ERROR) throw codedError('discord_denied', 401);
    try {
      res = await ask(['identify']);
    } catch (err2) {
      if (err2?.code === 'discord_timeout') throw err2;
      throw codedError('discord_denied', 401);
    }
  }
  if (!res?.code) throw codedError('discord_denied', 401);
  return res.code;
}

/** Does the granted scope list ("identify rpc.activities.write") allow Rich Presence? */
export const canSetPresence = (scope) => String(scope || '').split(/[\s,]+/).includes(PRESENCE_SCOPE);

// --- device -----------------------------------------------------------------------------

/**
 * A phone (not a tablet)? Used for the orientation lock: on a phone a caption
 * game only works upright – in landscape the keyboard covers nearly everything.
 */
export function isPhoneSized(screenLike = typeof window === 'undefined' ? null : window.screen) {
  if (!screenLike) return false;
  const short = Math.min(Number(screenLike.width) || 0, Number(screenLike.height) || 0);
  return short > 0 && short < 600;
}

// --- participants -----------------------------------------------------------------------

/** What the activity shows of the people in this activity instance. */
export function normalizeParticipants(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const id = String(p?.id || '');
    if (!/^\d{5,25}$/.test(id) || seen.has(id) || p.bot) continue;
    seen.add(id);
    const hash = typeof p.avatar === 'string' && /^[a-z0-9_]{6,80}$/i.test(p.avatar) ? p.avatar : null;
    out.push({
      id,
      name: String(p.nickname || p.global_name || p.username || '?').slice(0, 40),
      // Discord's own CDN: one of the few hosts an activity may load from directly
      avatar: hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64` : null,
    });
  }
  return out.slice(0, 50);
}
