/**
 * CORS origin validation utilities.
 *
 * Pure functions for parsing allowed origins, checking origin membership,
 * and building CORS response headers. Designed for use in Next.js middleware.
 */

/**
 * Parse the ALLOWED_ORIGINS environment variable (comma-separated list of origins)
 * into a Set for O(1) lookup. Handles undefined, empty, and whitespace-padded values.
 */
export function parseAllowedOrigins(envValue: string | undefined): Set<string> {
  if (!envValue || envValue.trim() === '') {
    return new Set<string>();
  }

  const origins = envValue
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return new Set(origins);
}

/**
 * Check if an origin exactly matches an entry in the allowlist.
 * No wildcard matching, no subdomain matching — exact match only.
 */
export function isOriginAllowed(origin: string, allowlist: Set<string>): boolean {
  return allowlist.has(origin);
}

/**
 * Build CORS response headers for a permitted origin.
 * Sets Access-Control-Allow-Origin to the specific requesting origin (never "*").
 */
export function buildCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-csrf-token',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}
