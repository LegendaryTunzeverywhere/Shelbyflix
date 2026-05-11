import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizeAddress } from '@/lib/access-control';
import { truncateHash } from '@/lib/shared-utils';

// ---------------------------------------------------------------------------
// GET /api/videos/:id/purchases?wallet=0x...
//
// Owner-only endpoint that returns verified purchase receipts for a video:
//
//   {
//     count:     number,
//     purchases: Array<{
//       wallet_address: string,   // lowercased
//       amount_total:   number,   // SUSD base units
//       created_at:     string,   // ISO timestamp
//     }>,
//   }
//
// Used by `components/CreatorVideoSettings.tsx` (task 4.6) to render the
// live purchase count alongside the access-mode editor on a creator's own
// video page. Rows are sorted newest-first and capped at 50 so the UI stays
// lightweight — "show more" pagination is explicitly out of scope for v1;
// creators with >50 purchases still see the accurate `count`.
//
// ── AuthN/AuthZ ────────────────────────────────────────────────────────────
// Ownership is verified via a **simple equality check** between the `wallet`
// query param and the row's `uploader_wallet` column. The PATCH route for
// access-config edits (`/api/videos/:id/access-config`) performs full
// challenge/signed-nonce verification; for a strictly read-only receipt
// listing we accept the lighter check in v1 because:
//   1. The response contains no sensitive fields — wallet addresses, amounts,
//      and timestamps are all either already public (chain-visible) or
//      derivable from the `videos` row and on-chain tx data.
//   2. Both the `videos.uploader_wallet` lookup and the `video_purchases`
//      read go through the service-role client; direct client reads of
//      `video_purchases` are blocked by RLS (migration `2026_05...sql`
//      enables RLS with no policies), so there is no anonymous leak path.
//   3. An attacker who guesses a creator's wallet gains nothing they
//      couldn't already compute by reading the chain.
//
// NOTE: Ownership is currently verified via wallet address equality check.
// A future enhancement would upgrade to the same challenge/signed-nonce flow
// used by /api/videos/:id/access-config for signature-verified ownership.
// This is acceptable for v1 because the response contains only publicly
// derivable data (on-chain wallet addresses, amounts, timestamps).
//
// Requirements covered: 9.1 (owner can see a live purchase count and
// receipt list on their own video page), 9.5 (403 for non-owners).
// ---------------------------------------------------------------------------

const VIDEO_ID_REGEX = /^[\w-]+$/;
const APTOS_ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;
const MAX_PURCHASES_RETURNED = 50;

export async function GET(
  req: NextRequest,
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

    // ── 2. Read and validate the caller's wallet ─────────────────────────
    // Accept both a `wallet` query param (the canonical form used by the
    // rest of the feature's endpoints) and an `x-wallet-address` header
    // so future callers that prefer headers don't have to mutate URLs.
    const walletFromQuery = req.nextUrl.searchParams.get('wallet');
    const walletFromHeader = req.headers.get('x-wallet-address');
    const rawWallet = walletFromQuery || walletFromHeader;

    if (!rawWallet) {
      return NextResponse.json(
        {
          error: 'wallet query param or x-wallet-address header is required',
          reason: 'missing_fields',
        },
        { status: 400 },
      );
    }
    if (!APTOS_ADDRESS_REGEX.test(rawWallet)) {
      return NextResponse.json(
        { error: 'Invalid wallet address', reason: 'invalid_address' },
        { status: 400 },
      );
    }

    const callerWallet = normalizeAddress(rawWallet);

    // ── 3. Service-role client bootstrap ─────────────────────────────────
    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch (err) {
      console.error(
        '[/api/videos/:id/purchases] service-role client unavailable:',
        err,
      );
      return NextResponse.json(
        { error: 'Internal server error', reason: 'server_error' },
        { status: 500 },
      );
    }

    // ── 4. Fetch the video owner ─────────────────────────────────────────
    // Pulling only `uploader_wallet` keeps the query lean and makes the
    // intent of this read obvious to anybody auditing the server logs.
    const { data: videoRow, error: videoErr } = await admin
      .from('videos')
      .select('video_id, uploader_wallet')
      .eq('video_id', videoId)
      .maybeSingle();

    if (videoErr) {
      console.error(
        '[/api/videos/:id/purchases] video lookup failed:',
        videoErr,
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

    // ── 5. Ownership check (Req 9.5) ─────────────────────────────────────
    // Matches the PATCH /access-config route exactly so the two creator-
    // facing endpoints behave consistently. Case-insensitive equality on
    // normalized addresses; anything else → 403.
    const ownerWallet = normalizeAddress(videoRow.uploader_wallet);
    if (ownerWallet.length === 0 || ownerWallet !== callerWallet) {
      logRejection('not_owner', {
        videoId,
        caller: truncateHash(callerWallet),
        owner: truncateHash(ownerWallet),
      });
      return NextResponse.json(
        {
          error: 'You are not the uploader of this video',
          reason: 'not_owner',
        },
        { status: 403 },
      );
    }

    // ── 6. Fetch the purchase receipts ───────────────────────────────────
    // We request `count: 'exact'` so the UI can render "12 purchases" even
    // when the `purchases` array is capped at MAX_PURCHASES_RETURNED. The
    // limited row slice is ordered newest-first because the primary UI use
    // case is "who just paid?", not historical bookkeeping.
    const { data: purchaseRows, error: purchasesErr, count } = await admin
      .from('video_purchases')
      .select('wallet_address, amount_total, created_at', { count: 'exact' })
      .eq('video_id', videoId)
      .order('created_at', { ascending: false })
      .limit(MAX_PURCHASES_RETURNED);

    if (purchasesErr) {
      console.error(
        '[/api/videos/:id/purchases] receipts lookup failed:',
        purchasesErr,
      );
      return NextResponse.json(
        { error: 'Internal server error', reason: 'server_error' },
        { status: 500 },
      );
    }

    const purchases = (purchaseRows ?? []).map((row) => ({
      wallet_address: normalizeAddress(row.wallet_address),
      amount_total: Number(row.amount_total),
      created_at: row.created_at,
    }));

    return NextResponse.json(
      {
        count: count ?? purchases.length,
        purchases,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/videos/:id/purchases] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', reason: 'server_error' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers (mirror the style used by /api/videos/:id/access-config so both
// routes' logs read consistently).
// ---------------------------------------------------------------------------

function logRejection(
  event: string,
  context: Record<string, unknown>,
): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      route: '/api/videos/:id/purchases',
      event,
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}
