'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
// must match the closing animation in app/v2.css (.modal-backdrop.is-closing)
const CLOSE_MS = 170;

/**
 * Behaviour every modal dialog needs, for markup like
 *
 *   const { ref, closing, close } = useDialog(onClose);
 *   <div className={`modal-backdrop ${closing ? 'is-closing' : ''}`} onClick={close}>
 *     <div ref={ref} className="card modal" role="dialog" aria-modal="true" tabIndex={-1}> … </div>
 *   </div>
 *
 * - moves the focus into the dialog and gives it back to the opener afterwards
 * - keeps Tab inside the dialog, Escape closes it
 * - close() plays the closing animation first, then calls onClose
 */
export default function useDialog(onClose) {
  const ref = useRef(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    if (timer.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      onCloseRef.current?.();
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => onCloseRef.current?.(), CLOSE_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    if (dialog && !dialog.contains(opener)) {
      const first = dialog.querySelector('[autofocus]') || dialog;
      first.focus({ preventScroll: true });
    }

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // back to the button that opened the dialog (if it still exists)
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [close]);

  return { ref, closing, close };
}
