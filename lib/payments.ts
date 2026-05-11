/**
 * lib/payments.ts
 *
 * Canonical payment math and configuration for Purchasable videos.
 *
 * This module is imported by BOTH the client (to build the purchase
 * transaction) and the server (to verify that a claimed payment matches
 * what we expected). Keeping the constants and split formula in one place
 * guarantees that both sides agree on the exact fee routing — no drift.
 *
 * Scope of this file (per task 1.5):
 *   - PLATFORM_FEE_BPS (basis points — 10_000 = 100%)
 *   - PLATFORM_TREASURY (address receiving the fee)
 *   - splitPrice() — deterministic fee/creator split
 *   - FeeSplit interface
 *   - Import-time guard that throws if the configured treasury address is
 *     malformed, so a broken env override is caught on boot rather than
 *     silently routing funds to 0x0.
 *
 * buildPurchaseTransaction() is intentionally NOT in this file yet — it
 * is added by task 3.1.
 *
 * Requirements covered: 8.1, 8.2, 8.3, 8.5
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Platform fee in basis points.
 * 10_000 bps = 100%. 1_000 bps = 10.00%.
 *
 * Exposing the fee as bps (rather than a hard-coded "10") keeps the fee
 * percentage tweakable from a single place in the codebase. Any future
 * change rolls forward cleanly because client and server read the same
 * constant when building and verifying transactions (Req 8.5).
 */
export const PLATFORM_FEE_BPS = 1000;

/**
 * Fixed-point denominator for PLATFORM_FEE_BPS. Not configurable — bps is
 * always out of 10_000 by definition.
 */
const BPS_DENOMINATOR = 10_000;

/**
 * Default platform treasury address, as specified in the requirements.
 * Can be overridden per-environment with NEXT_PUBLIC_PLATFORM_TREASURY
 * (e.g. pointing at a throwaway devnet address for local testing).
 *
 * The NEXT_PUBLIC_ prefix is required because this constant is read on
 * the client when building the purchase transaction.
 */
const DEFAULT_PLATFORM_TREASURY =
  '0x15ff27e78780a703a5e064ff087ac6078ed4889f6f25fa40f2f4d1e39f73ff25';

/**
 * Regex matching a valid Aptos address: 0x-prefixed, 1-64 lowercase or
 * uppercase hex characters. Matches the same shape used by
 * `isValidAptosAddress` in lib/aptos.ts.
 */
const APTOS_ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

function isValidAptosAddress(address: string): boolean {
  return APTOS_ADDRESS_REGEX.test(address);
}

/**
 * Resolves the treasury address from env, falling back to the hard-coded
 * default. If the configured value is malformed, throws IMMEDIATELY at
 * import time (Req 8.3) — this fails fast during server startup or
 * client bundle evaluation rather than silently shipping a broken value.
 */
function resolveTreasuryAddress(): string {
  const override = process.env.NEXT_PUBLIC_PLATFORM_TREASURY?.trim();
  const candidate = override && override.length > 0 ? override : DEFAULT_PLATFORM_TREASURY;

  if (!isValidAptosAddress(candidate)) {
    throw new Error(
      `[lib/payments] Invalid PLATFORM_TREASURY address: "${candidate}". ` +
        'Expected 0x-prefixed hex (1-64 chars). ' +
        'Check NEXT_PUBLIC_PLATFORM_TREASURY in your environment.',
    );
  }

  return candidate;
}

/**
 * The platform treasury address that receives the fee portion of every
 * Purchasable video payment. Validated at module load.
 */
export const PLATFORM_TREASURY: string = resolveTreasuryAddress();

// ---------------------------------------------------------------------------
// Fee split
// ---------------------------------------------------------------------------

/**
 * Result of splitting a Purchasable-video price into the two on-chain
 * transfers that make up a single purchase transaction.
 *
 * Amounts are in SHELBYUSD base units (8 decimals). Both values are
 * non-negative integers, and `creator + platform === priceBaseUnits`
 * for any non-negative integer input (Req 8.2).
 */
export interface FeeSplit {
  /** Amount transferred to the creator's wallet (base units). */
  creator: number;
  /** Amount transferred to PLATFORM_TREASURY (base units). May be 0. */
  platform: number;
}

/**
 * Splits a purchase price into the creator share and the platform fee.
 *
 * Rules (per Requirements 8.1, 8.2, 8.4):
 *   platform = floor(price * PLATFORM_FEE_BPS / 10_000)
 *   creator  = price - platform
 *
 * Computing the creator side as a subtraction (rather than a separate
 * floor) guarantees `creator + platform === price` exactly, with no
 * rounding gap. When the price is so small that the fee floors to 0,
 * the full amount goes to the creator and the platform transfer can be
 * omitted from the transaction (handled in buildPurchaseTransaction).
 *
 * @param priceBaseUnits Non-negative integer in SHELBYUSD base units.
 *                       Must be a safe integer; non-integer or negative
 *                       values throw so callers catch bad inputs early
 *                       rather than shipping a malformed transaction.
 */
export function splitPrice(priceBaseUnits: number): FeeSplit {
  if (!Number.isFinite(priceBaseUnits) || !Number.isInteger(priceBaseUnits)) {
    throw new Error(
      `[lib/payments] splitPrice: priceBaseUnits must be an integer, got ${priceBaseUnits}`,
    );
  }
  if (priceBaseUnits < 0) {
    throw new Error(
      `[lib/payments] splitPrice: priceBaseUnits must be non-negative, got ${priceBaseUnits}`,
    );
  }

  // Math.floor on a product of two safe integers is itself exact as long
  // as the product stays below Number.MAX_SAFE_INTEGER. PLATFORM_FEE_BPS
  // is 1_000, so inputs up to ~9e15 are safe — well above any realistic
  // ShelbyUSD price.
  const platform = Math.floor((priceBaseUnits * PLATFORM_FEE_BPS) / BPS_DENOMINATOR);
  const creator = priceBaseUnits - platform;

  return { creator, platform };
}

// ---------------------------------------------------------------------------
// Purchase transaction builder (task 3.1)
// ---------------------------------------------------------------------------

import type { InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';
import { SHELBYUSD_TOKEN } from './aptos';

/**
 * Input to `buildPurchaseTransaction`.
 *
 * `creatorWallet` must be a valid Aptos address (0x-prefixed, 1-64 hex).
 * `priceBaseUnits` must be a positive, safe integer in SHELBYUSD base units.
 * The caller is responsible for looking up the creator's wallet and the
 * video's configured price from the `videos` row before invoking this
 * builder — this function does no DB I/O.
 */
export interface PurchasePayload {
  videoId: string;
  priceBaseUnits: number;
  creatorWallet: string;
}

/**
 * Builds the on-chain purchase transaction(s) for a Purchasable video.
 *
 * Returns an array of 1 or 2 `InputGenerateTransactionPayloadData` entries:
 *   [0] creator share  → `0x1::primary_fungible_store::transfer` to creator
 *   [1] platform fee   → `0x1::primary_fungible_store::transfer` to treasury
 *                        (omitted when the floor'd fee is 0)
 *
 * Why an array rather than a single payload:
 *   The design document (Design Decisions §1) specified Option B — a single
 *   transaction that performs both transfers atomically. However, the
 *   standard Aptos wallet-adapter `InputGenerateTransactionPayloadData`
 *   shape can only encode ONE entry-function call. True multi-action
 *   atomic transactions require either (a) a dedicated on-chain Move
 *   entry script, or (b) a compiled `TransactionPayloadScript` whose
 *   bytecode is not portable across wallet adapters.
 *
 *   Rather than deploy a new Move module for v1, we take the fallback
 *   path explicitly called out in the design's Risk callout: submit two
 *   sequential transfers and require BOTH to succeed before a receipt is
 *   written. The caller (hooks/usePurchase.ts, task 5.3) submits each
 *   payload in order, and /api/payments/verify (task 3.5) re-fetches the
 *   creator-transfer tx and independently confirms the platform fee was
 *   settled by the same sender. If either leg fails, no receipt is
 *   written and the viewer can retry.
 *
 *   This means Req 8.2 ("both transfers sum to the full price with no
 *   rounding gap") is enforced by `splitPrice`, and Req 8.4 ("fee==0
 *   still succeeds with only the creator transfer") is enforced by
 *   omitting the second payload when the fee floors to 0. True atomicity
 *   will land when we deploy a Move entry script — tracked in Future Work.
 *
 * Requirements covered:
 *   - 5.2: build an on-chain transaction that transfers creator share and
 *          platform fee in SHELBYUSD using primary_fungible_store::transfer.
 *   - 8.1: platform fee = floor(price * PLATFORM_FEE_BPS / 10_000),
 *          computed by splitPrice.
 *   - 8.2: creator + platform === price exactly (subtraction, not floor).
 *   - 8.4: when floor'd fee is 0, skip the platform transfer.
 *
 * @throws if priceBaseUnits is not a positive integer, or if creatorWallet
 *         is not a valid Aptos address (fail fast so we never ship a
 *         malformed transaction to the wallet).
 */
export function buildPurchaseTransaction(
  payload: PurchasePayload,
): InputGenerateTransactionPayloadData[] {
  const { priceBaseUnits, creatorWallet } = payload;

  // ── Input validation ────────────────────────────────────────────────────
  // splitPrice() enforces integer+non-negative, but this builder is stricter:
  // we must have a *positive* price (a zero-price "purchase" is nonsensical;
  // the free-Purchasable edge case is handled upstream in resolveAccess
  // by treating the video as Public — see task 2.4, Req 5.7).
  if (!Number.isFinite(priceBaseUnits) || !Number.isInteger(priceBaseUnits)) {
    throw new Error(
      `[lib/payments] buildPurchaseTransaction: priceBaseUnits must be an integer, got ${priceBaseUnits}`,
    );
  }
  if (priceBaseUnits <= 0) {
    throw new Error(
      `[lib/payments] buildPurchaseTransaction: priceBaseUnits must be > 0, got ${priceBaseUnits}`,
    );
  }
  if (!creatorWallet || !isValidAptosAddress(creatorWallet)) {
    throw new Error(
      `[lib/payments] buildPurchaseTransaction: invalid creatorWallet address "${creatorWallet}"`,
    );
  }

  const { creator, platform } = splitPrice(priceBaseUnits);

  // `primary_fungible_store::transfer<T: key>(sender, metadata, recipient, amount)`
  // `sender` is injected from the signer when the wallet submits, so
  // functionArguments carries only [metadata, recipient, amount].
  //
  // We follow the same pattern `registerShelbyUSD` uses in lib/aptos.ts:
  // typeArguments is left empty and the metadata object is passed as the
  // first function argument. The wallet adapter + ts-sdk resolve the
  // generic from the runtime metadata object.
  const TRANSFER_FN =
    '0x1::primary_fungible_store::transfer' as `${string}::${string}::${string}`;

  const creatorTransfer: InputGenerateTransactionPayloadData = {
    function:          TRANSFER_FN,
    typeArguments:     [],
    functionArguments: [SHELBYUSD_TOKEN, creatorWallet, creator.toString()],
  };

  // Per Req 8.4: when the floor'd platform fee rounds to 0 (e.g. dust-level
  // prices) we omit the platform transfer entirely so the transaction is
  // not rejected for transferring 0. The creator still receives the full
  // amount because creator = price - 0 = price.
  if (platform === 0) {
    return [creatorTransfer];
  }

  const platformTransfer: InputGenerateTransactionPayloadData = {
    function:          TRANSFER_FN,
    typeArguments:     [],
    functionArguments: [SHELBYUSD_TOKEN, PLATFORM_TREASURY, platform.toString()],
  };

  return [creatorTransfer, platformTransfer];
}
