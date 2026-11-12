'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Phones only (hidden above 720px by CSS): a bar that sticks to the bottom of
 * the visible screen with the primary action of the phase, so it never needs
 * scrolling and stays above the on-screen keyboard.
 */
export default function ActionBar({ timer = null, info = null, children }) {
  const [mounted, setMounted] = useState(false);
  const bar = useRef(null);

  // the page keeps room for the bar (see .has-action-bar in app/modes-v2.css)
  useEffect(() => {
    setMounted(true);
    document.documentElement.classList.add('has-action-bar');
    return () => document.documentElement.classList.remove('has-action-bar');
  }, []);

  // the keyboard only shrinks the visual viewport - lift the bar by the hidden part
  useEffect(() => {
    const vv = window.visualViewport;
    if (!mounted || !vv) return undefined;
    const root = document.documentElement;
    // the text box being typed in must end above the bar, not behind it
    const keepInView = () => {
      const el = document.activeElement;
      if (!root.classList.contains('kb-open') || !bar.current || !/^(TEXTAREA|INPUT)$/.test(el?.tagName || '')) return;
      const over = el.getBoundingClientRect().bottom - (bar.current.getBoundingClientRect().top - 10);
      if (over > 0) window.scrollBy(0, over);
    };
    const later = () => requestAnimationFrame(keepInView);
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const open = inset > 120;
      root.style.setProperty('--kb', `${inset}px`);
      if (open === root.classList.contains('kb-open')) return;
      root.classList.toggle('kb-open', open);
      if (open) later();
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    document.addEventListener('focusin', later);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.removeEventListener('focusin', later);
      root.classList.remove('kb-open');
      root.style.removeProperty('--kb');
    };
  }, [mounted]);

  return (
    <>
      {mounted &&
        createPortal(
          <div className="action-bar" ref={bar}>
            {(timer || info) && (
              <div className="action-bar-meta">
                {timer}
                {info && <span className="action-bar-info">{info}</span>}
              </div>
            )}
            <div className="action-bar-main">{children}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
