/**
 * Client-side CSRF token utilities
 * 
 * The server sets a non-HttpOnly `csrf-token` cookie that the client
 * must read and send back in the `x-csrf-token` header for state-changing
 * requests (POST, PATCH, DELETE).
 */

import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './csrf-constants';

/**
 * Read the CSRF token from the cookie.
 * Returns the token string or undefined if not found.
 */
export function getCsrfToken(): string | undefined {
  if (typeof document === 'undefined') {
    // Server-side, no cookies available
    return undefined;
  }

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(value);
    }
  }
  return undefined;
}

/**
 * Get headers for an authenticated API request with CSRF token.
 * 
 * Usage:
 * ```ts
 * fetch('/api/videos', {
 *   method: 'POST',
 *   headers: getCsrfHeaders(),
 *   body: JSON.stringify(data)
 * })
 * ```
 */
export function getCsrfHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers[CSRF_HEADER_NAME] = csrfToken;
  }

  return headers;
}

/**
 * Make an authenticated fetch request with CSRF token included.
 * 
 * @param url - API endpoint
 * @param options - Fetch options (will be merged with CSRF headers)
 * @returns Fetch response promise
 * 
 * @example
 * ```ts
 * const response = await csrfFetch('/api/videos', {
 *   method: 'POST',
 *   body: JSON.stringify({ title: 'My Video' })
 * });
 * ```
 */
export async function csrfFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = {
    ...getCsrfHeaders(),
    ...(options.headers || {}),
  };

  return fetch(url, {
    ...options,
    headers,
  });
}
