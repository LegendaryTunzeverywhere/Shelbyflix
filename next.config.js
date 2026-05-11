/** @type {import('next').NextConfig} */

// ---------------------------------------------------------------------------
// Security headers — applied at the Next.js / CDN layer as a second layer
// behind the middleware.ts headers. Belt-and-suspenders: if middleware ever
// fails to run (e.g. during static export or a Vercel edge-function cold
// start), these headers are still served via the Next.js headers() config.
// ---------------------------------------------------------------------------
const securityHeaders = [
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-XSS-Protection',          value: '1; mode=block' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https: wss:",
      "font-src 'self' data:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,

  // ── Security headers on all routes ──────────────────────────────────────
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },

  webpack(config, { isServer }) {
    if (!isServer) {
      config.externals.push('pino-pretty', 'lokijs', 'encoding');
    }

    // Fallbacks for Node.js built-in modules
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs:  false,
      net: false,
      tls: false,
    };

    // Alias optional/Node-only deps that leak into the client bundle from
    // the Aptos wallet adapter ecosystem. These are never actually called
    // in the browser — they're behind conditional imports or unused code paths.
    config.resolve.alias = {
      ...config.resolve.alias,
      // @aptos-labs/aptos-client ships a Node transport that imports 'got'
      got: false,
      // @aptos-connect/web-transport optionally imports Telegram bridge
      '@telegram-apps/bridge': false,
    };

    return config;
  },

  typescript: {
    // Keep this false — build errors should never be silently ignored
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig;