// Viewport helpers of the Discord Activity (only imported by the activity).
//
//   watchFrameSize()  tells when Discord shows the frame as a tiny tile
//   watchKeyboard()   keeps the focused text field above the on-screen keyboard

// smaller than this is a tile, not a place to play (old clients send no layout event)
const TINY_WIDTH = 280;
const TINY_HEIGHT = 250;

export const isTinyFrame = (width, height) => width < TINY_WIDTH || height < TINY_HEIGHT;

/** Calls onChange(true|false) when the frame becomes / stops being a tiny tile. */
export function watchFrameSize(onChange) {
  let last = null;
  let frame = 0;
  const check = () => {
    frame = 0;
    const tiny = isTinyFrame(window.innerWidth, window.innerHeight);
    if (tiny !== last) {
      last = tiny;
      onChange(tiny);
    }
  };
  const onResize = () => {
    if (!frame) frame = requestAnimationFrame(check);
  };
  check();
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    if (frame) cancelAnimationFrame(frame);
  };
}

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'password', 'url', 'tel', 'number', '']);

/** an element that opens the on-screen keyboard */
export function isTextField(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return TEXT_INPUTS.has(String(el.getAttribute('type') || '').toLowerCase());
  return Boolean(el.isContentEditable);
}

/**
 * On phones the keyboard may lie on top of the frame instead of making it
 * smaller (iOS inside Discord). While a text field has the focus:
 *   - if the frame did not shrink, `root` gets data-keyboard="open" – the
 *     style sheet then adds room below the page, so it can scroll far enough;
 *   - the field is scrolled to the middle of what is left visible.
 *
 *   resizesView()  true when the client says the keyboard resizes the frame
 * Returns a function that removes the listeners.
 */
export function watchKeyboard(root, { resizesView = () => false } = {}) {
  let openTimer = null;
  let closeTimer = null;
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const onFocusIn = (e) => {
    const field = e.target;
    if (!isTextField(field)) return;
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    const before = window.innerHeight;
    // wait for the keyboard animation, then look what happened to the frame
    openTimer = setTimeout(() => {
      if (document.activeElement !== field) return;
      const viewport = window.visualViewport;
      const shrunk = window.innerHeight < before - 80 || (viewport && viewport.height < window.innerHeight - 80);
      if (!shrunk && !resizesView()) root.dataset.keyboard = 'open';
      field.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    }, 320);
  };

  const onFocusOut = () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    // focus may just move to the next field
    closeTimer = setTimeout(() => {
      if (!isTextField(document.activeElement)) delete root.dataset.keyboard;
    }, 120);
  };

  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  return () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
    delete root.dataset.keyboard;
  };
}
