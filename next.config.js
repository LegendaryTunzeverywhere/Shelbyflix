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
  experimental: {
    instrumentationHook: true,
  },

  // ── Shelby erasure-coding WASM (clay.wasm) ─────────────────────────────
  // @shelby-protocol/clay-codes (pulled in by @shelby-protocol/sdk/node)
  // locates clay.wasm at runtime with fs, relative to `import.meta.url`.
  // Two things must both be true for that to work on Vercel:
  //
  //  1. The package must NOT be bundled by webpack. When it is, webpack
  //     inlines `import.meta.url` at build time as the build machine's
  //     absolute path (file:///vercel/path0/node_modules/...). That
  //     directory doesn't exist once the function runs from /var/task, so
  //     every upload failed with "Unable to locate clay.wasm. Tried:
  //     /vercel/path0/node_modules/@shelby-protocol/clay-codes/dist/clay.wasm".
  //     Keeping it external makes Node load the package from node_modules at
  //     runtime, so `import.meta.url` — and the wasm lookup — is correct.
  //     Only clay-codes needs this: it has no dependencies of its own, so
  //     externalizing it can't create a second copy of @aptos-labs/ts-sdk
  //     (the SDK itself stays bundled and keeps sharing the app's copy).
  //     (@shelby-protocol/reed-solomon embeds its wasm as base64 — no
  //     file lookup, nothing to do there.)
  serverExternalPackages: ['@shelby-protocol/clay-codes'],

  //  2. The wasm binary must be shipped inside the serverless function.
  //     File tracing can't see an fs read through the import graph, so
  //     include it explicitly. '/*' is matched with picomatch `contains`,
  //     i.e. every route — the delete path (lib/shelby-platform.ts) also
  //     imports the SDK, and any route that does needs the package present.
  outputFileTracingIncludes: {
    '/*': ['./node_modules/@shelby-protocol/clay-codes/dist/**/*'],
    '/api/uploads': [
      './node_modules/@shelby-protocol/clay-codes/dist/clay.wasm',
    ],
  },

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

    // Alias optional/Node-only deps.
    // On the CLIENT: stub `got` and `@telegram-apps/bridge` since they're
    // Node-only and never called in the browser.
    // On the SERVER: let `got` (v11 installed) work normally so the Aptos
    // SDK's Node HTTP transport functions correctly. Only stub the
    // Telegram bridge which is unused.
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        got: false,
        '@telegram-apps/bridge': false,
      };
    } else {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@telegram-apps/bridge': false,
      };
    }

    return config;
  },

  typescript: {
    // Keep this false — build errors should never be silently ignored
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig;