import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Service role — only used server-side, never exposed to browser
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  // Require a valid wallet address header — basic auth gate
  const walletAddress = req.headers.get('x-wallet-address');
  if (!walletAddress || !/^0x[a-fA-F0-9]{64}$/.test(walletAddress)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('videos')
    // Never return encryption_key through this route
    .select('video_id, title, description, category, tags, thumbnail_url, duration, is_short, upload_timestamp, views, likes, dislikes, comment_count, channel_id, channel_name, uploader_wallet, shelby_url, blob_name, price')
    .order('upload_timestamp', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}