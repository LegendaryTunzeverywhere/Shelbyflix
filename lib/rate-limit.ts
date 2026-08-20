/**
 * Configurable per-endpoint rate limiter for middleware integration.
 *
 * ⚠️ IN-MEMORY LIMITATION:
 * This implementation uses an in-memory Map that resets on server restart
 * and is not shared across multiple server instances. For production
 * multi-instance deployments, replace the in-memory store with a
 * distributed solution such as Redis or Upstash Rate Limit.
 *
 * The exported function signatures are designed as the swap boundary —
 * replace the `Map<string, RateLimitEntry>` store with a Redis-backed
 * adapter that implements the same get/set/delete semantics.
 */

export interface RateLimitConfig {
  /** Duration of the rate limit window in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
}

export interface RateLimitEntry {
  /** Number of requests recorded in the current window. */
  count: number;
  /** Timestamp (ms since epoch) when the current window resets. */
  resetAt: number;
}

/**
 * Per-endpoint rate limit configuration.
 *
 * Keys use the pattern `pathname` or `pathname:METHOD` for method-specific limits.
 * The middleware should match the most specific key first, falling back to `default`.
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  '/api/auth/challenge': { windowMs: 60_000, maxRequests: 10 },
  '/api/auth/check-access:POST': { windowMs: 60_000, maxRequests: 20 },
  '/api/payments/verify': { windowMs: 600_000, maxRequests: 5 },
  '/api/users:POST': { windowMs: 60_000, maxRequests: 5 }, // Limit user creation to prevent spam
  '/api/users:GET': { windowMs: 60_000, maxRequests: 50 }, // More lenient for reads
  default: { windowMs: 60_000, maxRequests: 300 },
};

/**
 * Check whether a request identified by `key` is within the rate limit
 * defined by `config`.
 *
 * - If the window has elapsed, the counter resets and the request is allowed.
 * - If the counter is below the limit, it increments and the request is allowed.
 * - If the counter is at or above the limit, the request is rejected with
 *   `retryAfterSec` indicating how many seconds until the window resets.
 *
 * @param key    Unique identifier for the rate limit bucket (e.g. IP + endpoint).
 * @param config The rate limit configuration to apply.
 * @param store  The in-memory store holding current rate limit state.
 * @returns      An object with `allowed` boolean and optional `retryAfterSec`.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  store: Map<string, RateLimitEntry>
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = store.get(key);

  // Window has elapsed or no entry exists — reset and allow
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true };
  }

  // Under the limit — increment and allow
  if (entry.count < config.maxRequests) {
    entry.count++;
    return { allowed: true };
  }

  // At or over the limit — reject with retry info
  const msRemaining = entry.resetAt - now;
  const retryAfterSec = Math.max(1, Math.ceil(msRemaining / 1000));
  return { allowed: false, retryAfterSec };
}

/**
 * Remove all stale entries from the rate limit store.
 *
 * An entry is considered stale when its `resetAt` timestamp has passed,
 * meaning the window has fully elapsed and the entry is no longer needed.
 * Call this periodically to prevent unbounded memory growth.
 *
 * @param store The in-memory store to prune.
 */
export function pruneRateLimitStore(store: Map<string, RateLimitEntry>): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now >= entry.resetAt) {
      store.delete(key);
    }
  }
}
