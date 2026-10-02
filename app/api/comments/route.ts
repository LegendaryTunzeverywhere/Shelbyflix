import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const VIDEO_ID_REGEX = /^[\w-]+$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const videoId = request.nextUrl.searchParams.get('videoId');
  if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
    return NextResponse.json({ error: 'A valid video ID is required' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data: comments, error: commentsError } = await admin
      .from('comments')
      .select('comment_id, video_id, user_wallet, user_name, user_avatar, text, likes, timestamp, parent_comment_id')
      .eq('video_id', videoId)
      .order('timestamp', { ascending: false });

    if (commentsError) {
      console.error('Failed to load video comments:', commentsError);
      return NextResponse.json({ error: 'Failed to load comments' }, { status: 500 });
    }

    const wallets = [...new Set((comments ?? []).map((comment) => comment.user_wallet.toLowerCase()))];
    let avatarByWallet = new Map<string, string>();

    if (wallets.length > 0) {
      const { data: profiles, error: profilesError } = await admin
        .from('users')
        .select('wallet_address, avatar_url')
        .in('wallet_address', wallets);

      if (profilesError) {
        console.error('Failed to load comment author avatars:', profilesError);
        return NextResponse.json({ error: 'Failed to load comment author avatars' }, { status: 500 });
      }

      avatarByWallet = new Map(
        (profiles ?? [])
          .filter((profile) => typeof profile.avatar_url === 'string' && profile.avatar_url.length > 0)
          .map((profile) => [profile.wallet_address.toLowerCase(), profile.avatar_url]),
      );
    }

    return NextResponse.json(
      (comments ?? []).map((comment) => ({
        ...comment,
        user_avatar: avatarByWallet.get(comment.user_wallet.toLowerCase()) ?? comment.user_avatar ?? null,
      })),
    );
  } catch (error) {
    console.error('GET /api/comments failed:', error);
    return NextResponse.json({ error: 'Failed to load comments' }, { status: 500 });
  }
}
