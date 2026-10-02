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
    const pageSize = 1000;
    const videos: Array<{
      views: number | null;
      likes: number | null;
      is_short: boolean;
      duration: number;
      expiration_timestamp: number;
    }> = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin
        .from('videos')
        .select('views, likes, is_short, duration, expiration_timestamp')
        .eq('uploader_wallet', channelAddress)
        .order('video_id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) {
        console.error('Failed to load channel video analytics:', error);
        return NextResponse.json({ error: 'Failed to load channel analytics' }, { status: 500 });
      }

      videos.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }

    const { count: subscriberCount, error: subscriptionError } = await admin
      .from('subscriptions')
      .select('subscriber_wallet', { count: 'exact', head: true })
      .eq('channel_wallet', channelAddress);
    if (subscriptionError) {
      console.error('Failed to load channel subscriber analytics:', subscriptionError);
      return NextResponse.json({ error: 'Failed to load channel analytics' }, { status: 500 });
    }

    const activeVideos = videos.filter((video) => video.expiration_timestamp > Date.now());
    return NextResponse.json({
      videoCount: activeVideos.length,
      shortCount: activeVideos.filter((video) => video.is_short || video.duration < 60).length,
      totalViews: videos.reduce((total, video) => total + (video.views ?? 0), 0),
      totalLikes: activeVideos.reduce((total, video) => total + (video.likes ?? 0), 0),
      subscriberCount: subscriberCount ?? 0,
    });
  } catch (error) {
    console.error('GET /api/channels/:address/analytics failed:', error);
    return NextResponse.json({ error: 'Failed to load channel analytics' }, { status: 500 });
  }
}
