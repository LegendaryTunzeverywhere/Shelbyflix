'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from './useWallet';
import { aptos } from '@/lib/aptos';
import { buildPurchaseTransaction } from '@/lib/payments';

// ---------------------------------------------------------------------------
// usePurchase
//
// Orchestrates the full Purchasable-video purchase flow from the viewer's
// perspective:
//
//   1. Build the 1-or-2 transfer payloads via `buildPurchaseTransaction`
//      (lib/payments.ts). Payload[0] is always the creator transfer.
//   2. Ask the wallet adapter to sign+submit each payload sequentially,
//      waiting for chain confirmation via `aptos.waitForTransaction` after
//      each one. The FIRST payload's hash is what /api/payments/verify
//      needs — it's the creator-transfer tx — so we capture it explicitly.
//   3. POST `{ videoId, txHash, walletAddress }` to /api/payments/verify.
//      On transient failure (5xx / 429 / network) retry with exponential
//      backoff (2s, 4s, 8s). Deterministic 4xx rejections
//      (tx_failed, wrong_sender, etc.) short-circuit and surface error.
//   4. If all 4 attempts fail after a successful chain write, surface
//      `needsManualRetry = true` along with a `retryVerify()` function the
//      UI can wire to a retry button. This matters because the funds have
//      already moved on-chain — we must NOT re-prompt the wallet.
//
// State machine: `'idle' | 'signing' | 'verifying' | 'success' | 'error'`
//   - idle      → before any action, and after `reset()` or a wallet rejection
//   - signing   → wallet prompt is up, or we're waiting for chain confirmation
//   - verifying → on-chain write confirmed, server verification in progress
//   - success   → verify returned `hasAccess: true`; onSuccess has been called
//   - error     → something went wrong (see `error` field); can be reset
//
// Wallet rejection detection: the wallet adapter throws with messages like
// "User rejected the request" / "cancelled" / "denied". Those transitions
// the state back to `'idle'` with no error toast so the gate renders
// cleanly, not as a failure state. Every other throw is treated as a real
// error and surfaces in `error`.
//
// Requirements covered: 5.2, 5.3, 5.5.
// ---------------------------------------------------------------------------

export type PurchaseState =
  | 'idle'
  | 'signing'
  | 'verifying'
  | 'success'
  | 'error';

export interface UsePurchaseArgs {
  videoId: string;
  priceBaseUnits: number;
  creatorWallet: string;
  /** Buyer's wallet address (already connected). */
  walletAddress: string;
  /** Called after /api/payments/verify returns hasAccess: true. */
  onSuccess?: () => void;
}

export interface UsePurchaseResult {
  state: PurchaseState;
  error: string | null;
  purchase: () => Promise<void>;
  reset: () => void;
  /** True when payment went through but verify failed after retries. */
  needsManualRetry: boolean;
  /**
   * Re-run the /api/payments/verify call against the already-submitted
   * creator-transfer hash. Does NOT re-sign — the funds are on-chain.
   */
  retryVerify: () => Promise<void>;
}

// Wait times (ms) between verify retries. Attempt #1 is immediate; these
// delays sit BETWEEN subsequent attempts. Length of this array directly
// drives the total attempt count — 3 entries = 1 initial + 3 retries = 4
// total attempts, matching the task spec ("retry up to 3 times with
// exponential backoff (2s, 4s, 8s)").
const VERIFY_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

/**
 * Recognise wallet-rejection errors so we can return to `idle` instead of
 * surfacing a scary error message. The wallet adapter ecosystem is not
 * consistent about error shapes — Petra uses "User rejected the request",
 * Google keyless auth surfaces "cancelled", some browser wallets report
 * "denied" / "declined". A broad regex over `message` covers them all
 * without leaking false positives (no legitimate non-rejection error text
 * contains these words in isolation).
 */
function isUserRejection(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : '';
  // Case-insensitive match on any of the common rejection keywords.
  return /reject|cancel|denied|declin/i.test(msg);
}

/**
 * Call /api/payments/verify once. Returns a discriminated result so the
 * caller can tell transient failures (retryable) apart from deterministic
 * ones (stop immediately — retries won't help).
 *
 *   - `ok: true`                      → server granted access
 *   - `retryable: true`               → transient (5xx / 429 / network) —
 *                                       caller should wait and try again
 *   - `retryable: false, reason`      → deterministic 4xx — stop now
 */
async function callVerifyOnce(body: {
  videoId: string;
  txHash: string;
  walletAddress: string;
}): Promise<
  | { ok: true }
  | { ok: false; retryable: true; reason: string }
  | { ok: false; retryable: false; reason: string }
> {
  let res: Response;
  try {
    res = await fetch('/api/payments/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network failure (offline, DNS, CORS edge) — always retryable.
    return {
      ok: false,
      retryable: true,
      reason: err instanceof Error ? err.message : 'network_error',
    };
  }

  // Parse the body opportunistically — the route always returns JSON, but
  // a reverse proxy or a crashed handler might not. Fall back to reason
  // codes derived from the status.
  let data: { hasAccess?: unknown; reason?: unknown } = {};
  try {
    data = await res.json();
  } catch {
    // non-JSON body is itself a signal something is wrong
  }

  if (res.ok && data?.hasAccess === true) {
    return { ok: true };
  }

  const reason =
    typeof data?.reason === 'string' && data.reason.length > 0
      ? data.reason
      : `http_${res.status}`;

  // 5xx server errors, 429 rate limits, 503 node timeouts → retryable.
  // 4xx client errors are deterministic (tx_failed, wrong_sender, etc.) —
  // no amount of retrying changes the answer, so stop immediately.
  const retryable = res.status >= 500 || res.status === 429;
  return retryable
    ? { ok: false, retryable: true, reason }
    : { ok: false, retryable: false, reason };
}

/**
 * Run the full verify pipeline: one immediate attempt plus up to
 * `VERIFY_RETRY_DELAYS_MS.length` retries with exponential backoff. A
 * deterministic 4xx failure stops the loop early. Returns the final
 * outcome so the hook can decide whether to surface `needsManualRetry`.
 */
async function verifyWithBackoff(body: {
  videoId: string;
  txHash: string;
  walletAddress: string;
}): Promise<
  | { ok: true }
  | { ok: false; reason: string; ranOutOfRetries: boolean }
> {
  let lastReason = 'unknown';
  for (let attempt = 0; attempt <= VERIFY_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      // Exponential backoff between attempts. Using the array value
      // directly (rather than pow(2, attempt) * base) makes the cadence
      // obvious at a glance and matches the design document wording.
      await new Promise((resolve) =>
        setTimeout(resolve, VERIFY_RETRY_DELAYS_MS[attempt - 1]),
      );
    }

    const result = await callVerifyOnce(body);
    if (result.ok) return { ok: true };

    lastReason = result.reason;
    if (!result.retryable) {
      // Deterministic failure — stop immediately. `ranOutOfRetries: false`
      // so the caller can distinguish "bad input" from "flaky network".
      return { ok: false, reason: lastReason, ranOutOfRetries: false };
    }
  }
  // All attempts exhausted — surface so the UI can offer a manual retry.
  return { ok: false, reason: lastReason, ranOutOfRetries: true };
}

export function usePurchase(args: UsePurchaseArgs): UsePurchaseResult {
  const { videoId, priceBaseUnits, creatorWallet, walletAddress, onSuccess } =
    args;
  const { signAndSubmitTransaction } = useWallet();

  const [state, setState] = useState<PurchaseState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [needsManualRetry, setNeedsManualRetry] = useState(false);

  // Captures the creator-transfer hash after a successful chain write so
  // `retryVerify` can re-run /verify WITHOUT re-signing. A ref (not state)
  // because it doesn't drive UI rendering and we want to read it from the
  // latest closure inside `retryVerify` without re-subscribing effects.
  const pendingTxHashRef = useRef<string | null>(null);

  // Guard against setting state after the component unmounts (e.g. the
  // viewer navigates away mid-verify). React logs a warning and we'd leak
  // the callback — this ref keeps every setState under a mount check.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep the latest `onSuccess` callback in a ref so `purchase` doesn't
  // need to rebind when the parent passes an inline function. Without
  // this, every parent re-render would invalidate the callback identity
  // and the user could click Buy on a stale closure.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
    setNeedsManualRetry(false);
    pendingTxHashRef.current = null;
  }, []);

  const retryVerify = useCallback(async () => {
    const hash = pendingTxHashRef.current;
    if (!hash) {
      // Nothing to retry — most likely the user hit retry after `reset()`
      // or before any purchase was ever started.
      return;
    }
    if (!mountedRef.current) return;

    setState('verifying');
    setError(null);

    const outcome = await verifyWithBackoff({
      videoId,
      txHash: hash,
      walletAddress,
    });
    if (!mountedRef.current) return;

    if (outcome.ok) {
      pendingTxHashRef.current = null;
      setNeedsManualRetry(false);
      setState('success');
      onSuccessRef.current?.();
      return;
    }

    // Still failing. Keep `needsManualRetry` true so the UI can stay on
    // the "payment sent, click to retry" affordance rather than showing a
    // hard error that implies the payment was lost.
    setState('error');
    setNeedsManualRetry(true);
    setError(
      outcome.ranOutOfRetries
        ? `Verification still failing (${outcome.reason}). Try again in a moment.`
        : `Verification failed: ${outcome.reason}.`,
    );
  }, [videoId, walletAddress]);

  const purchase = useCallback(async () => {
    // Guard against invoking with no connected wallet. The PurchaseGate
    // component enforces this at the UI layer, but calling `purchase()`
    // directly without a wallet must fail loudly rather than silently
    // prompting nothing and hanging in `signing` forever.
    if (!walletAddress) {
      setState('error');
      setError('Connect a wallet before purchasing.');
      return;
    }

    // Starting a new purchase: drop any stale retry affordance from a
    // previous attempt. If a prior purchase is mid-verify the first click
    // already returned — subsequent clicks start fresh.
    setError(null);
    setNeedsManualRetry(false);
    pendingTxHashRef.current = null;

    // Build the 1-or-2 payloads upfront. Errors here (malformed price,
    // bad creator address) are programmer / data-entry bugs — surface as
    // `error` without touching the wallet so the viewer isn't prompted
    // for a doomed transaction.
    let payloads: ReturnType<typeof buildPurchaseTransaction>;
    try {
      payloads = buildPurchaseTransaction({
        videoId,
        priceBaseUnits,
        creatorWallet,
      });
    } catch (err) {
      setState('error');
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to build purchase transaction',
      );
      return;
    }

    setState('signing');

    // Sign + submit each payload sequentially, capturing the first hash.
    // `signAndSubmitTransaction({ data })` is the adapter-standard shape
    // shared by Petra and the Google-keyless wrapper (see hooks/useWallet.ts).
    let creatorTxHash: string | null = null;
    try {
      for (let i = 0; i < payloads.length; i++) {
        const res = await signAndSubmitTransaction({ data: payloads[i] });
        const hash: unknown = res?.hash;
        if (typeof hash !== 'string' || hash.length === 0) {
          throw new Error('Wallet returned no transaction hash');
        }
        // Capture the FIRST hash — it's the creator transfer, which is
        // what /api/payments/verify inspects. Subsequent payloads (the
        // platform fee) are still verified by the server via the events
        // in a later revision of the pipeline, but today we only need
        // the creator hash.
        if (i === 0) {
          creatorTxHash = hash;
        }

        // Wait for chain confirmation BEFORE submitting the next payload
        // (nonce ordering + ensures our verify call finds a committed
        // transaction rather than a pending one).
        await aptos.waitForTransaction({ transactionHash: hash });
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (isUserRejection(err)) {
        // Treat cancellation as "never happened" — no error state, no
        // toast, no DB side effect. The gate re-renders in its initial
        // form so the viewer can retry at will.
        setState('idle');
        setError(null);
        pendingTxHashRef.current = null;
        return;
      }
      setState('error');
      setError(
        err instanceof Error
          ? err.message
          : 'Transaction failed before verification.',
      );
      pendingTxHashRef.current = null;
      return;
    }

    if (!creatorTxHash) {
      // Defensive — the loop above always sets this on success. If we're
      // here, something went badly wrong without throwing.
      if (!mountedRef.current) return;
      setState('error');
      setError('No transaction hash returned by wallet.');
      return;
    }

    if (!mountedRef.current) return;

    // Remember the hash so `retryVerify` can reuse it. Stored BEFORE the
    // verify call starts so even if the user navigates away and returns,
    // the gate can resume from `/verify` without re-signing.
    pendingTxHashRef.current = creatorTxHash;
    setState('verifying');

    const outcome = await verifyWithBackoff({
      videoId,
      txHash: creatorTxHash,
      walletAddress,
    });
    if (!mountedRef.current) return;

    if (outcome.ok) {
      pendingTxHashRef.current = null;
      setState('success');
      setNeedsManualRetry(false);
      onSuccessRef.current?.();
      return;
    }

    // Verify failed. The tx already moved funds on-chain (we successfully
    // awaited it), so the money isn't lost — just unconfirmed in our DB.
    // Expose `needsManualRetry` so the UI can render a "payment went
    // through but we couldn't confirm it — retry" affordance.
    setState('error');
    setNeedsManualRetry(true);
    setError(
      outcome.ranOutOfRetries
        ? `Payment succeeded on-chain but verification timed out after multiple retries (${outcome.reason}). The funds are safe — hit retry to try confirming again.`
        : `Payment succeeded on-chain but verification was rejected (${outcome.reason}).`,
    );
  }, [
    videoId,
    priceBaseUnits,
    creatorWallet,
    walletAddress,
    signAndSubmitTransaction,
  ]);

  return { state, error, purchase, reset, needsManualRetry, retryVerify };
}

export default usePurchase;
