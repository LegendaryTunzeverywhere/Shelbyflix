import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const VIDEO_ID_REGEX = /^[\w-]+$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: videoId } = await params;
  if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video id' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('videos')
    .select('thumbnail_url')
    .eq('video_id', videoId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Thumbnail not found' }, { status: 404 });
  }

  const thumbnailUrl = data.thumbnail_url as string | null;
  if (!thumbnailUrl) {
    return NextResponse.json({ error: 'Thumbnail not available' }, { status: 404 });
  }

  if (thumbnailUrl.startsWith('data:')) {
    const match = thumbnailUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: 'Unsupported thumbnail format' }, { status: 400 });
    }

    const contentType = match[1];
    const base64Data = match[2];
    const binaryString =
      typeof atob === 'function'
        ? atob(base64Data)
        : Buffer.from(base64Data, 'base64').toString('binary');
    const buffer = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  if (/^https?:\/\//i.test(thumbnailUrl)) {
    return NextResponse.redirect(thumbnailUrl);
  }

  const origin = request.nextUrl.origin;
  const resolvedUrl = new URL(thumbnailUrl, origin).toString();
  return NextResponse.redirect(resolvedUrl);
}
