export interface ChannelAnalytics {
  videoCount: number;
  shortCount: number;
  totalViews: number;
  totalLikes: number;
  subscriberCount: number;
}

export async function getChannelAnalytics(channelAddress: string): Promise<ChannelAnalytics> {
  const response = await fetch(
    `/api/channels/${encodeURIComponent(channelAddress)}/analytics`,
    { cache: 'no-store' },
  );
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
        ? result.error
        : 'Failed to load channel analytics';
    throw new Error(message);
  }

  if (
    typeof result !== 'object' ||
    result === null ||
    !('videoCount' in result) ||
    !('shortCount' in result) ||
    !('totalViews' in result) ||
    !('totalLikes' in result) ||
    !('subscriberCount' in result) ||
    ![result.videoCount, result.shortCount, result.totalViews, result.totalLikes, result.subscriberCount]
      .every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new Error('The server returned invalid channel analytics');
  }

  return result as ChannelAnalytics;
}
