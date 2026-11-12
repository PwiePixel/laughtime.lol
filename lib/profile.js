import { randomAvatar, sanitizeAvatar, sanitizeName } from './shared';

const KEY = 'lt_profile';

function randomId(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function loadProfile() {
  let p = null;
  try {
    p = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    p = null;
  }
  if (!p || !/^[a-zA-Z0-9_-]{8,40}$/.test(p.pid || '') || !(p.secret?.length >= 16)) {
    p = { pid: randomId(12), secret: randomId(24), name: '', avatar: randomAvatar() };
    saveProfile(p);
  }
  return { ...p, name: sanitizeName(p.name), avatar: sanitizeAvatar(p.avatar) };
}

export function saveProfile(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode – keep it in memory only */
  }
}
