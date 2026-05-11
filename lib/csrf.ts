import { randomBytes, timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_COOKIE_MAX_AGE,
  CSRF_EXEMPT_PATHS,
} from './csrf-constants';

/**
 * CSRF Protection — Double-Submit Cookie Pattern
 *
 * The client reads the CSRF token from a non-HttpOnly cookie and sends it
 * back in the `x-csrf-token` request header. The middleware verifies that
 * the header value matches the cookie value.
 *
 * Cookie spec:
 *   Name: csrf-token
 *   HttpOnly: false (client JS must read it to send in header)
 *   Secure: true
 *   SameSite: Strict
 *   Path: /
 *   MaxAge: 86400 (24 hours)
 */

// Re-export constants for consumers that import from this module
export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, CSRF_COOKIE_MAX_AGE, CSRF_EXEMPT_PATHS };

/**
 * Generate a cryptographically random CSRF token.
 * Returns a 32-byte hex-encoded string (64 characters).
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Verify that the header token matches the cookie token using
 * constant-time comparison to prevent timing attacks.
 *
 * Both tokens must be non-empty strings and equal.
 */
export function verifyCsrfToken(headerToken: string, cookieToken: string): boolean {
  if (!headerToken || !cookieToken) {
    return false;
  }

  if (headerToken.length !== cookieToken.length) {
    return false;
  }

  try {
    const headerBuf = new Uint8Array(Buffer.from(headerToken, 'utf-8'));
    const cookieBuf = new Uint8Array(Buffer.from(cookieToken, 'utf-8'));
    return cryptoTimingSafeEqual(headerBuf, cookieBuf);
  } catch {
    return false;
  }
}

/**
 * Check if a given pathname is exempt from CSRF validation.
 */
export function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.includes(pathname);
}
