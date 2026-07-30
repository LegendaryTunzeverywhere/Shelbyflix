/**
 * lib/access-control.ts
 *
 * The single seam through which API routes and UI hooks resolve whether a
 * given (video, wallet) pair may play a video right now. Everything in the
 * feature — the /api/videos/:id/access endpoint, the VideoPlayer gate, the
 * PurchaseGate — routes through `resolveAccess` so the decision logic lives
 * in exactly one place (Req 11.1).
 *
 * The backend that reads the underlying data (Supabase today, Shelby-native
 * permissions tomorrow) is injected via the `AccessBackend` interface. This
 * keeps `resolveAccess` pure relative to its inputs and makes it trivial to
 * swap the data source behind a feature flag without touching callers
 * (Req 11.3).
 *
 * Scope of this file (tasks 2.1 – 2.4): skeleton with the correct ordering
 * (expired → owner → mode-specific), all four mode branches, a single
 * canonical `normalizeAddress` helper routed through every wallet
 * comparison so case mismatches can never produce a false negative
 * (Req 3.1, 3.2), explicit handling of anonymous callers (`wallet === null`)
 * per Req 4.2 and 7.2, and the "free Purchasable" edge case per Req 5.7
 * where a Purchasable video with a non-positive price is treated as Public
 * for access purposes so the VideoPlayer renders no purchase gate:
 *   - Public                   → `hasAccess: true`
 *   - Allowlist                → `hasAccess: false`, reason `not_on_allowlist`
 *   - Time Lock (pre-unlock)   → `hasAccess: false`, reason `time_locked`
 *   - Time Lock (post-unlock)  → `hasAccess: true` (unlocked videos become
 *                                 playable by everyone, including anonymous)
 *   - Purchasable (free)       → `hasAccess: true`, reason `public`,
 *                                 accessMode preserved as `purchasable`
 *   - Purchasable (priced)     → `hasAccess: false`, reason `payment_required`
 *
 * Requirements covered: 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.4, 5.6,
 * 5.7, 7.2, 7.4, 11.1, 11.3
 */

import { AccountAddress } from '@aptos-labs/ts-sdk';
import { supabase } from './supabase';
import { moveContractBackend, ChainUnavailableError } from './move-contract-backend';
import type {
  AccessConfig,
  AccessMode,
  AccessReason,
  AccessResult,
} from '@/types';

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

/**
 * Canonical on-chain form used for every wallet comparison in this module
 * (owner check, allowlist membership, purchase lookup) and by callers that
 * want to match this module's behavior exactly. Routing all normalization
 * through a single helper means the Move-contract backend, the Supabase
 * backend, and the resolver all agree byte-for-byte on what "same address"
 * means (move-contract-permissions Req 2.1, 2.2, 2.3 — supersedes the
 * earlier lowercase-only contract from Req 3.1 / 3.2 of the
 * video-access-payments spec).
 *
 * Returns the empty string for `null`, `undefined`, whitespace-only, or
 * unparseable input so callers can treat "no wallet" uniformly:
 * `normalizeAddress(x).length === 0` is the canonical "is this an
 * anonymous caller?" check and doubles as the reject-on-parse-failure
 * sentinel. This function NEVER propagates an exception — a malformed
 * address becomes the empty sentinel plus a single `console.warn`
 * identifying the rejected input length (not the value — PII/wallet data
 * is intentionally kept out of logs) and the source field that produced
 * it (move-contract-permissions Req 2.3).
 *
 * On success, the returned string is a Canonical_Address: a `0x`-prefixed,
 * zero-padded, exactly 64-lowercase-hex-character representation of the
 * address (total length 66), produced by
 * `AccountAddress.from(trimmed).toStringLong()`. Short-form addresses
 * (`0x1`, `0xabc`, etc.) are accepted on input and expanded to 66-char
 * form on output — this is safe for every existing call site because all
 * comparisons inside this file re-normalize both sides through this
 * helper before comparing, so the widened output form never silently
 * mismatches a wallet stored in the legacy lowercase form.
 *
 * @param addr         Raw address input (wallet connect, DB column, etc.).
 * @param sourceField  Optional label for the warn log emitted on parse
 *                     failure. Prefer a stable short identifier like
 *                     `'videos.uploader_wallet'`, `'allowlist[i]'`, or
 *                     `'request.walletAddress'` so operators can grep
 *                     across a noisy log feed. Defaults to
 *                     `'unspecified'` when the caller can't usefully
 *                     name the field.
 */
export function normalizeAddress(
  addr: string | null | undefined,
  sourceField: string = 'unspecified',
): string {
  if (addr === null || addr === undefined) return '';
  const trimmed = typeof addr === 'string' ? addr.trim() : '';
  if (trimmed.length === 0) return '';

  try {
    return AccountAddress.from(trimmed).toStringLong();
  } catch {
    // Req 2.3: swallow the exception, return the empty sentinel, and
    // emit exactly one warn identifying the rejected input length and
    // the source field. We deliberately do NOT log the offending value
    // itself — wallet addresses are PII-adjacent, and a malformed input
    // is just as likely to be a leaked secret, signed-nonce fragment,
    // or other sensitive material as it is to be a genuine typo.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'normalize_address_rejected',
        sourceField,
        inputLength: trimmed.length,
      }),
    );
    return '';
  }
}

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

/**
 * The narrow surface that `resolveAccess` depends on.
 *
 * Intentionally read-only and intentionally minimal — just enough to answer
 * "what are this video's access rules?" and "has this wallet already paid?".
 * The interface deliberately omits a write path: switching the backend (DB
 * vs Shelby-native) will be one-way per environment, and writes always go
 * through whichever backend is active via its own module (e.g. the purchase
 * verification route writes through `lib/supabase.ts` directly).
 *
 * When Shelby's SDK ships `getPermissions`, a `shelbyNativeBackend` can
 * implement this same interface and be swapped in without any change to
 * callers (Req 11.2, 11.3).
 */
export interface AccessBackend {
  /**
   * Fetch the access configuration for a single video, or `null` if no
   * such video exists. Returned addresses are expected to be lowercase so
   * downstream comparisons can be raw string equality.
   */
  getConfig(videoId: string): Promise<AccessConfig | null>;

  /**
   * Return whether a lowercase `wallet` has a verified purchase receipt
   * for `videoId`. Implementations SHOULD return `false` (not throw) when
   * the wallet argument is empty.
   */
  hasPurchased(videoId: string, wallet: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

/**
 * Reads access rules from the `videos` table and purchase receipts from
 * `video_purchases`. This is the default backend used by `resolveAccess`
 * today; swap it for `shelbyNativeBackend` (future) via DI to delegate to
 * native Shelby blob permissions without touching any caller.
 */
export const supabaseBackend: AccessBackend = {
  async getConfig(videoId: string): Promise<AccessConfig | null> {
    // Same sanitisation pattern used by `getVideoById` in video-service.ts:
    // video IDs are alphanumeric + `_` / `-`. Anything else can only come
    // from a client attempting injection and is rejected without a DB hit.
    if (!/^[\w-]+$/.test(videoId)) return null;

    const { data, error } = await supabase
      .from('videos')
      .select(
        'video_id, uploader_wallet, access_mode, allowlist, unlock_at, price, expiration_timestamp',
      )
      .eq('video_id', videoId)
      .maybeSingle();

    if (error || !data) return null;

    // Addresses arrive lowercase from `saveVideo` (see lib/video-service.ts)
    // and the migration backfills legacy rows with `'public'` / `[]` / NULL.
    // We still route every address through `normalizeAddress` here as a
    // defense-in-depth measure: a future manual DB edit or a Shelby-native
    // backend might not uphold the "already lowercase" invariant, and we
    // don't want that to silently break the owner or allowlist checks
    // (Req 3.1, 3.2).
    return {
      videoId: data.video_id,
      ownerWallet: normalizeAddress(data.uploader_wallet, 'videos.uploader_wallet'),
      accessMode: data.access_mode as AccessMode,
      allowlist: (data.allowlist ?? [])
        .map((a: string) => normalizeAddress(a, 'videos.allowlist[]'))
        .filter((a: string) => a.length > 0),
      unlockAt: data.unlock_at ?? undefined,
      priceBaseUnits: data.price ?? undefined,
      expirationTimestamp: data.expiration_timestamp,
    };
  },

  async hasPurchased(videoId: string, wallet: string): Promise<boolean> {
    // Guard empty/null wallets explicitly — saves a DB round-trip and
    // ensures `resolveAccess` can treat anonymous callers the same way
    // as "no receipt found" for Purchasable videos.
    const normalized = normalizeAddress(wallet, 'hasPurchased.wallet');
    if (!normalized) return false;
    if (!/^[\w-]+$/.test(videoId)) return false;

    const { data, error } = await supabase
      .from('video_purchases')
      .select('video_id')
      .eq('video_id', videoId)
      .eq('wallet_address', normalized)
      .maybeSingle();

    if (error) return false;
    return data !== null;
  },
};

// ---------------------------------------------------------------------------
// Default backend selection
// ---------------------------------------------------------------------------

/**
 * Module-level flag to ensure we emit at most one warning per process
 * lifetime for an invalid (non-empty, non-'supabase', non-'move') value
 * of `NEXT_PUBLIC_ACCESS_BACKEND` (Req 15.4).
 */
let _invalidBackendFlagWarned = false;

/**
 * Select the active `AccessBackend` based on the `NEXT_PUBLIC_ACCESS_BACKEND`
 * environment variable. Called per invocation of `resolveAccess` so that a
 * flag change in dev takes effect on the next call without a process restart
 * (Req 15.2).
 *
 * - Exactly `'move'` (byte-for-byte, case-sensitive) → `moveContractBackend`
 * - `undefined`, empty string, or exactly `'supabase'` → `supabaseBackend`
 * - Any other non-empty value → `supabaseBackend` with a single warn per
 *   process lifetime naming the invalid value (truncated to 64 chars)
 *
 * The static import of `moveContractBackend` is safe because that module is
 * a lazy singleton — no Aptos client or env reads happen at import time
 * (Req 18.2).
 *
 * Requirements covered: 15.1, 15.3, 15.4
 */
export function getDefaultBackend(): AccessBackend {
  const raw = process.env.NEXT_PUBLIC_ACCESS_BACKEND;
  if (raw === 'move') return moveContractBackend;
  if (raw === undefined || raw === '' || raw === 'supabase') {
    return supabaseBackend;
  }
  // Invalid non-empty value — warn once per process lifetime.
  if (!_invalidBackendFlagWarned) {
    _invalidBackendFlagWarned = true;
    const truncated = raw.length > 64 ? raw.slice(0, 64) : raw;
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'invalid_access_backend_flag',
        value: truncated,
        message: `NEXT_PUBLIC_ACCESS_BACKEND has unrecognized value "${truncated}"; defaulting to supabase`,
      }),
    );
  }
  return supabaseBackend;
}

// ---------------------------------------------------------------------------
// Pure resolution
// ---------------------------------------------------------------------------

/**
 * Resolve whether a caller may play a video.
 *
 * Evaluation order matches the sequence diagram in design.md exactly:
 *   1. expired (Req 7.4) — a stale video is never playable regardless of
 *      mode or ownership
 *   2. owner (Req 3.5, 4.4, 5.6) — the uploader always retains access
 *   3. mode-specific branch — public / allowlist / timelock / purchasable
 *
 * Pure relative to `backend`: unit tests inject a fake `AccessBackend` to
 * exercise every branch without touching Supabase. `wallet` may be `null`
 * for anonymous callers (Req 7.2): Public grants access to everyone,
 * post-unlock Time Lock grants access regardless of wallet (Req 4.2), and
 * every other mode falls through to its mode-specific "not authorised"
 * reason (`not_on_allowlist`, `time_locked`, `payment_required`). The
 * per-branch guards on `normalizedWallet.length > 0` make this behavior
 * explicit at each mode.
 */
export async function resolveAccess(
  videoId: string,
  wallet: string | null,
  backend: AccessBackend = getDefaultBackend(),
): Promise<AccessResult> {
  // Req 6.4: Wrap backend.getConfig in try/catch — ChainUnavailableError
  // surfaces as a distinct `chain_unavailable` reason so the UI can render
  // a retryable state rather than the terminal "expired" state. Other
  // errors propagate unchanged.
  let config: AccessConfig | null;
  try {
    config = await backend.getConfig(videoId);
  } catch (e) {
    if (e instanceof ChainUnavailableError) {
      return {
        hasAccess: false,
        reason: 'chain_unavailable',
        accessMode: 'public',
        ownerIsViewer: false,
      };
    }
    throw e;
  }

  // No such video — under the move backend, a null config means the blob
  // is not registered on the access_control module. This happens for videos
  // uploaded before the move flag was enabled. Fall back to the supabase
  // backend so pre-cutover videos remain accessible during the transition.
  if (!config) {
    if (backend !== supabaseBackend) {
      // Try supabase as a fallback for unregistered blobs
      const fallbackConfig = await supabaseBackend.getConfig(videoId);
      if (fallbackConfig) {
        config = fallbackConfig;
      }
    }
  }

  // Still null after fallback — surface as `expired`
  if (!config) {
    return {
      hasAccess: false,
      reason: 'expired',
      accessMode: 'public',
      ownerIsViewer: false,
    };
  }

  // Normalize the incoming wallet exactly once; every downstream comparison
  // (owner check, allowlist membership, purchase lookup) uses this value.
  // Routing through the shared helper keeps this module's case-handling
  // consistent with every other caller (Req 3.1, 3.2).
  const normalizedWallet = normalizeAddress(wallet);
  const mode = config.accessMode;

  // --- Step 1: expired (takes precedence over every other check) ---------
  const now = Date.now();
  if (config.expirationTimestamp < now) {
    return {
      hasAccess: false,
      reason: 'expired',
      accessMode: mode,
      ownerIsViewer: false,
    };
  }

  // --- Step 2: owner -----------------------------------------------------
  // Owner check is unconditional on mode: allowlist removal, timelock, and
  // missing receipt never lock the creator out of their own video
  // (Req 3.5, 4.4, 5.6). Re-normalize the owner address here as defense in
  // depth — `supabaseBackend` already lowercases it, but a future
  // Shelby-native backend (Req 11.3) might not, and a single-character
  // case difference must not silently lock a creator out of their own
  // content.
  const normalizedOwner = normalizeAddress(config.ownerWallet);
  const ownerIsViewer =
    normalizedWallet.length > 0 && normalizedWallet === normalizedOwner;
  if (ownerIsViewer) {
    return {
      hasAccess: true,
      reason: 'owner',
      accessMode: mode,
      ownerIsViewer: true,
      unlockAt: config.unlockAt,
      priceBaseUnits: config.priceBaseUnits,
    };
  }

  // --- Step 3: mode-specific --------------------------------------------
  // Each branch handles anonymous callers (`normalizedWallet.length === 0`)
  // explicitly (Req 4.2, 7.2). Public is the only mode that grants access
  // without a wallet; post-unlock Time Lock promotes to Public for every
  // viewer (including anonymous); Allowlist and Purchasable fall through
  // to their mode-specific denial reasons; pre-unlock Time Lock denies all
  // viewers uniformly. No branch round-trips to the backend for anonymous
  // callers — empty wallets can never be allowlisted or have a receipt, and
  // we don't want a DB hit just to re-derive that.
  switch (mode) {
    case 'public':
      // Public is wallet-agnostic: signed-in and anonymous callers both
      // get `hasAccess: true`. This preserves the current UX where public
      // videos play immediately without any wallet connection (Req 2.1).
      return {
        hasAccess: true,
        reason: 'public',
        accessMode: 'public',
        ownerIsViewer: false,
      };

    case 'allowlist': {
      // Anonymous callers (`normalizedWallet.length === 0`) can never be
      // on an allowlist, so the `length > 0` short-circuit sends them
      // straight to `not_on_allowlist` without iterating the stored list
      // (Req 7.2). `supabaseBackend` already lowercases each entry, but we
      // re-normalize here so a future backend that skips that step can't
      // silently produce a false negative for a viewer whose address was
      // stored mixed-case (Req 3.1, 3.2).
      const allowed =
        normalizedWallet.length > 0 &&
        (config.allowlist ?? [])
          .map((a) => normalizeAddress(a))
          .includes(normalizedWallet);
      return allowed
        ? {
            hasAccess: true,
            reason: 'allowlisted',
            accessMode: 'allowlist',
            ownerIsViewer: false,
          }
        : {
            hasAccess: false,
            reason: 'not_on_allowlist',
            accessMode: 'allowlist',
            ownerIsViewer: false,
          };
    }

    case 'timelock': {
      // Req 4.2 / 7.2: the timelock branch is wallet-agnostic. Before
      // `unlock_at` every viewer (including anonymous) is blocked with
      // reason `time_locked`; once `unlock_at` has elapsed the video is
      // playable by any wallet AND by anonymous callers — timelock
      // effectively promotes the video to Public. If `unlockAt` is somehow
      // missing on a timelock video (shouldn't happen per creation-time
      // validation) we fail closed and keep it locked.
      const unlockAt = config.unlockAt ?? Number.POSITIVE_INFINITY;
      if (now >= unlockAt) {
        return {
          hasAccess: true,
          reason: 'public',
          accessMode: 'timelock',
          ownerIsViewer: false,
          unlockAt: config.unlockAt,
        };
      }
      return {
        hasAccess: false,
        reason: 'time_locked',
        accessMode: 'timelock',
        ownerIsViewer: false,
        unlockAt: config.unlockAt,
      };
    }

    case 'purchasable': {
      // Req 5.7: a Purchasable video with a non-positive price (0, missing,
      // or explicitly null) is a free video. Treat it as Public for access
      // purposes — grant access to every caller (including anonymous) and
      // return `reason: 'public'` so the VideoPlayer renders no purchase
      // gate. We preserve `accessMode: 'purchasable'` so the UI still knows
      // the underlying mode (e.g. the creator management surface can
      // display "Purchasable (free)" rather than silently relabeling the
      // video). No DB round-trip for the receipt lookup is needed here
      // because there's nothing to purchase.
      const price = config.priceBaseUnits;
      if (price == null || price <= 0) {
        return {
          hasAccess: true,
          reason: 'public',
          accessMode: 'purchasable',
          ownerIsViewer: false,
        };
      }

      // Anonymous callers (`normalizedWallet.length === 0`) can never have
      // a purchase receipt, so the `length > 0` short-circuit sends them
      // straight to `payment_required` without a DB round-trip (Req 7.2).
      // Signed-in callers without a receipt land in the same denial state;
      // callers with a receipt get `purchased`.
      //
      // Req 6.5: Wrap backend.hasPurchased in try/catch — ChainUnavailableError
      // surfaces as `chain_unavailable` with `accessMode: 'purchasable'` so
      // the UI knows the video's mode while rendering the retryable state.
      let purchased: boolean;
      try {
        purchased =
          normalizedWallet.length > 0 &&
          (await backend.hasPurchased(videoId, normalizedWallet));
      } catch (e) {
        if (e instanceof ChainUnavailableError) {
          return {
            hasAccess: false,
            reason: 'chain_unavailable',
            accessMode: 'purchasable',
            ownerIsViewer: false,
          };
        }
        throw e;
      }
      if (purchased) {
        return {
          hasAccess: true,
          reason: 'purchased',
          accessMode: 'purchasable',
          ownerIsViewer: false,
          priceBaseUnits: config.priceBaseUnits,
        };
      }
      return {
        hasAccess: false,
        reason: 'payment_required',
        accessMode: 'purchasable',
        ownerIsViewer: false,
        priceBaseUnits: config.priceBaseUnits,
      };
    }

    default:
      // Exhaustive safety net — if somebody adds a new mode without
      // updating this file, the TS compiler flags it here at build time.
      return assertNever(mode);
  }
}

/**
 * Compile-time exhaustiveness check. If a new `AccessMode` is added to the
 * union, TS will reject the implicit assignment here and force this file
 * to be updated.
 */
function assertNever(mode: never): AccessResult {
  throw new Error(`[lib/access-control] Unhandled access mode: ${mode as AccessReason}`);
}
