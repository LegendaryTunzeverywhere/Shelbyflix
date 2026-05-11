/**
 * Shared in-memory nonce store for challenge/verify auth flow.
 *
 * Next.js compiles each route as its own module, so declaring a Map in each
 * route file creates separate instances. Putting the Map here (behind a
 * globalThis cache to survive HMR in dev) guarantees both routes see the
 * same entries.
 *
 * Supports multiple outstanding nonces per wallet (up to MAX_NONCES_PER_WALLET)
 * with IP binding to prevent cross-IP replay attacks.
 *
 * In production with multiple instances, swap this for Redis / Upstash.
 */

import { randomBytes, timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';

export interface NonceEntry {
  nonce: string;
  expiresAt: number;
  ip: string;
}

/** Maximum outstanding nonces per wallet address */
export const MAX_NONCES_PER_WALLET = 5;

export const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const GLOBAL_KEY = '__shelbyflix_nonce_store__' as const;

type GlobalWithNonceStore = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, NonceEntry[]>;
};

const g = globalThis as GlobalWithNonceStore;

export const nonceStore: Map<string, NonceEntry[]> =
  g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new Map());

/**
 * Constant-time string comparison to prevent timing attacks on nonce values.
 * Uses Node.js crypto.timingSafeEqual under the hood.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  return cryptoTimingSafeEqual(bufA, bufB);
}

/**
 * Issue a new nonce for a wallet, bound to the requesting IP.
 * Returns the nonce string on success, or null if the wallet already has
 * MAX_NONCES_PER_WALLET outstanding (non-expired) nonces.
 *
 * Prunes expired nonces for this wallet before checking the limit.
 */
export function issueNonce(walletAddress: string, ip: string): string | null {
  const key = walletAddress.toLowerCase();
  const now = Date.now();

  // Get existing entries and prune expired ones for this wallet
  let entries = nonceStore.get(key) ?? [];
  entries = entries.filter((entry) => now <= entry.expiresAt);

  // Check per-wallet limit after pruning
  if (entries.length >= MAX_NONCES_PER_WALLET) {
    nonceStore.set(key, entries);
    return null;
  }

  // Generate a new nonce
  const nonce = randomBytes(32).toString('hex');
  entries.push({
    nonce,
    expiresAt: now + NONCE_TTL_MS,
    ip,
  });

  nonceStore.set(key, entries);
  return nonce;
}

/**
 * Verify and consume a nonce. Returns true if the nonce is valid, not expired,
 * and the IP matches the one used during issuance. The nonce is removed from
 * the store on success (one-time use).
 *
 * Uses constant-time comparison for the nonce value to prevent timing attacks.
 * Returns false if:
 * - No nonces exist for the wallet
 * - The nonce is not found in the wallet's entries
 * - The nonce has expired
 * - The IP does not match the issuing IP
 */
export function verifyAndConsumeNonce(
  walletAddress: string,
  nonce: string,
  ip: string
): boolean {
  const key = walletAddress.toLowerCase();
  const entries = nonceStore.get(key);

  if (!entries || entries.length === 0) {
    return false;
  }

  const now = Date.now();

  // Find the matching nonce using constant-time comparison
  const index = entries.findIndex(
    (entry) =>
      now <= entry.expiresAt &&
      entry.ip === ip &&
      timingSafeEqual(entry.nonce, nonce)
  );

  if (index === -1) {
    return false;
  }

  // Remove the consumed nonce
  entries.splice(index, 1);

  // Clean up the wallet key if no entries remain
  if (entries.length === 0) {
    nonceStore.delete(key);
  } else {
    nonceStore.set(key, entries);
  }

  return true;
}

/**
 * Prune all expired nonces from all wallets.
 * Removes wallet keys that have no remaining valid entries.
 */
export function pruneNonces(): void {
  const now = Date.now();
  for (const [addr, entries] of nonceStore.entries()) {
    const valid = entries.filter((entry) => now <= entry.expiresAt);
    if (valid.length === 0) {
      nonceStore.delete(addr);
    } else {
      nonceStore.set(addr, valid);
    }
  }
}
