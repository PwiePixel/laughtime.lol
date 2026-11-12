// Start-up of the Discord Activity in three steps (shown by components/activity/ActivityBoot.jsx):
//
//   openConnection()  our settings + the SDK handshake with the Discord client
//   login()           Discord login -> LaughTime session (re-used after a reload)
//   joinRoom()        the room of this call
//
// Every step has a timeout and is repeated with a growing pause while the
// failure looks temporary. Only the activity imports this file.

import { loadActivityAuth, saveActivityAuth, setActivitySdk, setActivitySession } from './activity';
import { api } from './api';
import { TIMEOUTS, authorizeCode, codedError, errorCode, isOutsideError, isTransient, loadSdk, tryCommand, withRetries, withTimeout } from './activitySdk';

// one SDK per page: its constructor starts the handshake with the Discord client
let sdkJob = null;

function getSdk(clientId) {
  sdkJob ||= loadSdk(clientId).catch((err) => {
    sdkJob = null;
    // not inside Discord stays what it is; anything else is a chunk that did not load
    throw isOutsideError(err) ? err : codedError('network');
  });
  return sdkJob;
}

/** Step 1: public settings of the activity and the handshake. */
export async function openConnection({ cancel, onRetry } = {}) {
  const cfg = await withRetries(() => withTimeout(api('/api/activity/config'), TIMEOUTS.config, 'timeout'), { cancel, onRetry });
  if (!cfg?.enabled || !cfg.clientId) throw codedError('activity_disabled', 404);
  const sdk = await withRetries(() => getSdk(cfg.clientId), { cancel, onRetry });
  // the handshake was sent once; a second wait only gives a slow client more time
  await withRetries(() => withTimeout(sdk.ready(), TIMEOUTS.ready, 'discord_timeout'), { cancel, onRetry, retries: 1 });
  return { cfg, sdk };
}

export function forgetLogin() {
  saveActivityAuth(null);
  setActivitySession(null);
}

/** The login kept from before a reload: still accepted by Discord and by us? */
async function resumeLogin({ sdk, cfg, stored, refreshAccount }) {
  const res = await tryCommand(sdk, 'authenticate', { access_token: stored.accessToken }, TIMEOUTS.authenticate);
  // another Discord account in the same window must never get this session
  if (!res.ok || String(res.data?.user?.id || '') !== String(stored.discordId)) return false;
  setActivitySession(stored.session);
  setActivitySdk(sdk, stored.accessToken, cfg.clientId);
  return Boolean(await refreshAccount());
}

/**
 * Step 2: log in. A login from before a reload of the frame is used again
 * (no new question to Discord); otherwise Discord hands out a one-time code
 * that our server exchanges. Every attempt uses a new code – a code is never
 * sent twice.
 * Resolves to { scope, resumed }.
 */
export async function login({ sdk, cfg, cancel, onRetry, refreshAccount }) {
  const stored = loadActivityAuth(cfg.clientId);
  if (stored) {
    if (await resumeLogin({ sdk, cfg, stored, refreshAccount })) return { scope: stored.scope || '', resumed: true };
    forgetLogin();
  }
  return withRetries(
    async () => {
      const code = await authorizeCode(sdk, cfg.clientId);
      if (cancel?.cancelled) throw codedError('cancelled');
      const token = await withTimeout(api('/api/activity/token', { method: 'POST', body: { code } }), TIMEOUTS.token, 'timeout');
      if (cancel?.cancelled) throw codedError('cancelled');
      setActivitySession(token.session);
      setActivitySdk(sdk, token.accessToken, cfg.clientId);
      const auth = await tryCommand(sdk, 'authenticate', { access_token: token.accessToken }, TIMEOUTS.authenticate);
      const discordId = auth.ok ? String(auth.data?.user?.id || '') : '';
      if (!auth.ok) console.warn('[activity] authenticate failed', auth.code);
      // kept for a reload of this frame; without a confirmed Discord id the next start logs in again
      if (discordId && token.expiresIn > 0) {
        saveActivityAuth({
          session: token.session,
          accessToken: token.accessToken,
          scope: token.scope || '',
          discordId,
          clientId: cfg.clientId,
          expiresAt: Date.now() + token.expiresIn * 1000,
        });
      }
      await refreshAccount();
      return { scope: token.scope || '', resumed: false };
    },
    { cancel, onRetry },
  );
}

// Discord's list of an instance can be a moment behind when somebody has just joined
const ROOM_SOON = new Set(['activity_not_found', 'not_in_activity']);

/** Step 3: the room that belongs to this call. Resolves to { code }. */
export function joinRoom({ sdk, cancel, onRetry }) {
  return withRetries(
    () =>
      withTimeout(
        api('/api/activity/room', {
          method: 'POST',
          body: { instanceId: sdk.instanceId, guildId: sdk.guildId, channelId: sdk.channelId },
        }),
        TIMEOUTS.room,
        'timeout',
      ),
    { cancel, onRetry, retryable: (err) => isTransient(err) || ROOM_SOON.has(errorCode(err)) },
  );
}
