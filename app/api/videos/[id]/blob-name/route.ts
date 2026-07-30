import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizeAddress } from '@/lib/access-control';
import { getAptosClient } from '@/lib/aptos-client';
import { ACCESS_CONTROL_MODULE } from '@/lib/move-contract';
import { logChainViewFailure } from '@/lib/move-logging';

// ---------------------------------------------------------------------------
// GET /api/videos/:id/blob-name
//
// Resolves the canonical `full_blob_name: String` that every Move entry /
// view function in the `access_control` module expects as its blob key.
//
// The result is the server-computed form of
// `create_full_blob_name(uploader_wallet, blob_name_suffix)` for the
// requested video. Performing this join on the server means the client
// (notably the native purchase path in `usePurchase` / `PurchaseGate`)
// never needs to know the uploader's wallet just to build the tx payload.
//
// Response shape:
//   200 { fullBlobName: string }
//   400 { error, reason: 'invalid_video_id' }
//   404 { error, reason: 'video_not_found' | 'missing_uploader_wallet' | 'missing_blob_name' }
//   500 { error, reason: 'server_error' }
//
// Resolution rules (Req 2.4, 2.6):
//   1. Validate `videoId` shape (`^[\w-]+$`).
//   2. Fetch the `videos` row via the service-role client, selecting only
//      `uploader_wallet` and `blob_name`. Missing row → 404.
//   3. Canonicalize `uploader_wallet` via `normalizeAddress`. Empty
//      canonical form (null / whitespace / unparseable) → 404 with
//      `reason: 'missing_uploader_wallet'` (Req 2.4 "input missing"
//      branch, preserving the DB record).
//   4. Trim `blob_name`; empty → 404 with `reason: 'missing_blob_name'`.
//   5. Call `${ACCESS_CONTROL_MODULE}create_full_blob_name(owner, suffix)`
//      with a 10-second wall-clock timeout covering the entire round
//      trip. On any of the Req 2.6 enumerated failure classes —
//      (a) network transport error, (b) timeout, (c) module / view
//      function not found, (d) non-string or empty return, or
//      (e) any thrown exception — fall back to computing
//      `${canonicalOwner}/${suffix}` in TypeScript, and emit exactly
//      one single-line JSON warn via `logChainViewFailure` naming the
//      blob, canonical owner, and failure class so operators can
//      investigate module-version drift. The fallback result is NOT
//      cached (per Req 2.6).
//
// No wallet authentication is required. The response contains only data
// that is already publicly derivable — `uploader_wallet` and `blob_name`
// are returned by the public `GET /api/videos` listing, and
// `create_full_blob_name` is a view function. The endpoint is a pure
// server-side convenience so the client never has to reconstruct the
// suffix format itself.
//
// Requirements covered: 2.4, 2.6
// ---------------------------------------------------------------------------

const VIDEO_ID_REGEX = /^[\w-]+$/;
const VIEW_TIMEOUT_MS = 10_000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // ── 1. Resolve and validate the videoId ──────────────────────────────
    const { id: videoId } = await params;
    if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
      return NextResponse.json(
        { error: 'Invalid video id', reason: 'invalid_video_id' },
        { status: 400 },
      );
    }

    // ── 2. Bootstrap the service-role client ─────────────────────────────
    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch (err) {
      console.error(
        '[/api/videos/:id/blob-name] service-role client unavailable:',
        err,
      );
      return NextResponse.json(
        { error: 'Internal server error', reason: 'server_error' },
        { status: 500 },
      );
    }

    // ── 3. Fetch the uploader_wallet + blob_name columns ────────────────
    // Only these two columns are needed to resolve the full_blob_name.
    // Pulling them explicitly (instead of `select('*')`) keeps the query
    // lean and matches the narrow surface documented at the top of this
    // file.
    const { data: videoRow, error: fetchError } = await admin
      .from('videos')
      .select('uploader_wallet, blob_name')
      .eq('video_id', videoId)
      .maybeSingle();

    if (fetchError) {
      console.error(
        '[/api/videos/:id/blob-name] video lookup failed:',
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

    // ── 4. Canonicalize the uploader wallet ──────────────────────────────
    // `normalizeAddress` returns '' for null / undefined / whitespace-only
    // / unparseable input (Req 2.2, 2.3). That's the "no wallet" sentinel
    // we treat as "input missing" per Req 2.4 — do not invoke the view
    // function and do not produce a fallback blob name; surface a 404 so
    // the caller can distinguish this from an actual chain outage.
    const canonicalOwner = normalizeAddress(videoRow.uploader_wallet);
    if (canonicalOwner.length === 0) {
      return NextResponse.json(
        {
          error: 'Video has no uploader wallet on file',
          reason: 'missing_uploader_wallet',
        },
        { status: 404 },
      );
    }

    // ── 5. Validate the blob-name suffix ─────────────────────────────────
    // Req 2.4: a null / undefined / whitespace-only suffix is treated as
    // "input missing" — do NOT invoke `create_full_blob_name` and do NOT
    // compute a fallback; respond with a precise 404 so the caller knows
    // the record is incomplete rather than the chain being unreachable.
    const rawSuffix =
      typeof videoRow.blob_name === 'string' ? videoRow.blob_name : '';
    const suffix = rawSuffix.trim();
    if (suffix.length === 0) {
      return NextResponse.json(
        {
          error: 'Video has no blob name on file',
          reason: 'missing_blob_name',
        },
        { status: 404 },
      );
    }

    // ── 6. Resolve the full blob name ────────────────────────────────────
    // Preferred path: call the Move `create_full_blob_name` view so the
    // result matches what every on-chain entry function will expect
    // byte-for-byte. On any Req 2.6 failure class we fall back to the
    // canonical TypeScript join and log exactly one warn line so the
    // operator can correlate module-version drift.
    const fullBlobName = await resolveFullBlobName({
      videoId,
      canonicalOwner,
      suffix,
    });

    return NextResponse.json({ fullBlobName }, { status: 200 });
  } catch (err) {
    console.error('[/api/videos/:id/blob-name] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', reason: 'server_error' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Invoke `${ACCESS_CONTROL_MODULE}create_full_blob_name(owner, suffix)`
 * with a 10-second wall-clock timeout. Returns the chain-computed string
 * on success; falls back to `${canonicalOwner}/${suffix}` on any Req 2.6
 * failure class, pairing the fallback with a single `logChainViewFailure`
 * warn naming the blob, the canonical owner, and the failure class.
 *
 * Failure-class mapping (Req 2.6 → move-logging event):
 *   (a) network transport error       → 'view_error'
 *   (b) 10-second timeout              → 'view_timeout'
 *   (c) module / view fn not found     → 'view_error'
 *   (d) non-string or empty return     → 'view_decode_error'
 *   (e) any thrown exception           → 'view_error'
 */
async function resolveFullBlobName(ctx: {
  videoId: string;
  canonicalOwner: string;
  suffix: string;
}): Promise<string> {
  const { videoId, canonicalOwner, suffix } = ctx;
  const fallback = `${canonicalOwner}/${suffix}`;

  const aptos = getAptosClient();

  // `Promise.race` with a manual timeout gives us a tight 10-second wall
  // clock regardless of the underlying Aptos SDK's own retry / timeout
  // behavior. The timeout branch returns a sentinel object; we compare by
  // reference so no value the chain could plausibly return collides with it.
  const timeoutSentinel = { __timeout: true } as const;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<typeof timeoutSentinel>((resolve) => {
    timeoutId = setTimeout(() => resolve(timeoutSentinel), VIEW_TIMEOUT_MS);
  });

  try {
    const viewPromise = aptos.view<[string]>({
      payload: {
        function:
          `${ACCESS_CONTROL_MODULE}create_full_blob_name` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [canonicalOwner, suffix],
      },
    });

    const raced = await Promise.race([viewPromise, timeoutPromise]);

    if (raced === timeoutSentinel) {
      // (b) — 10-second timeout
      logChainViewFailure('view_timeout', {
        videoId,
        wallet: canonicalOwner,
        message: `create_full_blob_name timeout after ${VIEW_TIMEOUT_MS}ms; using TypeScript fallback`,
      });
      return fallback;
    }

    // (d) — non-string or empty return. The `.view<[string]>` call is
    // typed optimistically; at runtime we still verify the shape because
    // the Aptos SDK does no runtime validation of the generic parameter.
    const first = Array.isArray(raced) ? raced[0] : undefined;
    if (typeof first !== 'string' || first.length === 0) {
      logChainViewFailure('view_decode_error', {
        videoId,
        wallet: canonicalOwner,
        message: `create_full_blob_name returned non-string or empty result; using TypeScript fallback`,
      });
      return fallback;
    }

    return first;
  } catch (err) {
    // (a), (c), (e) — any transport error, missing module / function, or
    // unexpected SDK throw lands here. We log a single warn and fall back
    // without caching the result (Req 2.6).
    logChainViewFailure('view_error', {
      videoId,
      wallet: canonicalOwner,
      message: `create_full_blob_name failed (${err instanceof Error ? err.message : String(err)}); using TypeScript fallback`,
    });
    return fallback;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
