import { getVideoById } from '@/lib/video-service';

interface HeadProps {
  params: {
    id: string;
  };
}

export default async function Head({ params }: HeadProps) {
  const video = await getVideoById(params.id);
  const title = video?.title ? `${video.title} | ShelbyFlix` : 'ShelbyFlix Video';
  const description = video?.description || 'Watch decentralized content on ShelbyFlix.';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://shelbyflix.shelby.xyz';
  const image = video?.thumbnailUrl
    ? `${appUrl}/api/videos/${params.id}/thumbnail`
    : `${appUrl}/favicon-32x32.png`;
  const url = `${appUrl}/video/${params.id}`;

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content="video.other" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={video?.title || 'ShelbyFlix video thumbnail'} />
    </>
  );
}
