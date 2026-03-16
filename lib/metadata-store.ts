import type { VideoMetadata } from '@/types';

const STORAGE_KEY = 'shelbyflix_videos';

/**
 * Get all videos from storage
 */
export function getAllVideos(): VideoMetadata[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load videos:', error);
    return [];
  }
}

/**
 * Get video by ID
 */
export function getVideoById(videoId: string): VideoMetadata | null {
  const videos = getAllVideos();
  return videos.find(v => v.videoId === videoId) || null;
}

/**
 * Save video metadata
 */
export function saveVideo(metadata: VideoMetadata): void {
  const videos = getAllVideos();
  const existing = videos.findIndex(v => v.videoId === metadata.videoId);
  
  if (existing >= 0) {
    videos[existing] = metadata;
  } else {
    videos.push(metadata);
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
}

/**
 * Delete video
 */
export function deleteVideo(videoId: string): void {
  const videos = getAllVideos().filter(v => v.videoId !== videoId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
}

/**
 * Get videos by category
 */
export function getVideosByCategory(category: string): VideoMetadata[] {
  return getAllVideos().filter(v => v.category === category);
}

/**
 * Get videos by channel
 */
export function getVideosByChannel(channelId: string): VideoMetadata[] {
  return getAllVideos().filter(v => v.channelId === channelId);
}

/**
 * Search videos
 */
export function searchVideos(query: string): VideoMetadata[] {
  const lowerQuery = query.toLowerCase();
  return getAllVideos().filter(v =>
    v.title.toLowerCase().includes(lowerQuery) ||
    v.description.toLowerCase().includes(lowerQuery) ||
    v.tags.some(tag => tag.includes(lowerQuery))
  );
}

/**
 * Get short videos
 */
export function getShortVideos(): VideoMetadata[] {
  return getAllVideos().filter(v => v.isShort);
}

/**
 * Get trending videos (sorted by views)
 */
export function getTrendingVideos(limit: number = 10): VideoMetadata[] {
  return getAllVideos()
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

/**
 * Get recent videos
 */
export function getRecentVideos(limit: number = 10): VideoMetadata[] {
  return getAllVideos()
    .sort((a, b) => b.uploadTimestamp - a.uploadTimestamp)
    .slice(0, limit);
}

/**
 * Increment view count
 */
export function incrementViews(videoId: string): void {
  const videos = getAllVideos();
  const video = videos.find(v => v.videoId === videoId);
  
  if (video) {
    video.views = (video.views || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
  }
}

/**
 * Update engagement (likes/dislikes)
 */
export function updateEngagement(
  videoId: string,
  type: 'like' | 'dislike',
  increment: boolean
): void {
  const videos = getAllVideos();
  const video = videos.find(v => v.videoId === videoId);
  
  if (video) {
    if (type === 'like') {
      video.likes = Math.max(0, (video.likes || 0) + (increment ? 1 : -1));
    } else {
      video.dislikes = Math.max(0, (video.dislikes || 0) + (increment ? 1 : -1));
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
  }
}