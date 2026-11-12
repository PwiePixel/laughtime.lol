'use client';

// Shared state of the Discord Activity (only set while LaughTime runs inside Discord).
// Kept outside React so plain helpers (api(), uploads, WebSocket) can use it.

const SESSION_KEY = 'lt_activity_session';
const AUTH_KEY = 'lt_activity_auth';
// a stored login is not used any more when it is about to run out
const AUTH_MARGIN_MS = 5 * 60_000;
let session = null;
let sdk = null;
let accessToken = null;
let clientId = null;

export function isActivityUrl() {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  return q.has('frame_id') && q.has('instance_id');
}

export function activitySession() {
  if (session) return session;
  try {
    session = sessionStorage.getItem(SESSION_KEY) || null;
  } catch {
    session = null;
  }
  return session;
}

export function setActivitySession(token) {
  session = token || null;
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage blocked – memory only */
  }
}

/**
 * The login of this activity frame, kept for a reload (sessionStorage: it ends
 * with the Discord window). { session, accessToken, scope, discordId, clientId, expiresAt }
 * Only returned while it is complete, belongs to this app and has not run out.
 */
export function loadActivityAuth(forClientId) {
  try {
    const data = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null');
    if (!data || typeof data !== 'object') return null;
    const complete = data.session && data.accessToken && data.discordId && data.clientId === forClientId;
    if (!complete || !(Number(data.expiresAt) > Date.now() + AUTH_MARGIN_MS)) {
      sessionStorage.removeItem(AUTH_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function saveActivityAuth(auth) {
  try {
    if (auth) sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else sessionStorage.removeItem(AUTH_KEY);
  } catch {
    /* storage blocked – the next reload just logs in again */
  }
}

/** extra request headers: the session travels as a bearer token (no third-party cookies) */
export function authHeaders() {
  return sdk && session ? { Authorization: `Bearer ${session}` } : {};
}

/** WebSocket sub-protocols carrying the session */
export function wsProtocols() {
  return sdk && session ? ['laughtime', `lt-auth.${session}`] : undefined;
}

export function setActivitySdk(instance, token, id) {
  sdk = instance;
  accessToken = token;
  clientId = id;
}

export const activitySdk = () => sdk;
export const inActivity = () => Boolean(sdk);

/**
 * Opens a link in the user's browser (Discord asks the player first).
 * Returns false when Discord could not even ask (an old client) – the caller
 * then shows the address instead. A player who says no still counts as done.
 */
export async function openExternal(url) {
  if (!sdk) {
    window.open(url, '_blank', 'noopener');
    return true;
  }
  if (typeof sdk.commands?.openExternalLink !== 'function') return false;
  try {
    await sdk.commands.openExternalLink({ url });
    return true;
  } catch {
    return false;
  }
}

let sharing = null;

/**
 * Inside Discord a download is not possible – share the finished meme into a
 * channel or DM instead (Discord's "share moment" dialog).
 * Returns false when this is not available (the caller falls back to a download).
 */
export async function shareMediaToDiscord(blob, filename) {
  if (!sdk || !accessToken || !clientId) return false;
  // an old Discord client without the dialog: nothing is uploaded
  if (typeof sdk.commands?.openShareMomentDialog !== 'function') return false;
  // one upload at a time: a second tap waits for the first dialog
  if (sharing) return sharing;
  sharing = (async () => {
    const body = new FormData();
    body.append('file', new File([blob], filename, { type: blob.type }));
    const res = await fetch(`https://discord.com/api/applications/${clientId}/attachment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`attachment ${res.status}`);
    const data = await res.json();
    const mediaUrl = data?.attachment?.url;
    if (!mediaUrl) throw new Error('no attachment url');
    await sdk.commands.openShareMomentDialog({ mediaUrl });
    return true;
  })();
  try {
    return await sharing;
  } finally {
    sharing = null;
  }
}
