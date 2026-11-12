'use client';

export const MASK = '•••••';
export const ROOM_KEY = 'lt_room';

/** remember the room for this tab, so /room (without code in the URL) can rejoin after a reload */
export function rememberRoom(code) {
  try {
    sessionStorage.setItem(ROOM_KEY, code);
  } catch {
    /* ignore */
  }
}

export function storedRoom() {
  try {
    return sessionStorage.getItem(ROOM_KEY) || '';
  } catch {
    return '';
  }
}

/** show /room instead of /room/CODE in the address bar while streaming */
export function syncRoomUrl(code, hide) {
  const target = hide ? '/room' : `/room/${code}`;
  if (window.location.pathname !== target) window.history.replaceState(window.history.state, '', target);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
