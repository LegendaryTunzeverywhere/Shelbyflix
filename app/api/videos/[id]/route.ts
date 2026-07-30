import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const VIDEO_ID_REGEX = /^[\w-]+$/;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: videoId } = await params;
    if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
      return NextResponse.json({ error: 'Invalid video id' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from('videos')
      .delete()
      .eq('video_id', videoId);

    if (error) {
      console.error('[/api/videos/:id] Supabase delete error:', error);
      return NextResponse.json({ error: 'Failed to delete video metadata' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[/api/videos/:id] DELETE error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
