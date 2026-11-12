'use client';

import { useEffect, useId, useRef } from 'react';

// The LoL logo. Every letter is its own small SVG inside an HTML box, so the
// browser can move each one on the compositor (transform only, no repaint of
// the artwork while it bounces). Animations live in app/community.css (.lol-anim …).

const W = 620;
const H = 300;
const INK = '#170A2E';
const LETTER =
  'M40 84 Q40 62 62 62 L84 62 Q106 62 106 84 L106 172 Q106 194 128 194 L168 194 Q190 194 190 216 L190 236 Q190 258 168 258 L62 258 Q40 258 40 236 Z';
const MOUTH = 'M251.28 184.76 H348.72 Q347.04 241.88 300 243.56 Q252.96 241.88 251.28 184.76Z';

// boxes are the painted area of each part in logo units: x, y, width, height
const BOX = {
  l1: [27.1, 52.5, 187.4, 225.5],
  o: [209, 82, 185, 188.7],
  face: [209, 82, 182.6, 188.7],
  l2: [402.6, 53.6, 181.2, 225.9],
  st1: [192, 24, 40, 40],
  st2: [378, 36, 28, 28],
  st3: [558, 234, 32, 32],
};

const pct = (v) => `${Number(v.toFixed(3))}%`;

function place([x, y, w, h], [px, py, pw, ph] = [0, 0, W, H]) {
  return {
    left: pct(((x - px) / pw) * 100),
    top: pct(((y - py) / ph) * 100),
    width: pct((w / pw) * 100),
    height: pct((h / ph) * 100),
  };
}

function Art({ box, className, style, children }) {
  return (
    <svg className={className} style={style} viewBox={box.join(' ')} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function Letter({ name, fill, rotate, shift = 0 }) {
  const stroke = { stroke: INK, strokeWidth: 14, strokeLinejoin: 'round' };
  return (
    <span className={`lol-part lol-${name}`} style={place(BOX[name])}>
      <Art box={BOX[name]}>
        <g transform={`${rotate} translate(${shift} 0)`}>
          <path d={LETTER} transform="translate(10 12)" fill={INK} {...stroke} />
          <path d={LETTER} fill={fill} {...stroke} />
          <path d="M56 88 V172" stroke="#fff" strokeOpacity=".5" strokeWidth="12" strokeLinecap="round" />
        </g>
      </Art>
    </span>
  );
}

const STARS = [
  ['st1', 'M212 24 Q215.6 40.4 232 44 Q215.6 47.6 212 64 Q208.4 47.6 192 44 Q208.4 40.4 212 24Z', '#fff'],
  ['st2', 'M392 36 Q394.52 47.48 406 50 Q394.52 52.52 392 64 Q389.48 52.52 378 50 Q389.48 47.48 392 36Z', '#FFD23F'],
  ['st3', 'M574 234 Q576.88 247.12 590 250 Q576.88 252.88 574 266 Q571.12 252.88 558 250 Q571.12 247.12 574 234Z', '#FF4FA3'],
];

export default function LolLogo({ className = '' }) {
  const ref = useRef(null);
  const clipId = `lol-mouth-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // no need to keep bouncing while the logo is scrolled out of view
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver(([entry]) => el.classList.toggle('is-paused', !entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span ref={ref} className={`lol-anim ${className}`} role="img" aria-label="LoL">
      <Letter name="l1" fill="#FFD23F" rotate="rotate(-8 115 160)" />
      <span className="lol-part lol-o" style={place(BOX.o)}>
        <Art box={BOX.o}>
          <circle cx="310" cy="185" r="84" fill={INK} />
        </Art>
        <Art box={BOX.face} className="lol-face" style={place(BOX.face, BOX.o)}>
          <g transform="rotate(-5 300 173)">
            <circle cx="300" cy="173" r="84" fill="#FF4FA3" />
            <path d="M247.92 129.32 A71.4 71.4 0 0 1 308.4 100.76" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="10.08" strokeLinecap="round" />
            <path d="M252.96 166.28 q16.8 -25.2 33.6 0" fill="none" stroke={INK} strokeWidth="11.76" strokeLinecap="round" />
            <path d="M313.44 166.28 q16.8 -25.2 33.6 0" fill="none" stroke={INK} strokeWidth="11.76" strokeLinecap="round" />
            <path d="M242.04 174.68 c-8.4 11.76 -13.44 21.84 -5.04 28.56 c8.4 5.04 16.8 -5.04 8.4 -28.56z" fill="#35E0FF" stroke={INK} strokeWidth="4.2" strokeLinejoin="round" />
            <path d="M357.96 174.68 c8.4 11.76 13.44 21.84 5.04 28.56 c-8.4 5.04 -16.8 -5.04 -8.4 -28.56z" fill="#35E0FF" stroke={INK} strokeWidth="4.2" strokeLinejoin="round" />
            <clipPath id={clipId}>
              <path d={MOUTH} />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              <rect x="216" y="173" width="168" height="84" fill={INK} />
              <rect x="216" y="181.4" width="168" height="16.8" fill="#fff" />
              <ellipse cx="300" cy="243.56" rx="28.56" ry="20.16" fill="#FF9ACB" />
            </g>
            <path d={MOUTH} fill="none" stroke={INK} strokeWidth="6.72" strokeLinejoin="round" />
            <circle cx="300" cy="173" r="84" fill="none" stroke={INK} strokeWidth="14" />
          </g>
        </Art>
      </span>
      <Letter name="l2" fill="#35E0FF" rotate="rotate(7 489 160)" shift={374} />
      {STARS.map(([name, d, fill]) => (
        <Art key={name} box={BOX[name]} className={`lol-star ${name}`} style={place(BOX[name])}>
          <path d={d} fill={fill} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
        </Art>
      ))}
    </span>
  );
}
