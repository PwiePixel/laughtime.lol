'use client';

// The browser's install prompt, shared by the banner and the /install page.
// Kept outside React: "beforeinstallprompt" fires once per page load and may
// arrive before any component is mounted.

const EMPTY = { prompt: null, installed: false };
let state = EMPTY;
const listeners = new Set();

function update(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // keep the browser's own mini bar away – LaughTime offers the install itself
    event.preventDefault();
    update({ prompt: event, installed: false });
  });
  window.addEventListener('appinstalled', () => update({ prompt: null, installed: true }));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSnapshot = () => state;
export const getServerSnapshot = () => EMPTY;

/** Opens the browser's install dialog. Resolves to 'accepted', 'dismissed' or 'unavailable'. */
export async function promptInstall() {
  const event = state.prompt;
  if (!event) return 'unavailable';
  // a prompt can only be used once
  update({ prompt: null });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'dismissed';
  }
}
