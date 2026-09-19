/**
 * CSRF Protection Constants — Edge-compatible (no Node.js crypto imports)
 *
 * These constants are shared between the Edge middleware and the full
 * Node.js CSRF module (lib/csrf.ts). Extracted here so the middleware
 * can import them without pulling in Node.js-only dependencies.
 */

/** CSRF cookie name */
export const CSRF_COOKIE_NAME = 'csrf-token';

/** CSRF header name */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** CSRF cookie max age in seconds (24 hours) */
export const CSRF_COOKIE_MAX_AGE = 86400;

/**
 * Paths exempt from CSRF checks.
 * These endpoints use alternative authentication mechanisms:
 * - /api/admin/cleanup-expired: uses x-cron-secret header auth
 * - /api/auth/challenge: issues nonces (no state change, read-like semantics)
 * - /api/auth/check-access: wallet signature verification (has its own auth)
 * - /api/users: wallet-based user creation (called during initial setup before CSRF token is available)
 *
 * NOTE: /api/uploads/staging-token (the Supabase Storage-based replacement
 * for the old Vercel Blob staging flow) does NOT need an exemption — it's
 * called via lib/shelby.ts's own csrfFetch(), unlike the old Vercel Blob
 * approach where a third-party SDK's internal fetch() couldn't attach our
 * CSRF header.
 */
export const CSRF_EXEMPT_PATHS: string[] = [
  '/api/admin/cleanup-expired',
  '/api/auth/challenge',
  '/api/auth/check-access',
  '/api/users',
];
