'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Phones only (hidden above 720px by CSS): a bar that sticks to the bottom of
 * the visible screen with the primary action of the phase, so it never needs
 * scrolling and stays above the on-screen keyboard.
 */
export default function ActionBar({ timer = null, info = null, children }) {
  const [mounted, setMounted] = useState(false);

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
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const open = inset > 120;
      root.style.setProperty('--kb', `${inset}px`);
      if (open === root.classList.contains('kb-open')) return;
      root.classList.toggle('kb-open', open);
      // the layout tightens for the keyboard: keep the text box being typed in on screen
      if (open) requestAnimationFrame(() => document.activeElement?.scrollIntoView?.({ block: 'nearest' }));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.classList.remove('kb-open');
      root.style.removeProperty('--kb');
    };
  }, [mounted]);

  return (
    <>
      {mounted &&
        createPortal(
          <div className="action-bar">
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
