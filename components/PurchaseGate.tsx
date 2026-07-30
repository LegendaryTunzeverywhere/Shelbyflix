'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  TicketIcon,
  ExclamationTriangleIcon,
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  WalletIcon,
} from '@heroicons/react/24/outline';
import type { VideoMetadata } from '@/types';
import { formatAddress, SHELBY_FAUCET_URL } from '@/lib/aptos';
import { usePurchase } from '@/hooks/usePurchase';
import { useShelbyAccess } from '@/hooks/useShelbyAccess';

// ---------------------------------------------------------------------------
// PurchaseGate
//
// Presentational + usePurchase wrapper that renders the Purchasable-video
// paywall. Three visual modes:
//
//   1. Disconnected   → "Connect wallet to purchase" CTA, no Buy button
//   2. Owner          → renders nothing (the viewer already owns the video)
//   3. Connected      → price, creator handle, Buy button, live state
//                       feedback from `usePurchase`
//
// Balance check sits on top of `useShelbyAccess`, which exposes the
// connected wallet's SUSD balance as a whole-unit string (e.g. "12.3456").
// We compare it against the required whole-unit price; if short, the Buy
// button is disabled and we link to the Shelbynet faucet so test-wallet
// viewers can top up without leaving the page.
//
// The owner check uses case-insensitive comparison so a mixed-case upload
// record doesn't hide the gate from the viewer or incorrectly flag the
// wrong viewer as owner. The parent page SHOULD also guard with its own
// `video.uploader === address` check (task 5.6) — this duplicate guard is
// defense-in-depth so a missed parent check can't show an owner a purchase
// prompt for their own video.
//
// Requirements covered: 5.1, 5.4, 5.6.
// ---------------------------------------------------------------------------

interface PurchaseGateProps {
  video: VideoMetadata;
  /** Null when the viewer has no connected wallet. */
  walletAddress: string | null;
  /** Called after a successful purchase so the parent can refetch access. */
  onPurchased?: () => void;
}

// SHELBYUSD uses 8 decimal places — same conversion UploadForm uses for its
// price input. Defining the constant alongside `formatSusd` keeps the math
// obvious and lets future tweaks stay in one place.
const SUSD_DECIMALS = 8;
const SUSD_DIVISOR = 10 ** SUSD_DECIMALS;

/**
 * Format SUSD base units as a human-friendly whole-unit string. Matches the
 * display format used elsewhere in the app (UploadForm, CreatorVideoSettings):
 * trims trailing zeros beyond 4 decimals and uses locale grouping.
 */
function formatSusd(baseUnits: number): string {
  if (!Number.isFinite(baseUnits)) return '0';
  const whole = baseUnits / SUSD_DIVISOR;
  return whole.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

/**
 * Parse the whole-unit string returned by `useShelbyAccess().balance` back
 * into base units for an accurate comparison against `priceBaseUnits`.
 * Balance formatting rounds to 4 decimals — multiplying by the full
 * divisor and rounding gives us a base-unit estimate that is accurate to
 * at worst half a hundredth of a cent, which is fine for the gate check.
 * If the server ever exposes raw base units we can swap this for that.
 */
function parseBalanceToBaseUnits(balanceDisplay: string): number {
  const cleaned = balanceDisplay.replace(/[^0-9.]/g, '');
  const whole = Number.parseFloat(cleaned);
  if (!Number.isFinite(whole) || whole < 0) return 0;
  return Math.round(whole * SUSD_DIVISOR);
}

export default function PurchaseGate({
  video,
  walletAddress,
  onPurchased,
}: PurchaseGateProps) {
  // ── Owner check (defense-in-depth) ─────────────────────────────────────
  // Parent page is expected to also gate-mount this component, but we
  // short-circuit defensively here so a missed guard can never render a
  // purchase prompt to the owner of the video. The check is performed
  // BEFORE any state/effect hooks run, but the early return is placed
  // AFTER all hook calls below to satisfy the rules of hooks — we
  // precompute the flag here and apply it at render time.
  const normalizedViewer = walletAddress?.toLowerCase() ?? '';
  const normalizedOwner = video.uploader.toLowerCase();
  const isOwner =
    normalizedViewer.length > 0 && normalizedViewer === normalizedOwner;

  // Price + creator handle for display. `video.price` is in base units;
  // `video.channelName` is set by UploadForm to a truncated form of the
  // uploader when the creator hasn't named their channel, so we use the
  // channelName first and fall back to a truncated address as a belt-and-
  // braces default.
  const priceBaseUnits = video.price ?? 0;
  const priceDisplay = useMemo(() => formatSusd(priceBaseUnits), [priceBaseUnits]);
  const creatorHandle =
    video.channelName?.trim() || formatAddress(video.uploader);

  // ── Balance check ──────────────────────────────────────────────────────
  // `useShelbyAccess` is the existing hook that wraps GET /api/auth/check-
  // access and returns the wallet's SUSD balance as a whole-unit string.
  // The current backend returns "0" regardless of chain state (see the GET
  // handler), which is a deliberate conservative default — we treat any
  // non-positive balance as "unknown" rather than "insufficient" so the
  // gate never blocks a viewer whose balance is real but unreported. If
  // the backend is wired to report real balances later, this code already
  // does the right thing.
  const { balance: balanceDisplay, loading: balanceLoading } =
    useShelbyAccess();
  const balanceBaseUnits = useMemo(
    () => parseBalanceToBaseUnits(balanceDisplay),
    [balanceDisplay],
  );
  const hasBalanceSignal = balanceBaseUnits > 0;
  const insufficientBalance =
    hasBalanceSignal && balanceBaseUnits < priceBaseUnits;

  // ── Purchase hook ──────────────────────────────────────────────────────
  // Hook must be called unconditionally (rules of hooks). When the viewer
  // is disconnected (walletAddress === null) we still call it with an
  // empty string — `purchase()` guards that internally — and simply never
  // render a Buy button in that state.
  const {
    state,
    error: purchaseError,
    purchase,
    reset,
    needsManualRetry,
    retryVerify,
  } = usePurchase({
    videoId: video.videoId,
    priceBaseUnits,
    creatorWallet: video.uploader,
    walletAddress: walletAddress ?? '',
    onSuccess: onPurchased,
  });

  // ── Status line ────────────────────────────────────────────────────────
  // Rendered beneath the Buy button to reflect the current state. Kept
  // separate from `error` / `needsManualRetry` so the UI can render both
  // (e.g. a verifying spinner + a lingering manual-retry affordance from
  // the previous attempt).
  const statusMessage = (() => {
    switch (state) {
      case 'signing':
        return 'Waiting for wallet…';
      case 'verifying':
        return 'Confirming payment…';
      case 'success':
        return 'Purchase confirmed! Loading video…';
      default:
        return null;
    }
  })();

  // A purchase flow is mid-flight while the wallet is open or the server
  // is verifying. Disabling the Buy button during these states prevents
  // double-submits which would produce rejected duplicate transactions.
  const inFlight = state === 'signing' || state === 'verifying';

  // Apply the owner short-circuit AFTER every hook has been called so the
  // rules of hooks are satisfied. The hooks above run for the owner too
  // but their state is discarded when we return null.
  if (isOwner) return null;

  // ── Disconnected viewer ────────────────────────────────────────────────
  if (walletAddress === null) {
    return (
      <div className="aspect-video bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-brand-purple/20 border border-brand-purple/40 flex items-center justify-center mb-5">
          <WalletIcon className="w-8 h-8 text-brand-purple" />
        </div>
        <h3 className="text-white font-black text-lg mb-2 tracking-tight">
          Connect wallet to purchase
        </h3>
        <p className="text-zinc-400 text-sm max-w-md leading-relaxed">
          This is a premium video from{' '}
          <span className="text-white font-semibold">{creatorHandle}</span>.
          Connect your wallet to unlock it for{' '}
          <span className="text-white font-semibold">
            {priceDisplay} SUSD
          </span>
          .
        </p>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Purchase gate"
      className="aspect-video bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-8 text-center"
    >
      {/* Success state uses a dedicated icon so the feedback is unambiguous
          before the parent swaps the gate out for the actual player. */}
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center mb-5 border ${
          state === 'success'
            ? 'bg-green-500/20 border-green-500/40'
            : 'bg-brand-red/15 border-brand-red/40'
        }`}
      >
        {state === 'success' ? (
          <CheckCircleIcon className="w-8 h-8 text-green-400" />
        ) : (
          <TicketIcon className="w-8 h-8 text-brand-red" />
        )}
      </div>

      <p className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-2">
        Premium video
      </p>
      <h3 className="text-white font-black text-2xl tracking-tight">
        {priceDisplay}{' '}
        <span className="text-zinc-500 text-lg font-bold">SUSD</span>
      </h3>
      <p className="text-zinc-400 text-sm mt-1 mb-6">
        from <span className="text-white font-semibold">{creatorHandle}</span>
      </p>

      {/* ── Buy button ────────────────────────────────────────────────── */}
      {/* Primary action — disabled on insufficient balance OR while a
          transaction is in flight OR in success state (success means the
          parent is about to swap us out; a last-second click would be
          visually confusing). */}
      <button
        type="button"
        onClick={() => void purchase()}
        disabled={
          inFlight || insufficientBalance || balanceLoading || state === 'success'
        }
        className="inline-flex items-center gap-2 px-8 py-3.5 bg-brand-red hover:bg-brand-red/90
          disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed
          text-white font-black text-sm uppercase tracking-wider rounded-xl transition-colors"
      >
        {inFlight ? (
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
        ) : (
          <TicketIcon className="w-4 h-4" />
        )}
        {state === 'success'
          ? 'Confirmed'
          : inFlight
            ? state === 'signing'
              ? 'Waiting for wallet…'
              : 'Confirming…'
            : `Buy for ${priceDisplay} SUSD`}
      </button>

      {/* ── Status line ───────────────────────────────────────────────── */}
      {statusMessage && state !== 'success' && (
        <p className="mt-4 text-zinc-400 text-xs font-medium">
          {statusMessage}
        </p>
      )}

      {/* ── Insufficient balance warning ───────────────────────────────── */}
      {/* Links to the Shelbynet faucet rather than quietly failing. We only
          show this when we have a positive balance signal; a reported
          balance of 0 is almost always the "balance not yet implemented"
          server default, not a real empty wallet. */}
      {insufficientBalance && (
        <div
          role="alert"
          className="mt-5 max-w-md flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-left"
        >
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-amber-200 text-xs font-bold">
              Insufficient balance
            </p>
            <p className="text-amber-100/80 text-xs mt-1">
              You need {priceDisplay} SUSD. Get test tokens from the{' '}
              <Link
                href={SHELBY_FAUCET_URL || 'https://faucet.shelbynet.shelby.xyz'}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold hover:text-amber-50 inline-flex items-center gap-1"
              >
                faucet
                <ArrowTopRightOnSquareIcon className="w-3 h-3" />
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {/* ── Manual retry affordance ────────────────────────────────────── */}
      {/* Shown when the chain transfer succeeded but access confirmation
          failed after all retry attempts. The user's funds are already
          gone on-chain — we must NOT re-sign. `retryVerify()` only replays
          the access check (move) or server verify call (supabase). */}
      {needsManualRetry && state !== 'success' && (
        <div className="mt-5 max-w-md flex flex-col items-stretch gap-2 p-3 bg-brand-purple/10 border border-brand-purple/30 rounded-lg text-left">
          <p className="text-brand-purple text-xs font-bold">
            Payment sent but confirmation pending
          </p>
          <p className="text-zinc-300 text-xs">
            Your transaction went through on-chain. Click retry to confirm
            access — you will not be charged again.
          </p>
          <button
            type="button"
            onClick={() => void retryVerify()}
            disabled={state === 'verifying'}
            className="mt-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-brand-purple hover:bg-brand-purple/90
              disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed
              text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors"
          >
            <ArrowPathIcon
              className={`w-3.5 h-3.5 ${state === 'verifying' ? 'animate-spin' : ''}`}
            />
            {state === 'verifying' ? 'Retrying…' : 'Retry confirmation'}
          </button>
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────────── */}
      {/* Only shown for "true" errors — wallet rejections transition to
          `idle` with no error text so the gate stays clean. When the error
          is a manual-retry scenario we defer to the retry block above and
          suppress this one to avoid duplicate messaging. */}
      {state === 'error' && !needsManualRetry && (
        <div
          role="alert"
          className="mt-5 max-w-md flex flex-col items-stretch gap-2 p-3 bg-brand-red/10 border border-brand-red/30 rounded-lg text-left"
        >
          <p className="text-brand-red text-xs font-bold">
            Something went wrong
          </p>
          <p className="text-zinc-300 text-xs break-words">
            {purchaseError ?? 'Unknown error'}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700
              text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
