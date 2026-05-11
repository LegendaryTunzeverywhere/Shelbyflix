// lib/shared-utils.ts
// Consolidated utility functions used across multiple API routes and library modules.
// All shared helpers live here to ensure bug fixes propagate consistently.

// ---------------------------------------------------------------------------
// Hex / byte conversion
// ---------------------------------------------------------------------------

/**
 * Convert a hex string to a Uint8Array.
 * Throws if the input has an odd number of characters.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Address / hash formatting
// ---------------------------------------------------------------------------

/**
 * Truncate a hex hash or address for logging purposes.
 * Returns the first 10 and last 4 characters separated by "...".
 * Short strings (≤14 chars) are returned as-is.
 */
export function truncateHash(hex: string): string {
  if (!hex) return '';
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 10)}...${hex.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

/**
 * Emit a structured JSON warn log for rejection events.
 * Produces a single-line JSON object suitable for log aggregation.
 */
export function logRejection(
  route: string,
  event: string,
  context: Record<string, unknown>,
): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      route,
      event,
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}

// ---------------------------------------------------------------------------
// Aptos address validation
// ---------------------------------------------------------------------------

/** Regex for a valid Aptos address: 0x followed by 1-64 hex characters. */
export const APTOS_ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

/** Validate whether a string is a well-formed Aptos address. */
export function isValidAptosAddress(address: string): boolean {
  return APTOS_ADDRESS_REGEX.test(address);
}

// ---------------------------------------------------------------------------
// Video ID validation
// ---------------------------------------------------------------------------

/** Regex for a valid video ID: word characters and hyphens. */
export const VIDEO_ID_REGEX = /^[\w-]+$/;

/** Validate whether a string is a well-formed video ID. */
export function isValidVideoId(id: string): boolean {
  return VIDEO_ID_REGEX.test(id);
}
