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
  // locates clay.wasm at runtime with fs, relative to `import.meta.url`:
  //
  //     const here = dirname(fileURLToPath(import.meta.url));
  //     const paths = [resolve(here, "clay.wasm"),
  //                    resolve(here, "../dist/clay.wasm")];
  //
  // (both candidates are the same file — `dist/../dist/` normalises away).
  // So the wasm must exist on disk *inside the deployed function*, at the path
  // Node actually resolves at runtime. Two things must both hold for that:
  //
  //  1. The package must NOT be bundled by webpack. When it is, webpack
  //     inlines `import.meta.url` at build time as the build machine's
  //     absolute path (file:///vercel/path0/node_modules/...). That
  //     directory doesn't exist once the function runs from /var/task.
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
  //     i.e. every route — the delete path (lib/shelby-platform.ts) and the
  //     cleanup job (app/api/admin/cleanup-expired) also import the SDK, and
  //     any route that does needs the package present.
  //
  //     WHY package.json pins "@shelby-protocol/clay-codes": "0.0.4" to
  //     EXACTLY the version @shelby-protocol/sdk depends on.
  //
  //     clay-codes is not imported by app code — it is a transitive dep of
  //     the SDK. But it must be a direct dependency for npm to place a single
  //     copy at the top level, which is the only location these trace globs
  //     (and the runtime lookup) can rely on. This bit us once already:
  //     the package pinned "0.0.3" while sdk 0.8.x requires "0.0.4", so npm
  //     installed 0.0.4 *nested* under the sdk, the runtime resolved that
  //     copy, and it was neither externalized nor traced — every upload died
  //     with "Unable to locate clay.wasm. Tried: .../sdk/node_modules/
  //     @shelby-protocol/clay-codes/dist/clay.wasm".
  //
  //     If you bump the SDK, check its clay-codes requirement and keep these
  //     three in lockstep. The nested glob below is a safety net for the case
  //     where a future npm decides to re-nest anyway; it costs nothing when
  //     the path does not exist.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/@shelby-protocol/clay-codes/dist/**/*',
      './node_modules/@shelby-protocol/sdk/node_modules/@shelby-protocol/clay-codes/dist/**/*',
    ],
    '/api/uploads': [
      './node_modules/@shelby-protocol/clay-codes/dist/clay.wasm',
      './node_modules/@shelby-protocol/sdk/node_modules/@shelby-protocol/clay-codes/dist/clay.wasm',
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