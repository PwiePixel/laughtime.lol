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
 * Opens a link in the user's browser (Discord shows a confirmation first).
 * Returns false when the link could not be opened (declined or an old client).
 */
export async function openExternal(url) {
  if (!sdk) {
    window.open(url, '_blank', 'noopener');
    return true;
  }
  try {
    const res = await sdk.commands.openExternalLink({ url });
    return res?.opened !== false;
  } catch {
    return false;
  }
}

let sharing = null;

/**
 * Inside Discord a download is not possible – share the finished meme into a
 * channel or DM instead (Discord's "share moment" dialog).
 * Returns false when sharing is not available, so the caller can fall back.
 */
export async function shareMediaToDiscord(blob, filename) {
  if (!sdk || !accessToken || !clientId) return false;
  // one upload at a time: a second tap waits for the first dialog
  if (sharing) return sharing;
  sharing = (async () => {
    const body = new FormData();
    body.append('file', new File([blob], filename, { type: blob.type }));
    const res = await fetch(`https://discord.com/api/applications/${clientId}/attachment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
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
