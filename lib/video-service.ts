import { supabase, type VideoRecord } from './supabase';
import type { VideoMetadata } from '@/types';

/**
 * Save video to database
 */
export async function saveVideo(metadata: VideoMetadata): Promise<void> {
  const { error } = await supabase
    .from('videos')
    .insert({
      video_id: metadata.videoId,
      blob_id: metadata.blobId,
      blob_name: metadata.blobName,
      uploader_wallet: metadata.uploader.toLowerCase(),
      channel_id: metadata.channelId,
      channel_name: metadata.channelName,
      title: metadata.title,
      description: metadata.description,
      category: metadata.category,
      tags: metadata.tags,
      shelby_url: metadata.shelbyUrl,
      encryption_key: metadata.encryptionKey,
      thumbnail_url: metadata.thumbnailUrl,
      duration: metadata.duration,
      is_short: metadata.isShort,
      upload_timestamp: metadata.uploadTimestamp,
      expiration_timestamp: metadata.expirationTimestamp,
      availability_period: metadata.availabilityPeriod,
      views: 0,
      likes: 0,
      dislikes: 0,
      comment_count: 0,
      price: metadata.price || 0,
    });
  
  if (error) throw error;
}

/**
 * Get all videos
 */
export async function getAllVideos(): Promise<VideoMetadata[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .order('upload_timestamp', { ascending: false });
  
  if (error) throw error;
  return data.map(recordToMetadata);
}

/**
 * Get video by ID
 */
export async function getVideoById(videoId: string): Promise<VideoMetadata | null> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('video_id', videoId)
    .single();
  
  if (error) return null;
  return recordToMetadata(data);
}

/**
 * Get videos by category
 */
export async function getVideosByCategory(category: string): Promise<VideoMetadata[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('category', category)
    .order('upload_timestamp', { ascending: false });
  
  if (error) throw error;
  return data.map(recordToMetadata);
}

/**
 * Search videos
 */
export async function searchVideos(query: string): Promise<VideoMetadata[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .order('upload_timestamp', { ascending: false });
  
  if (error) throw error;
  return data.map(recordToMetadata);
}

/**
 * Get trending videos
 */
export async function getTrendingVideos(limit: number = 10): Promise<VideoMetadata[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .order('views', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  return data.map(recordToMetadata);
}

/**
 * Get recent videos
 */
export async function getRecentVideos(limit: number = 10): Promise<VideoMetadata[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .order('upload_timestamp', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  return data.map(recordToMetadata);
}

/**
 * Increment view count
 */
export async function incrementViews(videoId: string): Promise<void> {
  const { error } = await supabase.rpc('increment_views', { video_id_param: videoId });
  
  if (error) {
    // Fallback: manual increment
    const { data } = await supabase
      .from('videos')
      .select('views')
      .eq('video_id', videoId)
      .single();
    
    if (data) {
      await supabase
        .from('videos')
        .update({ views: (data.views || 0) + 1 })
        .eq('video_id', videoId);
    }
  }
}

/**
 * Helper: Convert database record to VideoMetadata
 */
function recordToMetadata(record: VideoRecord): VideoMetadata {
  return {
    videoId: record.video_id,
    blobId: record.blob_id,
    blobName: record.blob_name,
    channelId: record.channel_id,
    channelName: record.channel_name,
    title: record.title,
    description: record.description ?? '',
    category: record.category as any,
    tags: record.tags,
    shelbyUrl: record.shelby_url,
    encryptionKey: record.encryption_key,
    thumbnailUrl: record.thumbnail_url,
    duration: record.duration,
    uploadTimestamp: record.upload_timestamp,
    expirationTimestamp: record.expiration_timestamp,
    availabilityPeriod: record.availability_period,
    views: record.views,
    likes: record.likes,
    dislikes: record.dislikes,
    commentCount: record.comment_count,
    isShort: record.is_short,
    uploader: record.uploader_wallet,
    timestamp: record.upload_timestamp,
    price: record.price,
  };
}