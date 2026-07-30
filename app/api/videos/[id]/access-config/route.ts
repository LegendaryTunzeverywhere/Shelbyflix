import { NextRequest, NextResponse } from 'next/server';
import { Ed25519PublicKey, Ed25519Signature } from '@aptos-labs/ts-sdk';
import { nonceStore, verifyAndConsumeNonce } from '@/lib/nonce-store';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizeAddress } from '@/lib/access-control';
import { hexToBytes, truncateHash } from '@/lib/shared-utils';
import { moveContractBackend } from '@/lib/move-contract-backend';
import { ChainUnavailableError } from '@/lib/move-contract-backend';
import { ACCESS_CONTROL_MODULE } from '@/lib/move-contract';
import { serializeAccessPolicy, msToMicros } from '@/lib/move-bcs';
import type { AccessPolicy } from '@/lib/move-bcs';
import { getAptosClient } from '@/lib/aptos-client';
import { logChainViewFailure } from '@/lib/move-logging';
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
// Under NEXT_PUBLIC_ACCESS_BACKEND === "move":
//   - The handler reads the current policy from chain via
//     moveContractBackend.getConfig(videoId) (not Supabase legacy columns).
//   - A canonical-equality diff determines the response:
//       * Identical → 200 with no `chainTx`
//       * Allowlist-only change → `chainTx` targeting `update_allowlist`
//       * Any other diff → `chainTx` targeting `force_update_policy_v2`
//   - The handler NEVER writes videos.access_mode / allowlist / unlock_at /
//     price columns under the move flag (Req 9.5).
//
// Under NEXT_PUBLIC_ACCESS_BACKEND === "supabase" (default):
//   - Behavior is unchanged from the pre-feature implementation.
//
// Requirements covered: 9.1–9.9, 15.6
// ---------------------------------------------------------------------------

const APTOS_ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;
const VIDEO_ID_REGEX = /^[\w-]+$/;

const ALLOWED_MODES: readonly AccessMode[] = [
  'public',
  'allowlist',
  'timelock',
  'purchasable',
] as const;

/** U64 max for price validation (Req 9.9). */
const U64_MAX = (1n << 64n) - 1n;

/** Maximum allowlist entries (Req 9.9). */
const MAX_ALLOWLIST_ENTRIES = 100;

/** View-call timeout for blob-name resolution (Req 2.6). */
const VIEW_TIMEOUT_MS = 10_000;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // ── 0. Read the backend flag at request-handler entry (Req 15.6) ────
    // This MUST be read per-request, not at module-load time, so a flag
    // change takes effect on the next request without a process restart.
    const accessBackend = process.env.NEXT_PUBLIC_ACCESS_BACKEND;
    const isMoveBackend = accessBackend === 'move';

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
      const ed25519Sig = new Ed25519Signature(sigBytes);
      signatureValid = pubKey.verifySignature({
        message: messageBytes,
        signature: ed25519Sig,
      });
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
    const { data: videoRow, error: fetchError } = await admin
      .from('videos')
      .select('video_id, uploader_wallet, expiration_timestamp, blob_name')
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

    // ── 7. Ownership check (Req 1.8, 9.5, 9.8) ──────────────────────────
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

    // Normalized / defaulted values we'll use for both branches.
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

      // Req 9.9: allowlist length ≤ 100
      if (allowlist.length > MAX_ALLOWLIST_ENTRIES) {
        logRejection('allowlist_too_large', {
          videoId,
          walletAddress: truncateHash(storeKey),
          count: allowlist.length,
        });
        return NextResponse.json(
          {
            error: `Allowlist must not exceed ${MAX_ALLOWLIST_ENTRIES} entries`,
            reason: 'allowlist_too_large',
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
        // Canonicalize each entry (Req 2.1)
        const canonical = normalizeAddress(entry);
        if (canonical.length === 0) {
          invalid.push(entry);
          continue;
        }
        dedup.add(canonical);
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
      // Req 9.9: re-check after dedup
      if (dedup.size > MAX_ALLOWLIST_ENTRIES) {
        return NextResponse.json(
          {
            error: `Allowlist must not exceed ${MAX_ALLOWLIST_ENTRIES} entries after deduplication`,
            reason: 'allowlist_too_large',
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
      // Req 9.9: price must be a non-negative integer strictly less than 2^64
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
      // Req 9.9: price in [0, 2^64 - 1]
      if (BigInt(price) > U64_MAX) {
        logRejection('price_invalid', {
          videoId,
          walletAddress: truncateHash(storeKey),
          price,
        });
        return NextResponse.json(
          {
            error: 'Price exceeds the maximum allowed value (u64 max)',
            reason: 'price_invalid',
          },
          { status: 400 },
        );
      }
      normalizedPrice = price;
    }

    // ─────────────────────────────────────────────────────────────────────
    // BRANCH: Move backend (Req 9.1–9.5, 9.7, 15.6)
    // ─────────────────────────────────────────────────────────────────────
    if (isMoveBackend) {
      return await handleMoveBranch({
        videoId,
        videoRow,
        mode,
        normalizedAllowlist,
        normalizedUnlockAt,
        normalizedPrice,
        storeKey,
      });
    }

    // ─────────────────────────────────────────────────────────────────────
    // BRANCH: Supabase backend (Req 9.6) — preserved bit-for-bit
    // ─────────────────────────────────────────────────────────────────────
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
// Move-backend branch (Req 9.1–9.5, 9.7)
// ---------------------------------------------------------------------------

interface MoveBranchArgs {
  videoId: string;
  videoRow: {
    video_id: string;
    uploader_wallet: string;
    expiration_timestamp: number;
    blob_name: string;
  };
  mode: AccessMode;
  normalizedAllowlist: string[];
  normalizedUnlockAt: number | null;
  normalizedPrice: number;
  storeKey: string;
}

async function handleMoveBranch(args: MoveBranchArgs): Promise<NextResponse> {
  const {
    videoId,
    videoRow,
    mode,
    normalizedAllowlist,
    normalizedUnlockAt,
    normalizedPrice,
    storeKey,
  } = args;

  // ── Load the currently persisted policy from chain (Req 9.3, 9.7) ────
  // We use moveContractBackend.getConfig(videoId) which reads from chain,
  // NOT from the Supabase legacy columns.
  let currentConfig;
  try {
    currentConfig = await moveContractBackend.getConfig(videoId);
  } catch (err) {
    if (err instanceof ChainUnavailableError) {
      logRejection('chain_unavailable', {
        videoId,
        walletAddress: truncateHash(storeKey),
        code: err.code,
      });
      return NextResponse.json(
        { error: 'Chain temporarily unavailable', reason: 'chain_unavailable' },
        { status: 503 },
      );
    }
    console.error(
      '[/api/videos/:id/access-config] getConfig failed:',
      err,
    );
    return NextResponse.json(
      { error: 'Internal server error', reason: 'server_error' },
      { status: 500 },
    );
  }

  // ── Resolve the full_blob_name for the chainTx payload (Req 9.4) ─────
  const canonicalOwner = normalizeAddress(videoRow.uploader_wallet);
  const suffix = videoRow.blob_name?.trim() ?? '';
  const fullBlobName = await resolveFullBlobNameForPatch(
    videoId,
    canonicalOwner,
    suffix,
  );

  if (!fullBlobName) {
    return NextResponse.json(
      { error: 'Unable to resolve blob name for video', reason: 'server_error' },
      { status: 500 },
    );
  }

  // ── Build the "new" policy representation for comparison ──────────────
  // Map the validated request body to the same shape as what getConfig
  // returns so we can do a canonical-equality diff.
  const newAccessMode = mode;
  const newAllowlist = normalizedAllowlist; // already canonical + sorted
  const newUnlockAt = normalizedUnlockAt;
  const newPrice = normalizedPrice;

  // ── Canonical-equality diff (Req 9.7) ─────────────────────────────────
  // Compare the requested policy against the currently persisted one.
  // If they are identical, return 200 with no chainTx.
  const isIdentical = policiesAreEqual(
    currentConfig,
    newAccessMode,
    newAllowlist,
    newUnlockAt,
    newPrice,
  );

  if (isIdentical) {
    logAccessConfigUpdated({
      videoId,
      walletAddress: truncateHash(storeKey),
      accessMode: mode,
      allowlistLength: normalizedAllowlist.length,
      unlockAt: normalizedUnlockAt,
      price: normalizedPrice,
      noChange: true,
    });

    return NextResponse.json(
      {
        ok: true,
        videoId,
        accessMode: newAccessMode,
        allowlist: newAllowlist,
        unlockAt: newUnlockAt,
        price: newPrice,
      },
      { status: 200 },
    );
  }

  // ── Determine which entry function to target (Req 9.2, 9.3) ──────────
  // If the blob is not registered on chain yet (currentConfig is null),
  // we need to register it first via register_blobs_v2 rather than trying
  // to update a non-existent policy (which would abort with E_UNREACHABLE).
  // Exception: public mode doesn't need chain registration at all.
  if (!currentConfig) {
    if (newAccessMode === 'public') {
      // Public mode — no chain registration needed. Just acknowledge.
      logAccessConfigUpdated({
        videoId,
        walletAddress: truncateHash(storeKey),
        accessMode: mode,
        allowlistLength: 0,
        unlockAt: null,
        price: 0,
        noChange: true,
      });

      return NextResponse.json(
        {
          ok: true,
          videoId,
          accessMode: newAccessMode,
          allowlist: [],
          unlockAt: null,
          price: 0,
        },
        { status: 200 },
      );
    }

    const newPolicy = buildAccessPolicy(
      newAccessMode,
      newAllowlist,
      newUnlockAt,
      newPrice,
    );

    // Build a RegistrationInfoV2 and serialize as a single-element vector
    const { serializeRegistrationInfoV2Vec } = await import('@/lib/move-bcs');
    const regInfo = {
      blob_name: fullBlobName,
      green_box_scheme: 0,
      green_box_bytes: new Uint8Array(0),
      access_policy: newPolicy,
    };
    const bcsBytes = serializeRegistrationInfoV2Vec([regInfo]);

    const chainTx = {
      function: `${ACCESS_CONTROL_MODULE}register_blobs_v2`,
      typeArguments: [] as string[],
      functionArguments: [Array.from(bcsBytes)],
    };

    logAccessConfigUpdated({
      videoId,
      walletAddress: truncateHash(storeKey),
      accessMode: mode,
      allowlistLength: normalizedAllowlist.length,
      unlockAt: normalizedUnlockAt,
      price: normalizedPrice,
      entryFunction: 'register_blobs_v2',
    });

    return NextResponse.json(
      {
        ok: true,
        videoId,
        accessMode: newAccessMode,
        allowlist: newAllowlist,
        unlockAt: newUnlockAt,
        price: newPrice,
        chainTx,
      },
      { status: 200 },
    );
  }

  const isAllowlistOnlyChange = detectAllowlistOnlyChange(
    currentConfig,
    newAccessMode,
    newAllowlist,
  );

  if (isAllowlistOnlyChange) {
    // Req 9.2: allowlist-only change → update_allowlist(full_blob_name, addresses[])
    const chainTx = {
      function: `${ACCESS_CONTROL_MODULE}update_allowlist`,
      typeArguments: [] as string[],
      functionArguments: [fullBlobName, newAllowlist],
    };

    logAccessConfigUpdated({
      videoId,
      walletAddress: truncateHash(storeKey),
      accessMode: mode,
      allowlistLength: normalizedAllowlist.length,
      unlockAt: normalizedUnlockAt,
      price: normalizedPrice,
      entryFunction: 'update_allowlist',
    });

    return NextResponse.json(
      {
        ok: true,
        videoId,
        accessMode: newAccessMode,
        allowlist: newAllowlist,
        unlockAt: newUnlockAt,
        price: newPrice,
        chainTx,
      },
      { status: 200 },
    );
  }

  // Req 9.3: any other non-identity diff → force_update_policy_v2
  const newPolicy = buildAccessPolicy(
    newAccessMode,
    newAllowlist,
    newUnlockAt,
    newPrice,
  );
  const bcsPolicyBytes = serializeAccessPolicy(newPolicy);

  const chainTx = {
    function: `${ACCESS_CONTROL_MODULE}force_update_policy_v2`,
    typeArguments: [] as string[],
    functionArguments: [fullBlobName, Array.from(bcsPolicyBytes)],
  };

  logAccessConfigUpdated({
    videoId,
    walletAddress: truncateHash(storeKey),
    accessMode: mode,
    allowlistLength: normalizedAllowlist.length,
    unlockAt: normalizedUnlockAt,
    price: normalizedPrice,
    entryFunction: 'force_update_policy_v2',
  });

  return NextResponse.json(
    {
      ok: true,
      videoId,
      accessMode: newAccessMode,
      allowlist: newAllowlist,
      unlockAt: newUnlockAt,
      price: newPrice,
      chainTx,
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the full_blob_name for the PATCH handler's chainTx payload.
 * Uses the same logic as the blob-name endpoint: call the on-chain view
 * function with a 10-second timeout, falling back to the TypeScript join
 * on any failure (Req 2.4, 2.6).
 */
async function resolveFullBlobNameForPatch(
  videoId: string,
  canonicalOwner: string,
  suffix: string,
): Promise<string | null> {
  if (!canonicalOwner || canonicalOwner.length === 0) return null;
  if (!suffix || suffix.length === 0) return null;

  const fallback = `${canonicalOwner}/${suffix}`;

  try {
    const client = getAptosClient();

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('timeout')), VIEW_TIMEOUT_MS);
    });

    const viewPromise = client.view({
      payload: {
        function: `${ACCESS_CONTROL_MODULE}create_full_blob_name` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [canonicalOwner, suffix],
      },
    });

    const result = await Promise.race([viewPromise, timeoutPromise]);

    if (
      Array.isArray(result) &&
      result.length === 1 &&
      typeof result[0] === 'string' &&
      result[0].length > 0
    ) {
      return result[0];
    }

    // Non-string or empty return → fallback
    logChainViewFailure('view_decode_error', {
      videoId,
      wallet: canonicalOwner,
      message: `create_full_blob_name returned unexpected shape in PATCH; using fallback`,
    });
    return fallback;
  } catch (err) {
    // Any failure → fallback with a single warn (Req 2.6)
    const isTimeout = err instanceof Error && err.message === 'timeout';
    logChainViewFailure(isTimeout ? 'view_timeout' : 'view_error', {
      videoId,
      wallet: canonicalOwner,
      message: `create_full_blob_name failed in PATCH (${err instanceof Error ? err.message : String(err)}); using fallback`,
    });
    return fallback;
  }
}

/**
 * Determine if the current on-chain policy and the requested new policy
 * are canonically equal (Req 9.7).
 *
 * Returns true when mode, sorted allowlist, price, and unlockAt all match.
 * If currentConfig is null (blob not registered), we treat it as a
 * non-match so the handler emits a chainTx.
 */
function policiesAreEqual(
  currentConfig: { accessMode: AccessMode; allowlist?: string[]; unlockAt?: number; priceBaseUnits?: number } | null,
  newMode: AccessMode,
  newAllowlist: string[],
  newUnlockAt: number | null,
  newPrice: number,
): boolean {
  if (!currentConfig) return false;

  if (currentConfig.accessMode !== newMode) return false;

  if (newMode === 'allowlist') {
    const currentList = (currentConfig.allowlist ?? []).slice().sort();
    if (currentList.length !== newAllowlist.length) return false;
    for (let i = 0; i < currentList.length; i++) {
      if (currentList[i] !== newAllowlist[i]) return false;
    }
  }

  if (newMode === 'timelock') {
    const currentUnlock = currentConfig.unlockAt ?? null;
    if (currentUnlock !== newUnlockAt) return false;
  }

  if (newMode === 'purchasable') {
    const currentPrice = currentConfig.priceBaseUnits ?? 0;
    if (currentPrice !== newPrice) return false;
  }

  // For 'public' mode, no additional fields to compare
  return true;
}

/**
 * Detect if the change is an allowlist-only modification (Req 9.2):
 * both old and new must be accessMode === 'allowlist', and only the
 * addresses differ.
 */
function detectAllowlistOnlyChange(
  currentConfig: { accessMode: AccessMode; allowlist?: string[] } | null,
  newMode: AccessMode,
  newAllowlist: string[],
): boolean {
  if (!currentConfig) return false;
  if (currentConfig.accessMode !== 'allowlist') return false;
  if (newMode !== 'allowlist') return false;

  // Both are allowlist mode — the addresses must differ (otherwise
  // policiesAreEqual would have caught it as identical).
  // Since we already know they're not identical and both are allowlist,
  // this IS an allowlist-only change.
  return true;
}

/**
 * Build the Move `AccessPolicy` from the validated request body fields.
 * Maps the app's AccessMode + parameters to the BCS-serializable type.
 */
function buildAccessPolicy(
  mode: AccessMode,
  allowlist: string[],
  unlockAt: number | null,
  price: number,
): AccessPolicy {
  switch (mode) {
    case 'public':
      // Public = PayToDownload { price: 0 } on chain (design decision 4)
      return { kind: 'PayToDownload', price: 0n };

    case 'allowlist':
      return { kind: 'Allowlist', addresses: allowlist };

    case 'timelock': {
      // Convert ms → µs for the Move module (Req 11.2)
      const lockedUntil = msToMicros(unlockAt!);
      return { kind: 'TimeLock', locked_until: lockedUntil };
    }

    case 'purchasable':
      return { kind: 'PayToDownload', price: BigInt(price) };

    default: {
      const _exhaustive: never = mode;
      void _exhaustive;
      // Fallback — should never reach here
      return { kind: 'PayToDownload', price: 0n };
    }
  }
}

/**
 * Single-line JSON warn log for every rejection path.
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
