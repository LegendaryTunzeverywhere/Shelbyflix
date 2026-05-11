import { NextRequest, NextResponse } from 'next/server';
import { Ed25519PublicKey } from '@aptos-labs/ts-sdk';
import { nonceStore, verifyAndConsumeNonce } from '@/lib/nonce-store';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizeAddress } from '@/lib/access-control';
import { hexToBytes, truncateHash } from '@/lib/shared-utils';
import type { AccessMode } from '@/types';

// ---------------------------------------------------------------------------
// PATCH /api/videos/:id/access-config
//
// The creator-facing mutation endpoint for changing a video's access mode
// and mode-specific parameters after upload. Mutating the `videos` table
// bypasses RLS (task 3.2) because the row's `uploader_wallet` is the only
// authority we trust — so authentication runs at the application layer via
// the same challenge/signed-nonce pattern that `/api/auth/check-access`
// uses. There is no JWT in this codebase despite earlier spec wording;
// clients call `GET /api/auth/challenge?walletAddress=...` to obtain a
// one-time nonce, sign it with their wallet, and submit the signature
// alongside the config payload here.
//
// Request body:
//   {
//     walletAddress: string,          // the caller (claimed owner)
//     publicKey:     string,          // hex, used to verify `signature`
//     signature:     string,          // hex, over `fullMessage` (or plain nonce)
//     nonce:         string,          // must match the outstanding nonceStore entry
//     fullMessage?:  string,          // exact bytes the wallet signed, if supplied
//     accessMode:    AccessMode,      // new access mode
//     allowlist?:    string[],        // required when accessMode === 'allowlist'
//     unlockAt?:     number | null,   // required when accessMode === 'timelock'
//     price?:        number,          // required when accessMode === 'purchasable'
//   }
//
// Behaviour:
//   1. Shape-validate the body (walletAddress regex, access mode enum, etc.).
//   2. Resolve `params.id` (Next 15 async params) and validate its shape.
//   3. Verify the Ed25519 signature against the outstanding nonce — identical
//      logic to `/api/auth/check-access` so the whole app has a single
//      wallet-signature verifier. Consume the nonce on success.
//   4. Fetch the video row via the service-role client. 404 if not found.
//   5. Ownership check — `normalizeAddress(walletAddress) ===
//      normalizeAddress(video.uploader_wallet)`. 403 otherwise (Req 1.8, 9.5).
//   6. Validate the incoming config for internal consistency:
//        - purchasable → integer price > 0 (Req 1.7)
//        - allowlist   → non-empty array of valid addresses (Req 1.4 symmetry)
//        - timelock    → unlockAt > now AND < expiration_timestamp
//      Invalid → 400 with a precise `reason` code so the UI can surface the
//      right inline error.
//   7. Build the UPDATE payload (normalized allowlist, cleared for
//      non-matching modes, price only when mode === 'purchasable') and
//      commit via the service-role client.
//   8. Return 200 with the updated config. Emit a structured `info` log on
//      success and `warn` logs on every rejection path.
//
// Requirements covered: 1.7, 1.8, 9.5.
// ---------------------------------------------------------------------------

const APTOS_ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;
const VIDEO_ID_REGEX = /^[\w-]+$/;

const ALLOWED_MODES: readonly AccessMode[] = [
  'public',
  'allowlist',
  'timelock',
  'purchasable',
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // ── 1. Resolve and validate the videoId ───────────────────────────────
    const { id: videoId } = await params;
    if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
      return NextResponse.json(
        { error: 'Invalid video id', reason: 'invalid_video_id' },
        { status: 400 },
      );
    }

    // ── 2. Parse the body ────────────────────────────────────────────────
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON body', reason: 'missing_fields' },
        { status: 400 },
      );
    }

    const {
      walletAddress,
      publicKey,
      signature,
      nonce,
      fullMessage,
      accessMode,
      allowlist,
      unlockAt,
      price,
    } = (body ?? {}) as {
      walletAddress?: unknown;
      publicKey?: unknown;
      signature?: unknown;
      nonce?: unknown;
      fullMessage?: unknown;
      accessMode?: unknown;
      allowlist?: unknown;
      unlockAt?: unknown;
      price?: unknown;
    };

    // ── 3. Auth-related field validation ─────────────────────────────────
    if (
      typeof walletAddress !== 'string' ||
      typeof publicKey !== 'string' ||
      typeof signature !== 'string' ||
      typeof nonce !== 'string' ||
      walletAddress.length === 0 ||
      publicKey.length === 0 ||
      signature.length === 0 ||
      nonce.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            'walletAddress, publicKey, signature, and nonce are all required',
          reason: 'missing_fields',
        },
        { status: 400 },
      );
    }

    if (!APTOS_ADDRESS_REGEX.test(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid wallet address', reason: 'invalid_address' },
        { status: 400 },
      );
    }

    // ── 4. Verify the signature against the outstanding nonce ────────────
    // Mirrors `/api/auth/check-access` exactly so the app has a single
    // canonical wallet-signature verifier. Any change to that route's
    // verification flow should be reflected here.
    const storeKey = walletAddress.toLowerCase();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';

    const entries = nonceStore.get(storeKey);
    if (!entries || entries.length === 0) {
      logRejection('nonce_missing_or_expired', {
        videoId,
        walletAddress: truncateHash(storeKey),
      });
      return NextResponse.json(
        {
          error: 'Nonce not found or expired. Request a new challenge.',
          reason: 'nonce_expired',
        },
        { status: 401 },
      );
    }

    const plainMessage = `ShelbyFlix login: ${nonce}`;
    const messageToVerify: string =
      typeof fullMessage === 'string' && fullMessage.length > 0
        ? fullMessage
        : plainMessage;

    // Belt-and-braces guard: if the client supplied a custom `fullMessage`,
    // it MUST contain the nonce we issued. Prevents re-use of a signature
    // over an attacker-chosen message.
    if (!messageToVerify.includes(nonce)) {
      logRejection('signed_message_missing_nonce', {
        videoId,
        walletAddress: truncateHash(storeKey),
      });
      return NextResponse.json(
        {
          error: 'Signed message does not contain issued nonce',
          reason: 'bad_signed_message',
        },
        { status: 401 },
      );
    }

    const messageBytes = new TextEncoder().encode(messageToVerify);

    let signatureValid = false;
    try {
      const pubKey = new Ed25519PublicKey(publicKey);
      const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
      const sigBytes = hexToBytes(sigHex);
      signatureValid = pubKey.verifySignature({
        message: messageBytes,
        signature: sigBytes,
      } as any);
    } catch (err) {
      logRejection('signature_verification_error', {
        videoId,
        walletAddress: truncateHash(storeKey),
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: 'Signature verification failed', reason: 'bad_signature' },
        { status: 401 },
      );
    }

    if (!signatureValid) {
      logRejection('invalid_signature', {
        videoId,
        walletAddress: truncateHash(storeKey),
      });
      return NextResponse.json(
        { error: 'Invalid signature', reason: 'bad_signature' },
        { status: 401 },
      );
    }

    // One-time use — consume the nonce only after a successful verify so a
    // failed attempt doesn't force the user to re-request a challenge.
    const consumed = verifyAndConsumeNonce(storeKey, nonce, ip);
    if (!consumed) {
      logRejection('nonce_consume_failed', {
        videoId,
        walletAddress: truncateHash(storeKey),
      });
      return NextResponse.json(
        {
          error: 'Nonce not found, expired, or IP mismatch. Request a new challenge.',
          reason: 'nonce_expired',
        },
        { status: 401 },
      );
    }

    // ── 5. Bootstrap the service-role client ─────────────────────────────
    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch (err) {
      console.error(
        '[/api/videos/:id/access-config] service-role client unavailable:',
        err,
      );
      return NextResponse.json(
        {
          error: 'Internal server error',
          reason: 'server_error',
        },
        { status: 500 },
      );
    }

    // ── 6. Fetch the video row ───────────────────────────────────────────
    // We need both `uploader_wallet` (for the ownership check) and
    // `expiration_timestamp` (to validate timelock unlockAt). Reading via
    // the service-role client keeps this route's behavior consistent even
    // if a future RLS policy tightens `videos` reads.
    const { data: videoRow, error: fetchError } = await admin
      .from('videos')
      .select('video_id, uploader_wallet, expiration_timestamp')
      .eq('video_id', videoId)
      .maybeSingle();

    if (fetchError) {
      console.error(
        '[/api/videos/:id/access-config] video lookup failed:',
        fetchError,
      );
      return NextResponse.json(
        { error: 'Internal server error', reason: 'server_error' },
        { status: 500 },
      );
    }

    if (!videoRow) {
      return NextResponse.json(
        { error: 'Video not found', reason: 'video_not_found' },
        { status: 404 },
      );
    }

    // ── 7. Ownership check (Req 1.8, 9.5) ────────────────────────────────
    const normalizedCaller = normalizeAddress(walletAddress);
    const normalizedOwner = normalizeAddress(videoRow.uploader_wallet);
    if (
      normalizedCaller.length === 0 ||
      normalizedCaller !== normalizedOwner
    ) {
      logRejection('not_owner', {
        videoId,
        walletAddress: truncateHash(storeKey),
        ownerWallet: truncateHash(normalizedOwner),
      });
      return NextResponse.json(
        {
          error: 'You are not the uploader of this video',
          reason: 'not_owner',
        },
        { status: 403 },
      );
    }

    // ── 8. Validate the incoming config for internal consistency ────────
    if (typeof accessMode !== 'string' || !ALLOWED_MODES.includes(accessMode as AccessMode)) {
      logRejection('invalid_access_mode', {
        videoId,
        walletAddress: truncateHash(storeKey),
        accessMode: typeof accessMode === 'string' ? accessMode : typeof accessMode,
      });
      return NextResponse.json(
        {
          error:
            "accessMode must be one of 'public', 'allowlist', 'timelock', 'purchasable'",
          reason: 'invalid_access_mode',
        },
        { status: 400 },
      );
    }

    const mode = accessMode as AccessMode;

    // Normalized / defaulted values we'll write to the DB. Start with the
    // "clear everything" baseline so the mode-specific branches only need
    // to set their own field. Writing explicit defaults for inactive modes
    // means the DB row is always internally consistent (Req 9.2, 9.3).
    let normalizedAllowlist: string[] = [];
    let normalizedUnlockAt: number | null = null;
    let normalizedPrice = 0;

    if (mode === 'allowlist') {
      if (!Array.isArray(allowlist) || allowlist.length === 0) {
        logRejection('allowlist_empty', {
          videoId,
          walletAddress: truncateHash(storeKey),
        });
        return NextResponse.json(
          {
            error: 'Allowlist mode requires at least one address',
            reason: 'allowlist_empty',
          },
          { status: 400 },
        );
      }

      const dedup = new Set<string>();
      const invalid: string[] = [];
      for (const entry of allowlist) {
        if (typeof entry !== 'string' || !APTOS_ADDRESS_REGEX.test(entry)) {
          invalid.push(typeof entry === 'string' ? entry : String(entry));
          continue;
        }
        dedup.add(entry.toLowerCase());
      }
      if (invalid.length > 0) {
        logRejection('allowlist_invalid_entry', {
          videoId,
          walletAddress: truncateHash(storeKey),
          invalidCount: invalid.length,
        });
        return NextResponse.json(
          {
            error: `Allowlist contains invalid address(es): ${invalid
              .slice(0, 5)
              .join(', ')}`,
            reason: 'allowlist_invalid_entry',
            invalidEntries: invalid,
          },
          { status: 400 },
        );
      }
      if (dedup.size === 0) {
        return NextResponse.json(
          {
            error: 'Allowlist mode requires at least one address',
            reason: 'allowlist_empty',
          },
          { status: 400 },
        );
      }
      normalizedAllowlist = Array.from(dedup).sort();
    } else if (mode === 'timelock') {
      if (typeof unlockAt !== 'number' || !Number.isFinite(unlockAt)) {
        logRejection('timelock_invalid', {
          videoId,
          walletAddress: truncateHash(storeKey),
          reason: 'unlockAt_not_number',
        });
        return NextResponse.json(
          {
            error: 'unlockAt must be a finite number (epoch milliseconds)',
            reason: 'timelock_invalid',
          },
          { status: 400 },
        );
      }
      const now = Date.now();
      if (unlockAt <= now) {
        logRejection('timelock_invalid', {
          videoId,
          walletAddress: truncateHash(storeKey),
          reason: 'unlockAt_in_past',
          unlockAt,
          now,
        });
        return NextResponse.json(
          {
            error: 'unlockAt must be in the future',
            reason: 'timelock_in_past',
          },
          { status: 400 },
        );
      }
      if (unlockAt >= videoRow.expiration_timestamp) {
        logRejection('timelock_invalid', {
          videoId,
          walletAddress: truncateHash(storeKey),
          reason: 'unlockAt_after_expiration',
          unlockAt,
          expirationTimestamp: videoRow.expiration_timestamp,
        });
        return NextResponse.json(
          {
            error:
              'unlockAt must be earlier than the video expiration timestamp',
            reason: 'timelock_after_expiration',
          },
          { status: 400 },
        );
      }
      normalizedUnlockAt = Math.floor(unlockAt);
    } else if (mode === 'purchasable') {
      // Req 1.7: purchasable mode requires an integer price > 0. A free
      // video should be saved as Public so there's no inconsistent state
      // where a purchase gate could appear with a zero price.
      if (
        typeof price !== 'number' ||
        !Number.isFinite(price) ||
        !Number.isInteger(price) ||
        price <= 0
      ) {
        logRejection('price_invalid', {
          videoId,
          walletAddress: truncateHash(storeKey),
          price: typeof price === 'number' ? price : typeof price,
        });
        return NextResponse.json(
          {
            error:
              'Purchasable mode requires an integer price greater than zero (SUSD base units)',
            reason: 'price_invalid',
          },
          { status: 400 },
        );
      }
      normalizedPrice = price;
    }
    // Public mode needs no additional validation — every other field is
    // cleared by the defaults above.

    // ── 9. Commit the update ─────────────────────────────────────────────
    // We write all four mutable columns on every call (including `price`)
    // so the row can never end up in a state like "purchasable with a
    // stale price from a prior timelock configuration". The service-role
    // client bypasses RLS, which is fine here because the ownership check
    // above has already established the caller's authority.
    const updatePayload = {
      access_mode: mode,
      allowlist: normalizedAllowlist,
      unlock_at: normalizedUnlockAt,
      price: normalizedPrice,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedRow, error: updateError } = await admin
      .from('videos')
      .update(updatePayload)
      .eq('video_id', videoId)
      .select('video_id, access_mode, allowlist, unlock_at, price')
      .maybeSingle();

    if (updateError || !updatedRow) {
      console.error(
        '[/api/videos/:id/access-config] update failed:',
        updateError,
      );
      return NextResponse.json(
        { error: 'Internal server error', reason: 'server_error' },
        { status: 500 },
      );
    }

    logAccessConfigUpdated({
      videoId,
      walletAddress: truncateHash(storeKey),
      accessMode: mode,
      allowlistLength: normalizedAllowlist.length,
      unlockAt: normalizedUnlockAt,
      price: normalizedPrice,
    });

    return NextResponse.json(
      {
        ok: true,
        videoId: updatedRow.video_id,
        accessMode: updatedRow.access_mode,
        allowlist: updatedRow.allowlist ?? [],
        unlockAt: updatedRow.unlock_at ?? null,
        price: updatedRow.price ?? 0,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/videos/:id/access-config] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', reason: 'server_error' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



/**
 * Single-line JSON warn log for every rejection path, mirroring the
 * structured logger in /api/payments/verify so operators can parse both
 * routes' warn stream with the same shape.
 */
function logRejection(
  event: string,
  context: Record<string, unknown>,
): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      route: '/api/videos/:id/access-config',
      event,
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Single-line JSON info log for successful access-config updates.
 * Carries the new mode plus enough shape info (allowlist length,
 * unlockAt, price) to correlate UI edits with on-disk state.
 */
function logAccessConfigUpdated(context: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      level: 'info',
      route: '/api/videos/:id/access-config',
      event: 'access_config_updated',
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}
