'use client';

// Shared state of the Discord Activity (only set while LaughTime runs inside Discord).
// Kept outside React so plain helpers (api(), uploads, WebSocket) can use it.

const SESSION_KEY = 'lt_activity_session';
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

/** Opens a link in the user's browser (Discord shows a confirmation first). */
export async function openExternal(url) {
  if (!sdk) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  try {
    await sdk.commands.openExternalLink({ url });
  } catch {
    /* user declined or old client */
  }
}

/**
 * Inside Discord a download is not possible – share the finished meme into a
 * channel or DM instead (Discord's "share moment" dialog).
 * Returns false when sharing is not available, so the caller can fall back.
 */
export async function shareMediaToDiscord(blob, filename) {
  if (!sdk || !accessToken || !clientId) return false;
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
}
