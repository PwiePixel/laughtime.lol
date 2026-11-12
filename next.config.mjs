/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // this folder is the project root, even when it sits inside another checkout
  turbopack: { root: import.meta.dirname },
  // the custom server (server/) is plain Node and not part of the Next bundle
  outputFileTracingExcludes: { '*': ['./data/**'] },
  async headers() {
    return [
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
};

export default nextConfig;
