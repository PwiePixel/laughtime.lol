import localFont from 'next/font/local';

// Fonts are bundled locally (SIL OFL 1.1, see app/fonts/OFL.txt) –
// no request to Google at build time or at runtime.
export const uiFont = localFont({
  src: './fonts/fredoka.woff2',
  weight: '300 700',
  variable: '--font-ui',
  display: 'swap',
});

export const memeFont = localFont({
  src: './fonts/anton.woff2',
  weight: '400',
  variable: '--font-meme',
  display: 'block',
});
