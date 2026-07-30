import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin.from('videos').insert({
      video_id: body.video_id,
      blob_id: body.blob_id,
      blob_name: body.blob_name,
      uploader_wallet: body.uploader_wallet?.toLowerCase(),
      channel_id: body.channel_id,
      channel_name: body.channel_name,
      title: body.title,
      description: body.description,
      category: body.category,
      tags: body.tags,
      shelby_url: body.shelby_url,
      encryption_key: body.encryption_key,
      thumbnail_url: body.thumbnail_url,
      duration: body.duration,
      is_short: body.is_short,
      video_type: body.video_type ?? 'long',
      upload_timestamp: body.upload_timestamp,
      expiration_timestamp: body.expiration_timestamp,
      availability_period: body.availability_period,
      views: 0,
      likes: 0,
      dislikes: 0,
      comment_count: 0,
      price: body.price || 0,
      access_mode: body.access_mode ?? 'public',
      allowlist: (body.allowlist ?? []).map((value: string) => value.toLowerCase()),
      unlock_at: body.unlock_at ?? null,
    });

    if (error) {
      console.error('[/api/videos] Supabase insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[/api/videos] POST error:', err);
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

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