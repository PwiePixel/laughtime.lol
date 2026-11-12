import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

// Pictures and fonts in public/ have no hash in their name: browsers may keep
// them for a day and afterwards show the old copy once more while they fetch
// the new one in the background.
const STATIC_CACHE = 'public, max-age=86400, stale-while-revalidate=2592000';
const STATIC_FILES = 'png|jpg|jpeg|gif|webp|avif|svg|ico|woff|woff2|ttf|otf';

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  reactStrictMode: true,
  poweredByHeader: false,
  // this folder is the project root, even when it sits inside another checkout
  turbopack: { root: import.meta.dirname },
  // the custom server (server/) is plain Node and not part of the Next bundle
  outputFileTracingExcludes: { '*': ['./data/**'] },
  experimental: {
    // only the icons and SDK parts that are really imported end up in the bundles
    optimizePackageImports: ['lucide-react', '@discord/embedded-app-sdk'],
  },
  async headers() {
    return [
      // Long-lived caching for the static pictures and fonts in public/.
      // Hashed files under /_next/static are sent as "immutable" for a year by
      // Next itself and are left out here; /api/media and uploads get their
      // headers from server/. Not in development: a changed file shows up at once.
      ...(phase === PHASE_DEVELOPMENT_SERVER
        ? []
        : [
            {
              source: `/:file((?!_next/).+\\.(?:${STATIC_FILES}))`,
              headers: [{ key: 'Cache-Control', value: STATIC_CACHE }],
            },
          ]),
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // no framing by other sites – except the Discord Activity page, which Discord
        // shows in an iframe (its frame-ancestors policy is set by server/server.js)
        source: '/:path((?!activity(?:/|$)).*)',
        // "/?frame_id=…" is the activity as Discord opens it
        missing: [{ type: 'query', key: 'frame_id' }],
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
    ];
  },
});

export default nextConfig;
