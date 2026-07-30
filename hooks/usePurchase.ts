'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from './useWallet';
import { aptos } from '@/lib/aptos';
import { buildPurchaseTransaction } from '@/lib/payments';
import { getAptosClient } from '@/lib/aptos-client';
import { ACCESS_CONTROL_MODULE } from '@/lib/move-contract';
import { logChainWriteSuccess } from '@/lib/move-logging';

// ---------------------------------------------------------------------------
// usePurchase
//
// Orchestrates the full Purchasable-video purchase flow from the viewer's
// perspective. Two code paths exist, selected by the feature flag:
//
// ## Supabase path (NEXT_PUBLIC_ACCESS_BACKEND !== "move")
//   1. Build the 1-or-2 transfer payloads via `buildPurchaseTransaction`
//   2. Sign+submit each payload, wait for chain confirmation
//   3. POST to /api/payments/verify with exponential backoff
//   4. On verify failure after chain success → `needsManualRetry`
//
// ## Move path (NEXT_PUBLIC_ACCESS_BACKEND === "move")
//   1. Resolve `full_blob_name` via GET /api/videos/:id/blob-name
//   2. Call `is_new_buyer(wallet)` view (10s timeout)
//   3. If new buyer → submit `init_new_buyer`, waitForTransaction 60s
//   4. Submit `purchase(full_blob_name)`, waitForTransaction 60s
//   5. Re-fetch GET /api/videos/:id/access with up to 3 retries at 2s
//   6. Transition to playable only when reason ∈ {purchased, public}
//
// Under move: never invoke `buildPurchaseTransaction` or POST /verify.
//
// State machine: 'idle' | 'signing' | 'verifying' | 'success' | 'error'
//
// Requirements covered: 12.1–12.11, 14.2, 15.6
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
  /** Called after purchase is confirmed and access is granted. */
  onSuccess?: () => void;
}

export interface UsePurchaseResult {
  state: PurchaseState;
  error: string | null;
  purchase: () => Promise<void>;
  reset: () => void;
  /** True when payment went through but verify/access-check failed after retries. */
  needsManualRetry: boolean;
  /**
   * Re-run the verification/access-check against the already-submitted
   * transaction. Does NOT re-sign — the funds are on-chain.
   */
  retryVerify: () => Promise<void>;
}

// Wait times (ms) between verify retries (supabase path).
const VERIFY_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

// Move path: access re-fetch retry config (Req 12.8)
const ACCESS_RETRY_COUNT = 3;
const ACCESS_RETRY_DELAY_MS = 2_000;

// Move path: transaction wait timeouts
const IS_NEW_BUYER_TIMEOUT_MS = 10_000;
const WAIT_FOR_TX_TIMEOUT_MS = 60_000;

/**
 * Static abort-code → user-message map for Move purchase failures (Req 12.9).
 * Covers the documented abort codes from the access_control module.
 * The raw abort code is always surfaced alongside for support diagnostics.
 */
export const PURCHASE_ABORT_MESSAGES: Record<number, string> = {
  1: 'Policy is not Purchasable for this video.',
  2: 'Insufficient SUSD balance.',
  3: 'Purchase price changed. Refresh and try again.',
  4: 'Wallet needs to initialize before purchasing.',
  5: 'Blob is not registered on chain.',
  6: 'Receipt already exists for this wallet.',
  7: 'Module is paused.',
};

/**
 * Recognise wallet-rejection errors so we can return to `idle` instead of
 * surfacing a scary error message.
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
  return /reject|cancel|denied|declin/i.test(msg);
}

/**
 * Determine if the flag indicates the move backend is active.
 * Read at point of use per Req 15.6.
 */
function isMoveBackend(): boolean {
  return process.env.NEXT_PUBLIC_ACCESS_BACKEND === 'move';
}

/**
 * Extract a Move abort code from an error thrown by the Aptos SDK.
 * Returns the numeric abort code or null if not a Move abort.
 */
function extractAbortCode(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  // The Aptos SDK surfaces abort codes in various shapes depending on version
  const errAny = err as Record<string, unknown>;

  // Check for vm_status with abort code pattern
  if (typeof errAny.message === 'string') {
    const match = errAny.message.match(/abort[_ ]code[:\s]*(\d+)/i);
    if (match) return parseInt(match[1], 10);
    // Also check for ABORT_CODE or Move abort patterns
    const match2 = errAny.message.match(/Move abort.*?(\d+)/i);
    if (match2) return parseInt(match2[1], 10);
  }

  // Check for structured error with abort_code field
  if ('abort_code' in errAny && typeof errAny.abort_code === 'number') {
    return errAny.abort_code;
  }
  if ('data' in errAny && typeof errAny.data === 'object' && errAny.data !== null) {
    const data = errAny.data as Record<string, unknown>;
    if ('abort_code' in data && typeof data.abort_code === 'number') {
      return data.abort_code;
    }
  }

  return null;
}

/**
 * Format a Move abort error into a user-facing message with the raw code
 * for support diagnostics (Req 12.9).
 */
function formatAbortError(err: unknown, entryFn: string): string {
  const code = extractAbortCode(err);
  if (code !== null) {
    const userMsg = PURCHASE_ABORT_MESSAGES[code] ?? 'Transaction aborted by the contract.';
    return `${userMsg} (abort code ${code}, function: ${entryFn})`;
  }
  // Fallback for non-abort errors
  const msg = err instanceof Error ? err.message : String(err);
  return `Transaction failed: ${msg} (function: ${entryFn})`;
}

// ---------------------------------------------------------------------------
// Supabase-path helpers (unchanged)
// ---------------------------------------------------------------------------

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
    return {
      ok: false,
      retryable: true,
      reason: err instanceof Error ? err.message : 'network_error',
    };
  }

  let data: { hasAccess?: unknown; reason?: unknown } = {};
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }

  if (res.ok && data?.hasAccess === true) {
    return { ok: true };
  }

  const reason =
    typeof data?.reason === 'string' && data.reason.length > 0
      ? data.reason
      : `http_${res.status}`;

  const retryable = res.status >= 500 || res.status === 429;
  return retryable
    ? { ok: false, retryable: true, reason }
    : { ok: false, retryable: false, reason };
}

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
      await new Promise((resolve) =>
        setTimeout(resolve, VERIFY_RETRY_DELAYS_MS[attempt - 1]),
      );
    }

    const result = await callVerifyOnce(body);
    if (result.ok) return { ok: true } as const;

    lastReason = result.reason;
    if (!result.retryable) {
      return { ok: false as const, reason: lastReason, ranOutOfRetries: false };
    }
  }
  return { ok: false as const, reason: lastReason, ranOutOfRetries: true };
}

// ---------------------------------------------------------------------------
// Move-path helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the full_blob_name for a video via the server endpoint.
 * Keeps the uploader_wallet off the client (Req 12.1 design note).
 */
async function resolveFullBlobName(videoId: string): Promise<string> {
  const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/blob-name`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error ?? `Failed to resolve blob name (HTTP ${res.status})`,
    );
  }
  const data = await res.json();
  if (typeof data.fullBlobName !== 'string' || data.fullBlobName.length === 0) {
    throw new Error('Server returned empty blob name');
  }
  return data.fullBlobName;
}

/**
 * Call `is_new_buyer(wallet)` view with a 10-second timeout (Req 12.1).
 * Returns true/false or throws on timeout/error (ChainUnavailableError
 * semantics — caller handles the error state).
 */
async function checkIsNewBuyer(wallet: string): Promise<boolean> {
  const client = getAptosClient();
  const timeoutSentinel = Symbol('timeout');

  const result = await Promise.race([
    client.view<[boolean]>({
      payload: {
        function: `${ACCESS_CONTROL_MODULE}is_new_buyer` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [wallet],
      },
    }),
    new Promise<typeof timeoutSentinel>((resolve) =>
      setTimeout(() => resolve(timeoutSentinel), IS_NEW_BUYER_TIMEOUT_MS),
    ),
  ]);

  if (result === timeoutSentinel) {
    throw new ChainUnavailableError('is_new_buyer view timed out after 10s');
  }

  // The view returns [bool]
  const arr = result as unknown[];
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new ChainUnavailableError('is_new_buyer returned unexpected shape');
  }
  return Boolean(arr[0]);
}

/**
 * Lightweight error class for chain-unavailable pre-submit errors.
 * Distinct from the backend's ChainUnavailableError (which is server-side).
 */
class ChainUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainUnavailableError';
  }
}

/**
 * Re-fetch GET /api/videos/:id/access with up to 3 retries at 2-second
 * delay on chain_unavailable / 5xx (Req 12.8). Returns the access result
 * or throws if all retries exhausted.
 */
async function fetchAccessWithRetries(
  videoId: string,
  wallet: string,
): Promise<{ hasAccess: boolean; reason: string }> {
  let lastError: string = 'unknown';

  for (let attempt = 0; attempt <= ACCESS_RETRY_COUNT; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, ACCESS_RETRY_DELAY_MS));
    }

    try {
      const res = await fetch(
        `/api/videos/${encodeURIComponent(videoId)}/access?wallet=${encodeURIComponent(wallet)}`,
      );

      if (res.status >= 500 && res.status <= 599) {
        lastError = `HTTP ${res.status}`;
        continue; // retryable
      }

      const data = await res.json();

      if (data?.reason === 'chain_unavailable') {
        lastError = 'chain_unavailable';
        continue; // retryable
      }

      return data as { hasAccess: boolean; reason: string };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'network_error';
      continue; // retryable
    }
  }

  throw new Error(
    `Access check failed after ${ACCESS_RETRY_COUNT + 1} attempts: ${lastError}`,
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePurchase(args: UsePurchaseArgs): UsePurchaseResult {
  const { videoId, priceBaseUnits, creatorWallet, walletAddress, onSuccess } =
    args;
  const { signAndSubmitTransaction } = useWallet();

  const [state, setState] = useState<PurchaseState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [needsManualRetry, setNeedsManualRetry] = useState(false);

  // Captures the creator-transfer hash (supabase path) or purchase tx hash
  // (move path) so `retryVerify` can re-run without re-signing.
  const pendingTxHashRef = useRef<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  // ── retryVerify ──────────────────────────────────────────────────────────
  // Under move: re-fetches access. Under supabase: re-calls /verify.
  const retryVerify = useCallback(async () => {
    if (!mountedRef.current) return;

    // Move path: retry the access check only
    if (isMoveBackend()) {
      setState('verifying');
      setError(null);

      try {
        const accessResult = await fetchAccessWithRetries(videoId, walletAddress);
        if (!mountedRef.current) return;

        if (
          accessResult.hasAccess &&
          (accessResult.reason === 'purchased' || accessResult.reason === 'public')
        ) {
          setState('success');
          setNeedsManualRetry(false);
          pendingTxHashRef.current = null;
          onSuccessRef.current?.();
        } else {
          setState('error');
          setNeedsManualRetry(true);
          setError(
            `Access not yet confirmed (reason: ${accessResult.reason}). Try again in a moment.`,
          );
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setState('error');
        setNeedsManualRetry(true);
        setError(
          err instanceof Error
            ? err.message
            : 'Access check failed. Try again in a moment.',
        );
      }
      return;
    }

    // Supabase path: retry /api/payments/verify
    const hash = pendingTxHashRef.current;
    if (!hash) return;

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

    setState('error');
    setNeedsManualRetry(true);
    setError(
      outcome.ranOutOfRetries
        ? `Verification still failing (${outcome.reason}). Try again in a moment.`
        : `Verification failed: ${outcome.reason}.`,
    );
  }, [videoId, walletAddress]);

  // ── purchase (move path) ─────────────────────────────────────────────────
  const purchaseMove = useCallback(async () => {
    if (!walletAddress) {
      setState('error');
      setError('Connect a wallet before purchasing.');
      return;
    }

    setError(null);
    setNeedsManualRetry(false);
    pendingTxHashRef.current = null;

    // Step 1: Resolve full_blob_name (Req 12.1)
    let fullBlobName: string;
    try {
      fullBlobName = await resolveFullBlobName(videoId);
    } catch (err) {
      if (!mountedRef.current) return;
      setState('error');
      setError(
        err instanceof Error ? err.message : 'Failed to resolve blob name.',
      );
      return;
    }

    if (!mountedRef.current) return;

    // Step 2: Check is_new_buyer (Req 12.1, 12.2)
    let isNewBuyer: boolean;
    try {
      isNewBuyer = await checkIsNewBuyer(walletAddress);
    } catch (err) {
      if (!mountedRef.current) return;
      // ChainUnavailableError → retryable pre-submit error state (Req 12.2)
      setState('error');
      setNeedsManualRetry(false);
      setError(
        'Chain temporarily unreachable. Could not verify buyer status. Please try again.',
      );
      return;
    }

    if (!mountedRef.current) return;
    setState('signing');

    // Step 3: If new buyer → init_new_buyer (Req 12.3, 12.4)
    if (isNewBuyer) {
      try {
        const initRes = await signAndSubmitTransaction({
          data: {
            function: `${ACCESS_CONTROL_MODULE}init_new_buyer` as `${string}::${string}::${string}`,
            typeArguments: [],
            functionArguments: [],
          },
        });

        const initHash: unknown = (initRes as { hash?: unknown })?.hash;
        if (typeof initHash !== 'string' || initHash.length === 0) {
          throw new Error('Wallet returned no transaction hash for init_new_buyer');
        }

        // Wait for commit with 60s timeout (Req 12.4)
        const client = getAptosClient();
        const initTxResult = await client.waitForTransaction({
          transactionHash: initHash,
          options: { timeoutSecs: WAIT_FOR_TX_TIMEOUT_MS / 1000 },
        });

        // Check for abort / non-success
        if (initTxResult && 'success' in initTxResult && !initTxResult.success) {
          throw new Error(
            formatAbortError(initTxResult, 'init_new_buyer'),
          );
        }

        // Emit logChainWriteSuccess (Req 14.2)
        logChainWriteSuccess('init_new_buyer', {
          videoId,
          txHash: initHash,
          version: (initTxResult as { version?: number | string })?.version ?? 0,
        });
      } catch (err) {
        if (!mountedRef.current) return;
        if (isUserRejection(err)) {
          setState('idle');
          setError(null);
          pendingTxHashRef.current = null;
          return;
        }
        // Fail-closed: do not submit purchase (Req 12.4)
        setState('error');
        setError(formatAbortError(err, 'init_new_buyer'));
        return;
      }

      if (!mountedRef.current) return;
    }

    // Step 4: Submit purchase(full_blob_name) (Req 12.5, 12.6)
    let purchaseHash: string;
    try {
      const purchaseRes = await signAndSubmitTransaction({
        data: {
          function: `${ACCESS_CONTROL_MODULE}purchase` as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [fullBlobName],
        },
      });

      const hash: unknown = (purchaseRes as { hash?: unknown })?.hash;
      if (typeof hash !== 'string' || hash.length === 0) {
        throw new Error('Wallet returned no transaction hash for purchase');
      }
      purchaseHash = hash;

      // Wait for commit with 60s timeout
      const client = getAptosClient();
      const purchaseTxResult = await client.waitForTransaction({
        transactionHash: purchaseHash,
        options: { timeoutSecs: WAIT_FOR_TX_TIMEOUT_MS / 1000 },
      });

      // Check for abort / non-success (Req 12.9)
      if (purchaseTxResult && 'success' in purchaseTxResult && !purchaseTxResult.success) {
        throw Object.assign(
          new Error(formatAbortError(purchaseTxResult, 'purchase')),
          { _txResult: purchaseTxResult },
        );
      }

      // Emit logChainWriteSuccess (Req 14.2)
      logChainWriteSuccess('purchase', {
        videoId,
        txHash: purchaseHash,
        version: (purchaseTxResult as { version?: number | string })?.version ?? 0,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      if (isUserRejection(err)) {
        setState('idle');
        setError(null);
        pendingTxHashRef.current = null;
        return;
      }
      setState('error');
      setError(formatAbortError(err, 'purchase'));
      pendingTxHashRef.current = null;
      return;
    }

    if (!mountedRef.current) return;

    // Step 5: Re-fetch access with retries (Req 12.7, 12.8)
    pendingTxHashRef.current = purchaseHash;
    setState('verifying');

    try {
      const accessResult = await fetchAccessWithRetries(videoId, walletAddress);
      if (!mountedRef.current) return;

      if (
        accessResult.hasAccess &&
        (accessResult.reason === 'purchased' || accessResult.reason === 'public')
      ) {
        // Transition to playable (Req 12.7)
        setState('success');
        setNeedsManualRetry(false);
        pendingTxHashRef.current = null;
        onSuccessRef.current?.();
      } else {
        // Access not yet confirmed — hold in post-commit state
        setState('error');
        setNeedsManualRetry(true);
        setError(
          `Purchase confirmed on-chain but access not yet available (reason: ${accessResult.reason}). Try again in a moment.`,
        );
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // All retries exhausted (Req 12.8)
      setState('error');
      setNeedsManualRetry(true);
      setError(
        `Purchase confirmed on-chain but access check failed after retries. Your funds are safe — hit retry to confirm access.`,
      );
    }
  }, [videoId, walletAddress, signAndSubmitTransaction]);

  // ── purchase (supabase path) ─────────────────────────────────────────────
  const purchaseSupabase = useCallback(async () => {
    if (!walletAddress) {
      setState('error');
      setError('Connect a wallet before purchasing.');
      return;
    }

    setError(null);
    setNeedsManualRetry(false);
    pendingTxHashRef.current = null;

    // Build the 1-or-2 payloads (Req 12.10: never called under move)
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

    let creatorTxHash: string | null = null;
    try {
      for (let i = 0; i < payloads.length; i++) {
        const res = await signAndSubmitTransaction({ data: payloads[i] });
        const hash: unknown = (res as { hash?: unknown })?.hash;
        if (typeof hash !== 'string' || hash.length === 0) {
          throw new Error('Wallet returned no transaction hash');
        }
        if (i === 0) {
          creatorTxHash = hash;
        }
        await aptos.waitForTransaction({ transactionHash: hash });
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (isUserRejection(err)) {
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
      if (!mountedRef.current) return;
      setState('error');
      setError('No transaction hash returned by wallet.');
      return;
    }

    if (!mountedRef.current) return;

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

  // ── purchase (dispatches based on flag at point of use — Req 15.6) ───────
  const purchase = useCallback(async () => {
    if (isMoveBackend()) {
      return purchaseMove();
    }
    return purchaseSupabase();
  }, [purchaseMove, purchaseSupabase]);

  return { state, error, purchase, reset, needsManualRetry, retryVerify };
}

export default usePurchase;
