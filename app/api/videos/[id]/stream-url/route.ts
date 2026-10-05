import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizeAddress, resolveAccess } from '@/lib/access-control';
import { hasWalletSession } from '@/lib/wallet-session';

// ---------------------------------------------------------------------------
// GET /api/videos/:id/stream-url?wallet=0x...
//
// SECURITY-CRITICAL: this is the ONLY place the storage stream URL for a
// video is allowed to leave the server. `shelby_url` is no longer selected
// by any public read path (PUBLIC_VIDEO_COLUMNS in lib/video-service.ts and
// the GET /api/videos listing both exclude it) — those run through the
// public anon-key Supabase client and are readable by anyone, which
// previously handed every viewer a directly fetchable storage URL for
// purchasable / allowlisted / time-locked videos regardless of whether they
// had actually earned access.
//
// Two-stage authorization, identical to GET /api/videos/:id/decryption-key:
//
//   1. Anonymous resolution first. Videos anyone may watch (Public, a
//      Time Lock past its unlock time, a free Purchasable video) hand over
//      the URL with no wallet and no session, so playback for open content
//      never depends on auth state.
//
//   2. Wallet-dependent access (owner, allowlist, purchase receipt) is ONLY
//      honored when the `wallet` query param is backed by a valid
//      wallet-session cookie (`hasWalletSession` — established by signing
//      the challenge in POST /api/interactions, action 'session'). A bare
//      `?wallet=0x...` is forgeable by anyone with curl: without this check,
//      anybody who knew an allowlisted or paying viewer's public address
//      could pull the storage URL for gated content by impersonating them.
//      Missing/expired session → 401 `wallet_session_required` so the
//      client can prompt a re-sign instead of showing a terminal 403.
//
// No caching headers are set, matching the access and decryption-key
// endpoints, so a permission change (allowlist edit, unlock time passing,
// a fresh purchase) is reflected immediately.
//
// Note on `blob_name`: it is deliberately NOT returned here. The download
// helpers only ever used it as a cache key, and the client now keys that
// cache by `video_id` instead — so the blob identifier stays server-side
// along with the URL.
// ---------------------------------------------------------------------------

const VIDEO_ID_REGEX = /^[\w-]+$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: videoId } = await params;
    if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
      return NextResponse.json(
        { error: 'Invalid video id', reason: 'invalid_video_id' },
        { status: 400 },
      );
    }

    const walletRaw = req.nextUrl.searchParams.get('wallet');
    const normalizedWallet = normalizeAddress(walletRaw);
    const wallet = normalizedWallet.length > 0 ? normalizedWallet : null;

    // Stage 1: can an anonymous caller already play this video?
    const anonAccess = await resolveAccess(videoId, null);

    if (anonAccess.reason === 'chain_unavailable') {
      return NextResponse.json(
        { error: 'Chain temporarily unreachable', reason: 'chain_unavailable' },
        { status: 503 },
      );
    }

    let hasAccess = anonAccess.hasAccess;
    let denyReason = anonAccess.reason;

    if (!hasAccess && wallet) {
      // Stage 2: wallet-dependent access — the wallet claim must be backed
      // by a signed wallet session, not just a query parameter.
      let sessionOk = false;
      try {
        sessionOk = await hasWalletSession(req, wallet);
      } catch (err) {
        console.error('[/api/videos/:id/stream-url] session lookup failed:', err);
        return NextResponse.json(
          { error: 'Internal server error', reason: 'server_error' },
          { status: 500 },
        );
      }

      if (!sessionOk) {
        return NextResponse.json(
          {
            error: 'Sign in to access this video',
            reason: 'wallet_session_required',
          },
          { status: 401 },
        );
      }

      const walletAccess = await resolveAccess(videoId, wallet);
      if (walletAccess.reason === 'chain_unavailable') {
        return NextResponse.json(
          { error: 'Chain temporarily unreachable', reason: 'chain_unavailable' },
          { status: 503 },
        );
      }
      hasAccess = walletAccess.hasAccess;
      denyReason = walletAccess.reason;
    }

    if (!hasAccess) {
      // Anonymous caller with no wallet on gated content (or a verified
      // wallet that still failed the access check) — plain denial.
      return NextResponse.json(
        { error: 'Access denied', reason: denyReason },
        { status: 403 },
      );
    }

    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch (err) {
      console.error(
        '[/api/videos/:id/stream-url] service-role client unavailable:',
        err,
      );
      return NextResponse.json(
        { error: 'Internal server error', reason: 'server_error' },
        { status: 500 },
      );
    }

    const { data, error } = await admin
      .from('videos')
      .select('shelby_url')
      .eq('video_id', videoId)
      .maybeSingle();

    if (error) {
      console.error('[/api/videos/:id/stream-url] lookup failed:', error);
      return NextResponse.json(
        { error: 'Internal server error', reason: 'server_error' },
        { status: 500 },
      );
    }

    const shelbyUrl =
      data && typeof data.shelby_url === 'string' ? data.shelby_url : '';
    if (shelbyUrl.length === 0) {
      return NextResponse.json(
        { error: 'Video not found', reason: 'video_not_found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ shelbyUrl }, { status: 200 });
  } catch (err) {
    console.error('[/api/videos/:id/stream-url] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', reason: 'server_error' },
      { status: 500 },
    );
  }
}
