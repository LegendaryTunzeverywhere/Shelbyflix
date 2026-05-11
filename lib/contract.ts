/**
 * lib/contract.ts
 *
 * Thin public-API wrapper over the purchase and access-resolution
 * primitives. The React layer uses `hooks/usePurchase.ts` and
 * `hooks/useVideoAccess.ts` for UI-driven flows with state machines and
 * retries. This module exists so non-React callers (scripts, server-side
 * code, future integrations) can share the exact same transaction shape
 * and access decision without duplicating logic.
 *
 * Both functions are pure delegations:
 *   - `purchaseVideo`    → lib/payments.ts (build) + wallet adapter (sign)
 *                          + lib/aptos.ts (wait), with receipt verification
 *                          handled elsewhere by /api/payments/verify.
 *   - `checkVideoAccess` → lib/access-control.ts `resolveAccess`.
 *
 * Requirements covered: 5.2, 7.1
 */

import { aptos } from './aptos';
import { buildPurchaseTransaction } from './payments';
import { resolveAccess, supabaseBackend, normalizeAddress } from './access-control';

/**
 * Resolve whether `walletAddress` may currently play `videoId`. Returns
 * just the boolean so callers that only need the gate decision (not the
 * reason or metadata) can stay concise. Callers that need the full
 * discriminated result should use `resolveAccess` directly.
 *
 * Address is lowercased via `normalizeAddress` before being handed to the
 * resolver — the same canonicalization every other entry point uses
 * (Req 3.1, 3.2), so case mismatches can never turn into false negatives.
 */
export async function checkVideoAccess(
  videoId: string,
  walletAddress: string,
): Promise<boolean> {
  const result = await resolveAccess(videoId, normalizeAddress(walletAddress));
  return result.hasAccess;
}

/**
 * Build, sign, and submit the on-chain purchase transaction(s) for a
 * Purchasable video, returning the creator-transfer hash. The caller is
 * expected to POST `{ videoId, txHash, walletAddress }` to
 * `/api/payments/verify` to convert the chain write into a persisted
 * receipt — this function does NOT write a receipt itself.
 *
 * Why the FIRST hash is returned:
 *   `buildPurchaseTransaction` emits up to two payloads — the creator
 *   transfer (index 0) and the platform fee (index 1, may be absent when
 *   the fee floors to 0). `/api/payments/verify` inspects the creator
 *   transfer to cross-check both legs of the split via deposit events
 *   (see task 3.5), so that is the hash we surface.
 *
 * Validation (fail fast BEFORE touching the wallet):
 *   - Fetches the video's access config via `supabaseBackend.getConfig`.
 *     Missing config → "Video not found" (likely a deleted video or a
 *     malformed id).
 *   - Rejects non-Purchasable videos so an accidental caller can't
 *     prompt a wallet sig for a free video.
 *   - Rejects non-positive prices so a free Purchasable video (treated
 *     as Public per Req 5.7) never reaches the wallet.
 *
 * Transaction ordering:
 *   Each payload is signed, submitted, and awaited sequentially. Waiting
 *   between submits preserves nonce ordering and ensures the verify call
 *   downstream sees a committed transaction rather than a pending one.
 *
 * Note: the React-side `usePurchase` hook performs the same orchestration
 * but layered with state tracking, cancellation handling, and verify
 * retries. The two paths must stay in sync — any change to the payload
 * shape or ordering here must land in the hook as well.
 */
export async function purchaseVideo(
  walletAddress: string,
  signAndSubmitTransaction: any,
  videoId: string,
): Promise<{ txHash: string }> {
  const config = await supabaseBackend.getConfig(videoId);

  if (!config) {
    throw new Error(`[lib/contract] Video not found: ${videoId}`);
  }
  if (config.accessMode !== 'purchasable') {
    throw new Error(
      `[lib/contract] Video ${videoId} is not purchasable (mode: ${config.accessMode})`,
    );
  }
  if (!config.priceBaseUnits || config.priceBaseUnits <= 0) {
    // Req 5.7 — free Purchasable is resolved as Public upstream, so we
    // should never reach a wallet prompt for a zero-price purchase.
    throw new Error(
      `[lib/contract] Video ${videoId} has no price set`,
    );
  }

  const payloads = buildPurchaseTransaction({
    videoId,
    priceBaseUnits: config.priceBaseUnits,
    creatorWallet: config.ownerWallet,
  });

  // Capture the first hash (creator transfer) for the verify pipeline.
  // We reference `walletAddress` only for error messages — the wallet
  // adapter injects the sender itself from its connected account.
  let creatorTxHash: string | null = null;
  for (let i = 0; i < payloads.length; i++) {
    const response = await signAndSubmitTransaction({ data: payloads[i] });
    const hash: unknown = response?.hash;
    if (typeof hash !== 'string' || hash.length === 0) {
      throw new Error(
        `[lib/contract] Wallet ${walletAddress} returned no transaction hash for payload ${i}`,
      );
    }
    if (i === 0) {
      creatorTxHash = hash;
    }
    // Await chain confirmation before submitting the next payload so
    // nonces stay ordered and any later verify sees committed state.
    await aptos.waitForTransaction({ transactionHash: hash });
  }

  if (!creatorTxHash) {
    // Defensive — `buildPurchaseTransaction` always returns at least the
    // creator payload, so the loop above must have set this. Guard in
    // case a future refactor changes that invariant.
    throw new Error('[lib/contract] Purchase produced no transaction hash');
  }

  return { txHash: creatorTxHash };
}
