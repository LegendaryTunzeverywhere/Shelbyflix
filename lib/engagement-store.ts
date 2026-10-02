import type { Comment } from '@/types';
import { supabase } from './supabase';
import { postWalletInteraction } from './wallet-interactions';
import { getChannelAnalytics } from './channel-analytics';

const ENGAGEMENT_KEY = 'shelbyflix_engagement';
const COMMENTS_KEY = 'shelbyflix_comments';

interface CommentRecord {
  comment_id: string;
  video_id: string;
  user_wallet: string;
  user_name: string;
  user_avatar: string | null;
  text: string;
  likes: number;
  timestamp: number;
  parent_comment_id: string | null;
}

// ============================================================================
// ENGAGEMENT (Likes/Dislikes)
// ============================================================================

interface EngagementData {
  [videoId: string]: {
    [userId: string]: {
      liked: boolean;
      disliked: boolean;
      timestamp: number;
    };
  };
}

function getEngagementData(): EngagementData {
  if (typeof window === 'undefined') return {};
  
  try {
    const stored = localStorage.getItem(ENGAGEMENT_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Failed to load engagement:', error);
    return {};
  }
}

function saveEngagementData(data: EngagementData): void {
  localStorage.setItem(ENGAGEMENT_KEY, JSON.stringify(data));
}

/**
 * Toggle like on a video
 */
export function toggleLike(videoId: string, userId: string): { liked: boolean; disliked: boolean } {
  const data = getEngagementData();
  
  if (!data[videoId]) {
    data[videoId] = {};
  }
  
  if (!data[videoId][userId]) {
    data[videoId][userId] = { liked: false, disliked: false, timestamp: Date.now() };
  }
  
  const current = data[videoId][userId];
  
  // Toggle like
  current.liked = !current.liked;
  
  // Remove dislike if liked
  if (current.liked) {
    current.disliked = false;
  }
  
  current.timestamp = Date.now();
  
  saveEngagementData(data);
  return { liked: current.liked, disliked: current.disliked };
}

/**
 * Toggle dislike on a video
 */
export function toggleDislike(videoId: string, userId: string): { liked: boolean; disliked: boolean } {
  const data = getEngagementData();
  
  if (!data[videoId]) {
    data[videoId] = {};
  }
  
  if (!data[videoId][userId]) {
    data[videoId][userId] = { liked: false, disliked: false, timestamp: Date.now() };
  }
  
  const current = data[videoId][userId];
  
  // Toggle dislike
  current.disliked = !current.disliked;
  
  // Remove like if disliked
  if (current.disliked) {
    current.liked = false;
  }
  
  current.timestamp = Date.now();
  
  saveEngagementData(data);
  return { liked: current.liked, disliked: current.disliked };
}

/**
 * Get user's engagement status for a video
 */
export function getUserEngagement(videoId: string, userId: string): { liked: boolean; disliked: boolean } {
  const data = getEngagementData();
  
  if (!data[videoId] || !data[videoId][userId]) {
    return { liked: false, disliked: false };
  }
  
  return {
    liked: data[videoId][userId].liked,
    disliked: data[videoId][userId].disliked,
  };
}

/**
 * Get total likes for a video
 */
export function getTotalLikes(videoId: string): number {
  const data = getEngagementData();
  
  if (!data[videoId]) return 0;
  
  return Object.values(data[videoId]).filter(e => e.liked).length;
}

/**
 * Get total dislikes for a video
 */
export function getTotalDislikes(videoId: string): number {
  const data = getEngagementData();
  
  if (!data[videoId]) return 0;
  
  return Object.values(data[videoId]).filter(e => e.disliked).length;
}

// ============================================================================
// COMMENTS
// ============================================================================

/**
 * Add a comment to a video
 */
export async function addComment(
  videoId: string,
  userId: string,
  text: string,
  parentCommentId: string | undefined,
  signMessage: (args: { message: string; nonce: string }) => Promise<any>,
  publicKey: unknown,
): Promise<Comment> {
  const data = await postWalletInteraction<{
    comment_id: string;
    video_id: string;
    user_wallet: string;
    user_name: string;
    text: string;
    likes: number;
    timestamp: number;
    parent_comment_id: string | null;
  }>(
    userId, publicKey, signMessage, 'comment',
    { videoId, text, parentCommentId: parentCommentId ?? null },
  );
  
  return {
    commentId: data.comment_id,
    videoId: data.video_id,
    userId: data.user_wallet,
    userName: data.user_name,
    text: data.text,
    likes: data.likes,
    timestamp: data.timestamp,
    parentCommentId: data.parent_comment_id ?? undefined,
    replies: [],
  };
}

/**
 * Get comments for a video
 */
export async function getVideoComments(videoId: string): Promise<Comment[]> {
  const response = await fetch(`/api/comments?videoId=${encodeURIComponent(videoId)}`, {
    cache: 'no-store',
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Failed to load comments';
    throw new Error(message);
  }
  if (!Array.isArray(body)) throw new Error('Invalid comments response');
  const data = body as CommentRecord[];
  
  // Get top-level comments (no parent)
  const topLevel = data
    .filter((c) => !c.parent_comment_id)
    .map((c) => ({
      commentId: c.comment_id,
      videoId: c.video_id,
      userId: c.user_wallet,
      userName: c.user_name,
      userAvatar: c.user_avatar ?? undefined,
      text: c.text,
      likes: c.likes,
      timestamp: c.timestamp,
      parentCommentId: c.parent_comment_id ?? undefined,
      replies: [],
    }));
  
  // Attach replies to each top-level comment
  topLevel.forEach((comment: Comment) => {
    comment.replies = data
      .filter((c) => c.parent_comment_id === comment.commentId)
      .map((c) => ({
        commentId: c.comment_id,
        videoId: c.video_id,
        userId: c.user_wallet,
        userName: c.user_name,
        userAvatar: c.user_avatar ?? undefined,
        text: c.text,
        likes: c.likes,
        timestamp: c.timestamp,
        parentCommentId: c.parent_comment_id ?? undefined,
        replies: [],
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  });
  
  return topLevel;
}

/**
 * Delete a comment
 */
export async function deleteComment(
  commentId: string,
  userId: string,
  signMessage: (args: { message: string; nonce: string }) => Promise<any>,
  publicKey: unknown,
): Promise<boolean> {
  await postWalletInteraction(userId, publicKey, signMessage, 'comment-delete', { commentId });
  return true;
}

/**
 * Like a comment
 */
export async function likeComment(
  commentId: string,
  userId: string,
  signMessage: (args: { message: string; nonce: string }) => Promise<any>,
  publicKey: unknown,
): Promise<void> {
  await postWalletInteraction(userId, publicKey, signMessage, 'comment-like', { commentId });
}

// ============================================================================
// SUBSCRIPTIONS
// ============================================================================

/**
 * Toggle subscription to a channel
 */
export async function toggleSubscription(
  subscriberId: string,
  channelId: string,
  signMessage: (args: { message: string; nonce: string }) => Promise<any>,
  publicKey: unknown,
): Promise<boolean> {
  const normalizedSub = subscriberId.toLowerCase();
  const normalizedChannel = channelId.toLowerCase();
  const result = await postWalletInteraction<{ subscribed: boolean }>(
    normalizedSub, publicKey, signMessage, 'subscription', { channelId: normalizedChannel },
  );
  return result.subscribed;
}

/**
 * Check if user is subscribed to a channel
 */
export async function isSubscribed(
  subscriberId: string,
  channelId: string,
  signMessage: (args: { message: string; nonce: string }) => Promise<any>,
  publicKey: unknown,
): Promise<boolean> {
  const normalizedSub = subscriberId.toLowerCase();
  const normalizedChannel = channelId.toLowerCase();
  const result = await postWalletInteraction<{ subscribed: boolean }>(
    normalizedSub,
    publicKey,
    signMessage,
    'subscription-status',
    { channelId: normalizedChannel },
  );
  return result.subscribed;
}

/**
 * Get subscriber count for a channel
 */
export async function getSubscriberCount(channelId: string): Promise<number> {
  try {
    const analytics = await getChannelAnalytics(channelId);
    return analytics.subscriberCount;
  } catch (error) {
    console.error('Failed to get subscriber count:', error);
    return 0;
  }
}

/**
 * Get channels user is subscribed to
 */
export async function getUserSubscriptions(subscriberId: string): Promise<string[]> {
  const normalizedSub = subscriberId.toLowerCase();
  
  const { data, error } = await supabase
    .from('subscriptions')
    .select('channel_wallet')
    .eq('subscriber_wallet', normalizedSub);
  
  if (error) {
    console.error('Failed to get user subscriptions:', error);
    return [];
  }
  
  return (data ?? []).map((sub: any) => sub.channel_wallet);
}