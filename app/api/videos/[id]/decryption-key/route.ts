import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizeAddress, resolveAccess } from '@/lib/access-control';

// ---------------------------------------------------------------------------
// GET /api/videos/:id/decryption-key?wallet=0x...
//
// SECURITY-CRITICAL: this is the ONLY place the raw AES-256 decryption key
// for a video is allowed to leave the server. Every other read path
// (getVideoById / getAllVideos / etc. in lib/video-service.ts) MUST select
// an explicit column list that excludes `encryption_key` — those run
// through the public anon-key Supabase client and are readable by anyone,
// which previously leaked the key for every video (including purchasable /
// allowlisted / time-locked ones) regardless of whether the caller had
// actually earned access.
//
// This route re-derives the access decision the same way
// GET /api/videos/:id/access does (same `resolveAccess` call, same
// normalized wallet handling) and only reads `encryption_key` — via the
// service-role client, which the anon key cannot reach — once `hasAccess`
// is confirmed true. No caching headers are set, matching the access
// endpoint, so a permission change (allowlist edit, unlock time passing,
// a fresh purchase) is reflected immediately.
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

    const access = await resolveAccess(videoId, wallet);

    if (access.reason === 'chain_unavailable') {
      return NextResponse.json(
        { error: 'Chain temporarily unreachable', reason: 'chain_unavailable' },
        { status: 503 },
      );
    }

    if (!access.hasAccess) {
      return NextResponse.json(
        { error: 'Access denied', reason: access.reason },
        { status: 403 },
      );
    }

    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch (err) {
      console.error(
        '[/api/videos/:id/decryption-key] service-role client unavailable:',
        err,
      );
      return NextResponse.json(
        { error: 'Internal server error', reason: 'server_error' },
        { status: 500 },
      );
    }

    const { data, error } = await admin
      .from('videos')
      .select('encryption_key')
      .eq('video_id', videoId)
      .maybeSingle();

    if (error) {
      console.error('[/api/videos/:id/decryption-key] lookup failed:', error);
      return NextResponse.json(
        { error: 'Internal server error', reason: 'server_error' },
        { status: 500 },
      );
    }

    if (!data || !data.encryption_key) {
      return NextResponse.json(
        { error: 'Video not found', reason: 'video_not_found' },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { encryptionKey: data.encryption_key as string },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/videos/:id/decryption-key] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', reason: 'server_error' },
      { status: 500 },
    );
  }
}
