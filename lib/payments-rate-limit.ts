/**
 * Shared in-memory sliding-window rate limiter for `POST /api/payments/verify`.
 *
 * Keyed by `walletAddress + videoId` — each key carries a ring of request
 * timestamps. On every check we prune timestamps older than the window,
 * count what's left, and either accept (pushing the current timestamp)
 * or reject with the number of seconds until the oldest timestamp in
 * the window expires (so the client knows exactly when retry will
 * succeed).
 *
 * Policy (Req 12.2): at most 5 requests per 10 minutes per (wallet, video).
 *
 * Like `lib/nonce-store.ts`, we stash the Map behind a `globalThis` key so
 * Next.js route-handler module reloads (HMR in dev, separate compiled
 * bundles in prod) still share a single limiter instance per process.
 * For multi-instance deployments this should be swapped for Redis /
 * Upstash — the exported function signature is the swap boundary.
 *
 * Unlike nonce-store, we schedule a background sweep because a stale
 * (wallet, video) key that never gets checked again would otherwise sit
 * in memory forever. A single interval per process is enough; the
 * globalThis guard also suppresses duplicate timers across HMR reloads.
 */

/** Maximum number of verify requests allowed per (wallet, video) per window. */
export const RATE_LIMIT_MAX_REQUESTS = 5;

/** Sliding window duration in milliseconds. */
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/** Interval between background sweeps that drop keys whose ring has emptied. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const STORE_KEY = '__shelbyflix_payments_rate_limit_store__' as const;
const TIMER_KEY = '__shelbyflix_payments_rate_limit_timer__' as const;

type GlobalWithRateLimit = typeof globalThis & {
  [STORE_KEY]?: Map<string, number[]>;
  [TIMER_KEY]?: ReturnType<typeof setInterval>;
};

const g = globalThis as GlobalWithRateLimit;

/**
 * Map of `${walletLc}:${videoId}` → sorted array of request timestamps
 * (ms since epoch). Arrays stay small (≤ RATE_LIMIT_MAX_REQUESTS + 1 in
 * the worst case between prune and push) so the linear scans below are
 * effectively O(1).
 */
const store: Map<string, number[]> =
  g[STORE_KEY] ?? (g[STORE_KEY] = new Map());

function makeKey(walletAddress: string, videoId: string): string {
  // Lowercase the wallet so `0xABC…` and `0xabc…` hit the same bucket.
  // videoId is already case-sensitive upstream (matches VIDEO_ID_REGEX).
  return `${walletAddress.toLowerCase()}:${videoId}`;
}

/**
 * Drop timestamps that fell out of the current window from `stamps` in
 * place. Returns the mutated array for convenience. Since timestamps
 * are appended in ascending order, we can slice from the first
 * still-valid index rather than filtering.
 */
function pruneStamps(stamps: number[], now: number): number[] {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let i = 0;
  while (i < stamps.length && stamps[i] <= cutoff) i++;
  if (i > 0) stamps.splice(0, i);
  return stamps;
}

/**
 * Sweep every key and drop ones whose window has fully emptied. Cheap
 * to call periodically because the ring for each key is bounded.
 */
export function pruneRateLimit(): void {
  const now = Date.now();
  for (const [key, stamps] of store.entries()) {
    pruneStamps(stamps, now);
    if (stamps.length === 0) store.delete(key);
  }
}

// Schedule the background sweep exactly once per process. The
// globalThis timer guard stops us from piling up intervals on every HMR
// reload in dev.
if (!g[TIMER_KEY]) {
  const timer = setInterval(pruneRateLimit, SWEEP_INTERVAL_MS);
  // Next.js runs on Node in production and Edge in some contexts — both
  // support `unref` on Node timers and ignore it elsewhere. Calling it
  // keeps the interval from holding the process open during shutdown.
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
  g[TIMER_KEY] = timer;
}

export interface RateLimitResult {
  /** Whether this request is within the per-(wallet,video) budget. */
  allowed: boolean;
  /**
   * When `allowed === false`, the number of whole seconds until the
   * oldest timestamp in the window expires (and therefore the next
   * retry will succeed). Always ≥ 1 so the client never polls a
   * zero-second `Retry-After` tight loop.
   */
  retryAfterSec?: number;
}

/**
 * Check whether a verify call for `(walletAddress, videoId)` should be
 * allowed right now. On allow, the current timestamp is recorded so
 * subsequent calls in the same window count against the budget. On
 * deny, the store is NOT mutated — denied calls don't push the window
 * forward, so a client that keeps hammering won't extend its own
 * lockout beyond the natural `retryAfterSec` returned here.
 *
 * Req 12.2: 5 requests / 10 minutes per (wallet, video).
 */
export function checkRateLimit(
  walletAddress: string,
  videoId: string,
): RateLimitResult {
  const now = Date.now();
  const key = makeKey(walletAddress, videoId);

  const stamps = store.get(key) ?? [];
  pruneStamps(stamps, now);

  if (stamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    // Oldest timestamp in the window drops off at `oldest + window`.
    // Clients should wait at least that long. Guard with `Math.max(1, …)`
    // so we never suggest retrying in 0 seconds — boundary arithmetic
    // (oldest === now - window) would otherwise round to 0 and invite
    // an immediate re-hit.
    const oldest = stamps[0];
    const msUntilFree = oldest + RATE_LIMIT_WINDOW_MS - now;
    const retryAfterSec = Math.max(1, Math.ceil(msUntilFree / 1000));

    // Keep the (possibly pruned) ring referenced so the next allow
    // path doesn't have to re-create it from scratch.
    if (!store.has(key) && stamps.length > 0) store.set(key, stamps);
    return { allowed: false, retryAfterSec };
  }

  stamps.push(now);
  store.set(key, stamps);
  return { allowed: true };
}

/**
 * Test-only helper to wipe all state between cases. Not exported from a
 * barrel; callers must import directly from this module.
 */
export function __resetRateLimitForTests(): void {
  store.clear();
}
