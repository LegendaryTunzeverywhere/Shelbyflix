/**
 * Centralized helpers for reading Shelby-related environment variables.
 *
 * Shelbynet's fullnode (https://api.shelbynet.shelby.xyz/v1) now requires an
 * API key for all requests. The key must be sent as `Authorization: Bearer <key>`
 * via the Aptos SDK's `clientConfig.API_KEY` option (which the Shelby SDK
 * forwards via `getAptosConfig`). If the key is missing, the fullnode returns
 * 401 Unauthorized: "API key not found" — which previously surfaced as a
 * confusing 502 "Shelby upload failed" in the upload route.
 *
 * This module provides a single place to resolve the key from either
 * `SHELBY_API_KEY` (server-only, preferred) or `NEXT_PUBLIC_SHELBY_API_KEY`
 * (fallback, allowed by env-validator).
 */

export function getShelbyApiKey(): string | undefined {
  const raw =
    process.env.SHELBY_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SHELBY_API_KEY?.trim() ||
    '';
  return raw.length > 0 ? raw : undefined;
}

/**
 * Returns the API key or throws with a clear, actionable message.
 * Use this in server routes that cannot function without the key.
 */
export function requireShelbyApiKey(): string {
  const key = getShelbyApiKey();
  if (!key) {
    throw new Error(
      'SHELBY_API_KEY is not configured. Set SHELBY_API_KEY (or NEXT_PUBLIC_SHELBY_API_KEY) ' +
        'in your environment. Get a key at https://shelby.xyz/api-keys and add it to ' +
        'Vercel Environment Variables (or .env.local for local dev). ' +
        'See .env.example for documentation.',
    );
  }
  return key;
}

/**
 * Build an AptosConfig `clientConfig` object containing the API key,
 * if available. Returns undefined when no key is configured so callers
 * can pass it directly to `new AptosConfig({ clientConfig })`.
 */
export function getAptosClientConfigWithApiKey():
  | { API_KEY: string }
  | undefined {
  const key = getShelbyApiKey();
  return key ? { API_KEY: key } : undefined;
}
