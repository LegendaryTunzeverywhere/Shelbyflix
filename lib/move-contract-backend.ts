/**
 * lib/move-contract-backend.ts
 *
 * Move-backed implementation of the `AccessBackend` interface. Reads access
 * policies from the deployed Aptos `access_control` module via BCS-encoded
 * view functions and purchase state via `check_permission`.
 *
 * This module is a LAZY singleton: it does NOT call `getAptosClient()` or
 * read any Aptos-related env vars at import time. The Aptos client is
 * resolved inside each method invocation so that importing this module under
 * `NEXT_PUBLIC_ACCESS_BACKEND === "supabase"` has zero side effects and
 * opens no connections (Req 18.2).
 *
 * Requirements covered: 2.4, 2.5, 2.6, 4.1, 4.10, 5.7, 5.8, 5.9, 18.2
 */

import type { AccessBackend } from './access-control';
import { normalizeAddress } from './access-control';
import { ACCESS_CONTROL_MODULE } from './move-contract';
import { getAptosClient } from './aptos-client';
import { getSupabaseAdmin } from './supabase-admin';
import { logChainViewFailure } from './move-logging';
import {
  deserializeBlobMetadataV2,
  microsToMs,
  assertSafeU64,
  ChainDeserializationError,
} from './move-bcs';
import type { AccessConfig } from '@/types';

// ---------------------------------------------------------------------------
// ChainUnavailableError
// ---------------------------------------------------------------------------

/**
 * Thrown by `getConfig` and `hasPurchased` when a chain read fails. The
 * `code` field classifies the failure into one of three stable categories
 * so `resolveAccess` can surface `chain_unavailable` without inspecting
 * error messages (Req 4.10, 4.11, 4.12, 5.7, 5.8, 5.9).
 */
export class ChainUnavailableError extends Error {
  constructor(
    public readonly code: 'timeout' | 'decode' | 'view_error',
    public readonly videoId: string,
    cause?: unknown,
  ) {
    super(`chain_unavailable (${code}) video=${videoId}`, { cause });
    this.name = 'ChainUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Bounded LRU cache for create_full_blob_name results (Req 2.5)
// ---------------------------------------------------------------------------

/**
 * A minimal bounded LRU cache. Entries are evicted in least-recently-used
 * order once the capacity is reached. Keyed on `${canonicalOwner}|${suffix}`
 * and stores the resolved `full_blob_name` string.
 */
class BoundedLruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict the least-recently-used entry (first key in insertion order)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}

/** Process-lifetime LRU cache for `create_full_blob_name` results (Req 2.5). */
const blobNameCache = new BoundedLruCache<string, string>(10_000);

// ---------------------------------------------------------------------------
// View timeout helper (Req 4.4, 4.10, 5.7)
// ---------------------------------------------------------------------------

/**
 * Race a view-function promise against a wall-clock timeout. Returns the
 * resolved value on success or throws a `ChainUnavailableError` with
 * `code: 'timeout'` when the deadline elapses first.
 *
 * Shared by `getConfig` and `hasPurchased` so the 10-second timeout
 * semantics are defined in exactly one place.
 */
export async function viewWithTimeout<T>(
  viewPromise: Promise<T>,
  timeoutMs: number,
  videoId: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ChainUnavailableError('timeout', videoId));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([viewPromise, timeoutPromise]);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Default view-call timeout in milliseconds (Req 4.4). */
const VIEW_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Full blob-name resolution (Req 2.4, 2.5, 2.6)
// ---------------------------------------------------------------------------

/**
 * Resolve the full blob name for a given `(canonicalOwner, suffix)` pair.
 *
 * 1. Check the LRU cache first.
 * 2. On cache miss, call the module's `create_full_blob_name` view function.
 * 3. On view failure (any class), fall back to `${canonicalOwner}/${suffix}`
 *    with a single warn log and WITHOUT caching the fallback result.
 *
 * Returns `null` when `canonicalOwner` is empty or `suffix` is
 * null/undefined/whitespace-only — callers should treat this as
 * "unresolvable" and short-circuit.
 */
async function resolveFullBlobName(
  canonicalOwner: string,
  suffix: string | null | undefined,
  videoId: string,
): Promise<string | null> {
  // Req 2.4: reject empty owner or empty/whitespace suffix
  if (!canonicalOwner || canonicalOwner.length === 0) return null;
  const trimmedSuffix = suffix?.trim() ?? '';
  if (trimmedSuffix.length === 0) return null;

  const cacheKey = `${canonicalOwner}|${trimmedSuffix}`;

  // Check cache first (Req 2.5)
  const cached = blobNameCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Attempt the on-chain view call
  try {
    const client = getAptosClient();
    const result = await viewWithTimeout(
      client.view({
        payload: {
          function: `${ACCESS_CONTROL_MODULE}create_full_blob_name`,
          typeArguments: [],
          functionArguments: [canonicalOwner, trimmedSuffix],
        },
      }),
      VIEW_TIMEOUT_MS,
      videoId,
    );

    // Validate the response shape: expect a single-element array with a string
    if (
      !Array.isArray(result) ||
      result.length !== 1 ||
      typeof result[0] !== 'string' ||
      result[0].length === 0
    ) {
      throw new Error(
        `create_full_blob_name returned unexpected shape: length=${
          Array.isArray(result) ? result.length : 'non-array'
        }`,
      );
    }

    const fullBlobName = result[0] as string;
    // Cache the successful result (Req 2.5)
    blobNameCache.set(cacheKey, fullBlobName);
    return fullBlobName;
  } catch (err) {
    // Req 2.6: fall back to `${canonicalOwner}/${suffix}` on any failure,
    // log a single warning, and do NOT cache the fallback.
    const failureClass =
      err instanceof ChainUnavailableError
        ? err.code
        : 'view_error';

    logChainViewFailure('view_error', {
      videoId,
      wallet: canonicalOwner,
      message: `create_full_blob_name fallback for owner=${canonicalOwner.slice(0, 10)}... suffix=${trimmedSuffix}: ${failureClass}`,
    });

    return `${canonicalOwner}/${trimmedSuffix}`;
  }
}

// ---------------------------------------------------------------------------
// moveContractBackend singleton (Req 4.1, 18.2)
// ---------------------------------------------------------------------------

/**
 * The Move-backed `AccessBackend` implementation. Exported as a plain object
 * whose methods lazily call `getAptosClient()` — no top-level env reads or
 * client construction at import time (Req 18.2).
 */
export const moveContractBackend: AccessBackend = {
  /**
   * Read the on-chain access policy for a video.
   *
   * 1. Validate videoId shape
   * 2. Read (uploader_wallet, blob_name, expiration_timestamp) from Supabase
   * 3. Resolve Full_Blob_Name via LRU cache
   * 4. Call get_maybe_blob_metadata_bcs with 10-second timeout
   * 5. Decode hex → bytes → BlobMetadataV2
   * 6. Map via Table 4a to AccessConfig
   *
   * Returns null for missing/unregistered videos.
   * Throws ChainUnavailableError on chain failures (never returns partial).
   *
   * Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11,
   *              4.12, 4.13, 4.14, 11.2, 11.4, 11.5, 14.1
   */
  async getConfig(videoId: string): Promise<AccessConfig | null> {
    // Req 4.3: validate videoId shape — reject non-matching with null
    if (!videoId || !/^[\w-]+$/.test(videoId)) return null;

    // Req 4.2/4.3: read only the columns we need from the videos row
    const supabase = getSupabaseAdmin();
    const { data: row, error: dbError } = await supabase
      .from('videos')
      .select('uploader_wallet, blob_name, expiration_timestamp')
      .eq('video_id', videoId)
      .maybeSingle();

    // Req 4.3: missing row or DB error → null
    if (dbError || !row) return null;

    // Req 4.3: null/empty/whitespace columns → null
    const rawWallet: string | null | undefined = row.uploader_wallet;
    const rawBlobName: string | null | undefined = row.blob_name;
    const expirationTimestamp: number = row.expiration_timestamp;

    if (
      !rawWallet || rawWallet.trim().length === 0 ||
      !rawBlobName || rawBlobName.trim().length === 0
    ) {
      return null;
    }

    // Canonicalize the owner wallet (Req 2.1, 4.7)
    const canonicalOwner = normalizeAddress(rawWallet, 'videos.uploader_wallet');
    if (canonicalOwner.length === 0) return null;

    // Req 2.4: resolve Full_Blob_Name with LRU cache
    const fullBlobName = await resolveFullBlobName(canonicalOwner, rawBlobName, videoId);
    if (!fullBlobName) return null;

    // Req 4.4: invoke get_maybe_blob_metadata_bcs with 10-second timeout
    let viewResult: unknown[];
    try {
      const client = getAptosClient();
      viewResult = await viewWithTimeout(
        client.view({
          payload: {
            function: `${ACCESS_CONTROL_MODULE}get_maybe_blob_metadata_bcs`,
            typeArguments: [],
            functionArguments: [fullBlobName],
          },
        }),
        VIEW_TIMEOUT_MS,
        videoId,
      );
    } catch (err) {
      // Req 4.10: timeout already wrapped as ChainUnavailableError('timeout')
      if (err instanceof ChainUnavailableError) {
        logChainViewFailure(err.code === 'timeout' ? 'view_timeout' : 'view_error', {
          videoId,
          wallet: canonicalOwner,
          message: `get_maybe_blob_metadata_bcs failed: ${err.code} - ${err.message}`,
        });
        throw err;
      }
      // Req 4.11: network/transport/non-2xx → view_error
      logChainViewFailure('view_error', {
        videoId,
        wallet: canonicalOwner,
        message: `get_maybe_blob_metadata_bcs failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw new ChainUnavailableError('view_error', videoId, err);
    }

    // Req 4.11: validate response shape — must be a single-element array
    if (!Array.isArray(viewResult) || viewResult.length !== 1) {
      const errMsg = `get_maybe_blob_metadata_bcs returned unexpected shape: length=${
        Array.isArray(viewResult) ? viewResult.length : 'non-array'
      }`;
      logChainViewFailure('view_error', {
        videoId,
        wallet: canonicalOwner,
        message: errMsg,
      });
      throw new ChainUnavailableError('view_error', videoId, new Error(errMsg));
    }

    // The view function returns a vector<u8> as a hex-encoded string
    const hexPayload = viewResult[0];
    if (typeof hexPayload !== 'string') {
      const errMsg = `get_maybe_blob_metadata_bcs returned non-string payload: ${typeof hexPayload}`;
      logChainViewFailure('view_error', {
        videoId,
        wallet: canonicalOwner,
        message: errMsg,
      });
      throw new ChainUnavailableError('view_error', videoId, new Error(errMsg));
    }

    // Decode hex string to Uint8Array
    let bytes: Uint8Array;
    try {
      // Strip 0x prefix if present
      const cleanHex = hexPayload.startsWith('0x') ? hexPayload.slice(2) : hexPayload;
      const byteArray = new Uint8Array(cleanHex.length / 2);
      for (let i = 0; i < cleanHex.length; i += 2) {
        byteArray[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
      }
      bytes = byteArray;
    } catch (err) {
      const errMsg = `get_maybe_blob_metadata_bcs hex decode failed: ${err instanceof Error ? err.message : String(err)}`;
      logChainViewFailure('view_decode_error', {
        videoId,
        wallet: canonicalOwner,
        message: errMsg,
      });
      throw new ChainUnavailableError('decode', videoId, err);
    }

    // Req 4.5/4.6/4.12: deserialize BCS bytes
    let metadata;
    try {
      metadata = deserializeBlobMetadataV2(bytes, videoId);
    } catch (err) {
      // Req 4.12: BCS decode failure → ChainUnavailableError('decode')
      if (err instanceof ChainDeserializationError) {
        logChainViewFailure('view_decode_error', {
          videoId,
          wallet: canonicalOwner,
          message: `BCS decode failed: ${err.reason} at offset ${err.offset}/${err.inputLength}${err.field ? ` field=${err.field}` : ''}`,
        });
        throw new ChainUnavailableError('decode', videoId, err);
      }
      logChainViewFailure('view_decode_error', {
        videoId,
        wallet: canonicalOwner,
        message: `BCS decode failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw new ChainUnavailableError('decode', videoId, err);
    }

    // Req 4.5: None → null (blob not registered)
    if (metadata === null) {
      return null;
    }

    // Req 4.6: Map BlobMetadataV2 → AccessConfig per Table 4a
    const policy = metadata.access_policy;
    const ownerWallet = normalizeAddress(metadata.owner, 'BlobMetadataV2.owner');

    // Build the AccessConfig based on the policy variant
    let accessConfig: AccessConfig;

    try {
      switch (policy.kind) {
        case 'Allowlist': {
          // Table 4a: Allowlist → accessMode: 'allowlist', allowlist = addresses.map(canonical)
          const allowlist = policy.addresses.map(
            (addr, i) => normalizeAddress(addr, `Allowlist.addresses[${i}]`),
          ).filter(a => a.length > 0);

          accessConfig = {
            videoId,                          // Req 4.8
            ownerWallet,                      // Req 4.7
            accessMode: 'allowlist',
            allowlist,
            expirationTimestamp,              // Req 4.9
          };
          break;
        }

        case 'TimeLock': {
          // Table 4a: TimeLock → accessMode: 'timelock', unlockAt = microsToMs(locked_until)
          const unlockAt = microsToMs(policy.locked_until, videoId);

          accessConfig = {
            videoId,
            ownerWallet,
            accessMode: 'timelock',
            unlockAt,
            expirationTimestamp,
          };
          break;
        }

        case 'PayToDownload': {
          if (policy.price === 0n) {
            // Table 4a: PayToDownload price=0 → accessMode: 'public'
            accessConfig = {
              videoId,
              ownerWallet,
              accessMode: 'public',
              expirationTimestamp,
            };
          } else {
            // Table 4a: PayToDownload price>0 → accessMode: 'purchasable'
            const safePriceBigint = assertSafeU64(policy.price, 'price', videoId);
            const priceBaseUnits = Number(safePriceBigint);

            accessConfig = {
              videoId,
              ownerWallet,
              accessMode: 'purchasable',
              priceBaseUnits,
              expirationTimestamp,
            };
          }
          break;
        }

        case 'CustomModule': {
          // Table 4a: CustomModule → accessMode: 'public' + one warn log
          console.warn(
            JSON.stringify({
              level: 'warn',
              event: 'custom_module_fallback_to_public',
              videoId,
              message: `CustomModule policy encountered for video=${videoId}, treating as public`,
            }),
          );

          accessConfig = {
            videoId,
            ownerWallet,
            accessMode: 'public',
            expirationTimestamp,
          };
          break;
        }

        default: {
          // Should never happen — exhaustiveness guard
          const _exhaustive: never = policy;
          void _exhaustive;
          throw new Error(`Unknown AccessPolicy kind`);
        }
      }
    } catch (err) {
      // Req 4.12: unit conversion overflow (from microsToMs or assertSafeU64)
      if (err instanceof ChainDeserializationError) {
        logChainViewFailure('view_decode_error', {
          videoId,
          wallet: canonicalOwner,
          message: `Unit conversion failed: ${err.reason} field=${err.field ?? 'unknown'}`,
        });
        throw new ChainUnavailableError('decode', videoId, err);
      }
      throw err;
    }

    // Req 4.14: never return a partial config — we have a fully decoded one
    return accessConfig;
  },

  async hasPurchased(videoId: string, wallet: string): Promise<boolean> {
    // -----------------------------------------------------------------------
    // Step 1: Canonicalize wallet — empty sentinel → false immediately (Req 5.5)
    // -----------------------------------------------------------------------
    const canonicalWallet = normalizeAddress(wallet, 'hasPurchased.wallet');
    if (canonicalWallet.length === 0) {
      return false;
    }

    // -----------------------------------------------------------------------
    // Step 2: Read the videos row for uploader_wallet + blob_name (Req 5.6)
    // -----------------------------------------------------------------------
    const supabase = getSupabaseAdmin();
    const { data: row, error: dbError } = await supabase
      .from('videos')
      .select('uploader_wallet, blob_name')
      .eq('video_id', videoId)
      .maybeSingle();

    if (dbError || !row) return false;

    const uploaderWallet = row.uploader_wallet;
    const blobName = row.blob_name;

    // Missing or null uploader_wallet / blob_name → false (Req 5.6)
    if (
      !uploaderWallet ||
      (typeof uploaderWallet === 'string' && uploaderWallet.trim().length === 0)
    ) {
      return false;
    }
    if (
      !blobName ||
      (typeof blobName === 'string' && blobName.trim().length === 0)
    ) {
      return false;
    }

    // -----------------------------------------------------------------------
    // Step 3: Resolve full_blob_name (Req 2.4)
    // -----------------------------------------------------------------------
    const canonicalOwner = normalizeAddress(uploaderWallet, 'videos.uploader_wallet');
    if (canonicalOwner.length === 0) return false;

    const fullBlobName = await resolveFullBlobName(canonicalOwner, blobName, videoId);
    if (!fullBlobName) return false;

    // -----------------------------------------------------------------------
    // Step 4: Invoke check_permission with 10-second timeout (Req 5.1)
    // -----------------------------------------------------------------------
    let result: unknown[];
    try {
      const client = getAptosClient();
      result = await viewWithTimeout(
        client.view({
          payload: {
            function: `${ACCESS_CONTROL_MODULE}check_permission`,
            typeArguments: [],
            functionArguments: [canonicalWallet, fullBlobName],
          },
        }),
        VIEW_TIMEOUT_MS,
        videoId,
      );
    } catch (err) {
      // Classify the error (Req 5.7, 5.8, 5.9)
      if (err instanceof ChainUnavailableError) {
        // Already classified (e.g. timeout from viewWithTimeout)
        logChainViewFailure('view_timeout', {
          videoId,
          wallet: canonicalWallet,
          message: `check_permission ${err.code}: ${String(err.cause ?? err.message)}`,
        });
        throw err;
      }
      // Everything else: VM abort, non-2xx, transport error → view_error
      const chainErr = new ChainUnavailableError('view_error', videoId, err);
      logChainViewFailure('view_error', {
        videoId,
        wallet: canonicalWallet,
        message: `check_permission failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw chainErr;
    }

    // -----------------------------------------------------------------------
    // Step 5: Parse the Option<bool> response (Req 5.2, 5.3, 5.4)
    // -----------------------------------------------------------------------
    // The Aptos SDK returns view function results as a JSON array.
    // For `check_permission(address, String): Option<bool>`, the response
    // is a single-element array where the element represents the Move
    // `Option<bool>` as `{ vec: [] }` (None) or `{ vec: [true/false] }` (Some).
    try {
      if (!Array.isArray(result) || result.length !== 1) {
        throw new Error(
          `check_permission returned unexpected array length: ${
            Array.isArray(result) ? result.length : 'non-array'
          }`,
        );
      }

      const optionValue = result[0];

      // The SDK represents Move Option<T> as { vec: T[] }
      // None → { vec: [] }, Some(x) → { vec: [x] }
      if (
        optionValue === null ||
        optionValue === undefined ||
        typeof optionValue !== 'object'
      ) {
        throw new Error(
          `check_permission returned non-object element: ${typeof optionValue}`,
        );
      }

      const optObj = optionValue as { vec?: unknown[] };

      if (!('vec' in optObj) || !Array.isArray(optObj.vec)) {
        throw new Error(
          `check_permission returned element without vec array: ${JSON.stringify(optionValue).slice(0, 100)}`,
        );
      }

      const vec = optObj.vec;

      // None (empty vec) → false (Req 5.4)
      if (vec.length === 0) {
        return false;
      }

      // Some(bool) → extract the boolean (Req 5.2, 5.3)
      const boolValue = vec[0];
      if (boolValue === true) return true;
      if (boolValue === false) return false;

      // The value might come as a string "true"/"false" from some SDK versions
      if (boolValue === 'true') return true;
      if (boolValue === 'false') return false;

      // Unrecognized inner value → decode error
      throw new Error(
        `check_permission Option<bool> inner value unrecognized: ${JSON.stringify(boolValue)}`,
      );
    } catch (err) {
      // Decode failure → ChainUnavailableError('decode') (Req 5.8)
      if (err instanceof ChainUnavailableError) throw err;
      const chainErr = new ChainUnavailableError('decode', videoId, err);
      logChainViewFailure('view_decode_error', {
        videoId,
        wallet: canonicalWallet,
        message: `check_permission decode failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw chainErr;
    }
  },
};

// ---------------------------------------------------------------------------
// Exported internals for testing
// ---------------------------------------------------------------------------

/** @internal Exposed for unit tests only. */
export const _internals = {
  blobNameCache,
  resolveFullBlobName,
  viewWithTimeout,
  VIEW_TIMEOUT_MS,
  BoundedLruCache,
};
