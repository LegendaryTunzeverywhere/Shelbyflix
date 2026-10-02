import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizeAddress } from '@/lib/access-control';

const APTOS_ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
): Promise<NextResponse> {
  try {
    const { address } = await params;
    if (!APTOS_ADDRESS_REGEX.test(address)) {
      return NextResponse.json({ error: 'Invalid channel address' }, { status: 400 });
    }

    const channelAddress = normalizeAddress(address);
    const admin = getSupabaseAdmin();
    const [videosResult, subscriptionsResult] = await Promise.all([
      admin
        .from('videos')
        .select('views, likes, is_short, duration')
        .eq('uploader_wallet', channelAddress)
        .gt('expiration_timestamp', Date.now()),
      admin
        .from('subscriptions')
        .select('subscriber_wallet', { count: 'exact', head: true })
        .eq('channel_wallet', channelAddress),
    ]);

    if (videosResult.error) {
      console.error('Failed to load channel video analytics:', videosResult.error);
      return NextResponse.json({ error: 'Failed to load channel analytics' }, { status: 500 });
    }
    if (subscriptionsResult.error) {
      console.error('Failed to load channel subscriber analytics:', subscriptionsResult.error);
      return NextResponse.json({ error: 'Failed to load channel analytics' }, { status: 500 });
    }

    const videos = videosResult.data ?? [];
    return NextResponse.json({
      videoCount: videos.length,
      shortCount: videos.filter((video) => video.is_short || video.duration < 60).length,
      totalViews: videos.reduce((total, video) => total + (video.views ?? 0), 0),
      totalLikes: videos.reduce((total, video) => total + (video.likes ?? 0), 0),
      subscriberCount: subscriptionsResult.count ?? 0,
    });
  } catch (error) {
    console.error('GET /api/channels/:address/analytics failed:', error);
    return NextResponse.json({ error: 'Failed to load channel analytics' }, { status: 500 });
  }
}
