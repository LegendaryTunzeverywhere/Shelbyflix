import { supabase, type VideoRecord } from './supabase';
import type { VideoMetadata } from '@/types';
import { csrfFetch } from './csrf-client';

export async function saveVideo(metadata: VideoMetadata): Promise<void> {
  const response = await csrfFetch('/api/videos', {
    method: 'POST',
    body: JSON.stringify({
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
      video_type: metadata.videoType ?? 'long',
      upload_timestamp: metadata.uploadTimestamp,
      expiration_timestamp: metadata.expirationTimestamp,
      availability_period: metadata.availabilityPeriod,
      views: 0,
      likes: 0,
      dislikes: 0,
      comment_count: 0,
      price: metadata.price || 0,
      access_mode: metadata.accessMode ?? 'public',
      allowlist: (metadata.allowlist ?? []).map((a) => a.toLowerCase()),
      unlock_at: metadata.unlockAt ?? null,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to save video metadata');
  }
}

export async function getAllVideos(): Promise<VideoMetadata[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .gt('expiration_timestamp', Date.now())  // Filter expired videos
    .order('upload_timestamp', { ascending: false });
  if (error) throw error;
  return data.map(recordToMetadata);
}

export async function getVideoById(videoId: string): Promise<VideoMetadata | null> {
  // Sanitise — video IDs are alphanumeric + underscores only
  if (!/^[\w-]+$/.test(videoId)) return null;
  const { data, error } = await supabase
    .from('videos').select('*').eq('video_id', videoId).single();
  if (error) return null;
  return recordToMetadata(data);
}

export async function getVideosByCategory(category: string): Promise<VideoMetadata[]> {
  const { data, error } = await supabase
    .from('videos').select('*').eq('category', category)
    .gt('expiration_timestamp', Date.now())  // Filter expired videos
    .order('upload_timestamp', { ascending: false });
  if (error) throw error;
  return data.map(recordToMetadata);
}

export async function getShortVideos(): Promise<VideoMetadata[]> {
  const { data, error } = await supabase
    .from('videos').select('*')
    .or('is_short.eq.true,video_type.eq.short,duration.lt.60')
    .gt('expiration_timestamp', Date.now())  // Filter expired videos
    .order('upload_timestamp', { ascending: false });
  if (error) throw error;
  return data.map(recordToMetadata);
}

export async function getVideosByUploader(uploaderWallet: string): Promise<VideoMetadata[]> {
  const { data, error } = await supabase
    .from('videos').select('*')
    .eq('uploader_wallet', uploaderWallet.toLowerCase())
    .gt('expiration_timestamp', Date.now())  // Filter expired videos
    .order('upload_timestamp', { ascending: false });
  if (error) throw error;
  return data.map(recordToMetadata);
}

export async function searchVideos(query: string): Promise<VideoMetadata[]> {
  // Sanitise: escape SQL LIKE wildcards, cap length, strip control chars
  const sanitised = query
    .replace(/[%_\\]/g, '\\$&')
    .replace(/[^\w\s\-.,!?]/g, '')
    .slice(0, 100)
    .trim();

  if (!sanitised) return [];

  const { data, error } = await supabase
    .from('videos').select('*')
    .or(`title.ilike.%${sanitised}%,description.ilike.%${sanitised}%`)
    .gt('expiration_timestamp', Date.now())  // Filter expired videos
    .order('upload_timestamp', { ascending: false });
  if (error) throw error;
  return data.map(recordToMetadata);
}

export async function getTrendingVideos(limit: number = 10): Promise<VideoMetadata[]> {
  const safeLimit = Math.min(Math.max(1, limit), 50);
  const { data, error } = await supabase
    .from('videos').select('*')
    .gt('expiration_timestamp', Date.now())  // Filter expired videos
    .order('views', { ascending: false }).limit(safeLimit);
  if (error) throw error;
  return data.map(recordToMetadata);
}

export async function getRecentVideos(limit: number = 10): Promise<VideoMetadata[]> {
  const safeLimit = Math.min(Math.max(1, limit), 50);
  const { data, error } = await supabase
    .from('videos').select('*')
    .gt('expiration_timestamp', Date.now())  // Filter expired videos
    .order('upload_timestamp', { ascending: false }).limit(safeLimit);
  if (error) throw error;
  return data.map(recordToMetadata);
}

// Per-user view deduplication — one view per wallet per video, stored in video_engagement
export async function incrementViews(videoId: string, walletAddress?: string): Promise<void> {
  if (walletAddress) {
    // Check if this wallet already viewed this video
    const { data: existing } = await supabase
      .from('video_engagement')
      .select('viewed')
      .eq('video_id', videoId)
      .eq('user_wallet', walletAddress)
      .maybeSingle();

    if (existing?.viewed) return; // Already counted — do nothing

    // Mark as viewed
    await supabase.from('video_engagement').upsert(
      {
        video_id: videoId,
        user_wallet: walletAddress,
        viewed: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'video_id,user_wallet' }
    );
  }

  // Increment the counter
  const { error } = await supabase.rpc('increment_views', { video_id_param: videoId });
  if (error) {
    // Fallback if RPC doesn't exist
    const { data } = await supabase.from('videos').select('views').eq('video_id', videoId).single();
    if (data) {
      await supabase.from('videos').update({ views: (data.views || 0) + 1 }).eq('video_id', videoId);
    }
  }
}

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
    videoType: (record as any).video_type ?? 'long',
    uploader: record.uploader_wallet,
    timestamp: record.upload_timestamp,
    price: record.price,
    // Access control — the migration backfills existing rows to 'public' / []
    // / NULL, so these reads rely on the column's defaults rather than the
    // previous `(record as any)` casts. Req 2.3 / 10.3.
    accessMode: record.access_mode ?? 'public',
    allowlist: record.allowlist ?? [],
    unlockAt: record.unlock_at ?? undefined,
  };
}

export async function deleteVideo(
  videoId: string,
  blobName: string,
  signAndSubmitTransaction: any,
  shelbyUrl?: string
): Promise<void> {
  if (!/^[\w-]+$/.test(videoId)) throw new Error('Invalid video ID');

  let resolvedShelbyUrl = shelbyUrl;
  if (!resolvedShelbyUrl) {
    const video = await getVideoById(videoId);
    resolvedShelbyUrl = video?.shelbyUrl ?? '';
  }

  const { error } = await supabase.from('videos').delete().eq('video_id', videoId);
  if (error) throw error;

  try {
    const { deleteFromShelby } = await import('./shelby');
    await deleteFromShelby(videoId, resolvedShelbyUrl, blobName, signAndSubmitTransaction);
  } catch (e) {
    console.warn('Shelbynet cleanup failed (non-fatal):', e);
  }
}

// ---------------------------------------------------------------------------
// EXPIRATION MANAGEMENT
// ---------------------------------------------------------------------------

/**
 * Get all expired videos (used by cleanup job)
 * This is NOT filtered - used by admin/cleanup endpoints only
 */
export async function getExpiredVideos(): Promise<VideoMetadata[]> {
  const now = Date.now();
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .lt('expiration_timestamp', now);
  if (error) throw error;
  return data.map(recordToMetadata);
}

/**
 * Get uploader's videos including expired (for dashboard/management)
 * Filter parameter lets uploader see their own expired content
 */
export async function getUploaderAllVideos(uploaderWallet: string, includeExpired = true): Promise<VideoMetadata[]> {
  let query = supabase
    .from('videos')
    .select('*')
    .eq('uploader_wallet', uploaderWallet.toLowerCase());

  if (!includeExpired) {
    query = query.gt('expiration_timestamp', Date.now());
  }

  const { data, error } = await query.order('upload_timestamp', { ascending: false });
  if (error) throw error;
  return data.map(recordToMetadata);
}

/**
 * Mark a video as unavailable (when Shelby storage returns 404)
 */
export async function markVideoUnavailable(videoId: string): Promise<void> {
  if (!/^[\w-]+$/.test(videoId)) throw new Error('Invalid video ID');

  // Set expiration to now so it appears as expired
  const { error } = await supabase
    .from('videos')
    .update({ expiration_timestamp: Date.now() - 1 })
    .eq('video_id', videoId);

  if (error) throw error;
}

/**
 * Delete multiple expired videos (cleanup job)
 * Called by admin endpoints or scheduled tasks
 */
export async function deleteExpiredVideos(): Promise<{ deletedCount: number; errors: string[] }> {
  try {
    const expiredVideos = await getExpiredVideos();

    if (expiredVideos.length === 0) {
      return { deletedCount: 0, errors: [] };
    }

    const errors: string[] = [];
    let deletedCount = 0;

    for (const video of expiredVideos) {
      try {
        const { error } = await supabase
          .from('videos')
          .delete()
          .eq('video_id', video.videoId);

        if (error) {
          errors.push(`Failed to delete ${video.videoId}: ${error.message}`);
        } else {
          deletedCount++;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Exception deleting ${video.videoId}: ${errorMsg}`);
      }
    }

    return { deletedCount, errors };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Cleanup job failed: ${errorMsg}`);
  }
}

/**
 * Check video expiration status
 */
export function getTimeUntilExpiration(expirationTimestamp: number): {
  expired: boolean;
  hoursRemaining: number;
  daysRemaining: number;
  formattedTime: string;
} {
  const now = Date.now();
  const millisecondsRemaining = expirationTimestamp - now;

  if (millisecondsRemaining <= 0) {
    return {
      expired: true,
      hoursRemaining: 0,
      daysRemaining: 0,
      formattedTime: 'Expired',
    };
  }

  const secondsRemaining = Math.floor(millisecondsRemaining / 1000);
  const minutesRemaining = Math.floor(secondsRemaining / 60);
  const hoursRemaining = Math.floor(minutesRemaining / 60);
  const daysRemaining = Math.floor(hoursRemaining / 24);

  let formattedTime = '';
  if (daysRemaining > 0) {
    formattedTime = `${daysRemaining}d remaining`;
  } else if (hoursRemaining > 0) {
    formattedTime = `${hoursRemaining}h remaining`;
  } else if (minutesRemaining > 0) {
    formattedTime = `${minutesRemaining}m remaining`;
  } else {
    formattedTime = `${secondsRemaining}s remaining`;
  }

  return {
    expired: false,
    hoursRemaining,
    daysRemaining,
    formattedTime,
  };
}

