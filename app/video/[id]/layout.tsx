import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';

const fallbackOrigin = 'https://shelbyflix.vercel.app';

function getSiteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const isLocalOrigin = configured?.startsWith('http://localhost') || configured?.startsWith('http://127.0.0.1');
  if ((configured?.startsWith('http://') || configured?.startsWith('https://')) && !(process.env.VERCEL_URL && isLocalOrigin)) {
    return configured.replace(/\/$/, '');
  }

  const deployment = process.env.VERCEL_URL?.trim();
  return deployment ? `https://${deployment}` : fallbackOrigin;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const origin = getSiteOrigin();
  const thumbnailUrl = `${origin}/api/videos/${encodeURIComponent(id)}/thumbnail`;

  const { data } = await supabase
    .from('videos')
    .select('title, description, thumbnail_url, channel_name')
    .eq('video_id', id)
    .maybeSingle();

  const title = data?.title?.trim() || 'Video';
  const description =
    data?.description?.trim() ||
    `Watch ${title} on ShelbyFlix${data?.channel_name ? ` from ${data.channel_name}` : ''}.`;

  return {
    metadataBase: new URL(origin),
    title: `${title} | ShelbyFlix`,
    description,
    openGraph: {
      type: 'video.other',
      url: `${origin}/video/${encodeURIComponent(id)}`,
      title,
      description,
      siteName: 'ShelbyFlix',
      ...(data?.thumbnail_url
        ? { images: [{ url: thumbnailUrl, alt: `${title} thumbnail` }] }
        : {}),
    },
    twitter: {
      card: data?.thumbnail_url ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(data?.thumbnail_url
        ? { images: [thumbnailUrl] }
        : {}),
    },
  };
}

export default function VideoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
