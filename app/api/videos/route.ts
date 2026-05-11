import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// ---------------------------------------------------------------------------
// SECURITY NOTE — Why we removed the x-wallet-address header check:
//
// A plain "x-wallet-address: 0x..." header is trivially forgeable by anyone
// with curl. It provides zero actual authentication. Real auth requires the
// client to prove ownership of the address by signing a challenge nonce
// (see /api/auth/challenge and /api/auth/check-access).
//
// For a public listing endpoint (no per-user gating), no auth header is
// needed — just rate-limiting (handled in middleware.ts).
//
// If you want per-user gating in the future, verify a session token or
// a signed nonce here instead.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/videos  — public video listing
// Never returns encryption_key or other sensitive columns.
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('videos')
    .select(
      // Explicitly enumerate columns — never use select('*') on this route
      // to ensure encryption_key is never accidentally returned.
      `video_id,
       title,
       description,
       category,
       tags,
       thumbnail_url,
       duration,
       is_short,
       video_type,
       upload_timestamp,
       expiration_timestamp,
       views,
       likes,
       dislikes,
       comment_count,
       channel_id,
       channel_name,
       uploader_wallet,
       shelby_url,
       blob_name,
       price`
    )
    .order('upload_timestamp', { ascending: false });

  if (error) {
    console.error('[/api/videos] Supabase error in GET /api/videos:', JSON.stringify({ code: error.code, message: error.message }));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json(data);
}