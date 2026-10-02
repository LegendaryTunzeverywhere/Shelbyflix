import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const VIDEO_ID_REGEX = /^[\w-]+$/;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const videoId = body?.videoId;
    if (typeof videoId !== 'string' || !VIDEO_ID_REGEX.test(videoId)) {
      return NextResponse.json({ error: 'A valid video ID is required' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: video, error: lookupError } = await admin
      .from('videos')
      .select('video_id')
      .eq('video_id', videoId)
      .maybeSingle();

    if (lookupError) {
      console.error('Failed to look up video before incrementing views:', lookupError);
      return NextResponse.json({ error: 'Failed to record video view' }, { status: 500 });
    }
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const { error: incrementError } = await admin.rpc('increment_views', {
      video_id_param: videoId,
    });
    if (incrementError) {
      console.error('Failed to increment video views:', incrementError);
      return NextResponse.json({ error: 'Failed to record video view' }, { status: 500 });
    }

    const { data: updatedVideo, error: readError } = await admin
      .from('videos')
      .select('views')
      .eq('video_id', videoId)
      .single();
    if (readError) {
      console.error('Failed to read updated video view count:', readError);
      return NextResponse.json({ error: 'Failed to read updated video view count' }, { status: 500 });
    }

    return NextResponse.json({ views: updatedVideo.views });
  } catch (error) {
    console.error('POST /api/video-views failed:', error);
    return NextResponse.json({ error: 'Failed to record video view' }, { status: 500 });
  }
}
