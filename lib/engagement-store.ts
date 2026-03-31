import type { VideoEngagement, Comment, Subscription } from '@/types';
import { supabase } from './supabase';

const ENGAGEMENT_KEY = 'shelbyflix_engagement';
const COMMENTS_KEY = 'shelbyflix_comments';
const SUBSCRIPTIONS_KEY = 'shelbyflix_subscriptions';

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
  userName: string,
  text: string,
  parentCommentId?: string
): Promise<Comment> {
  const commentId = `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const { data, error } = await supabase
    .from('comments')
    .insert({
      comment_id: commentId,
      video_id: videoId,
      user_wallet: userId,
      user_name: userName,
      text,
      likes: 0,
      timestamp: Date.now(),
      parent_comment_id: parentCommentId || null,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Failed to add comment:', error);
    throw error;
  }
  
  return {
    commentId: data.comment_id,
    videoId: data.video_id,
    userId: data.user_wallet,
    userName: data.user_name,
    text: data.text,
    likes: data.likes,
    timestamp: data.timestamp,
    parentCommentId: data.parent_comment_id,
    replies: [],
  };
}

/**
 * Get comments for a video
 */
export async function getVideoComments(videoId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('video_id', videoId)
    .order('timestamp', { ascending: false });
  
  if (error) {
    console.error('Failed to load comments:', error);
    return [];
  }
  
  // Get top-level comments (no parent)
  const topLevel = data
    .filter((c: any) => !c.parent_comment_id)
    .map((c: any) => ({
      commentId: c.comment_id,
      videoId: c.video_id,
      userId: c.user_wallet,
      userName: c.user_name,
      text: c.text,
      likes: c.likes,
      timestamp: c.timestamp,
      parentCommentId: c.parent_comment_id,
      replies: [],
    }));
  
  // Attach replies to each top-level comment
  topLevel.forEach((comment: Comment) => {
    comment.replies = data
      .filter((c: any) => c.parent_comment_id === comment.commentId)
      .map((c: any) => ({
        commentId: c.comment_id,
        videoId: c.video_id,
        userId: c.user_wallet,
        userName: c.user_name,
        text: c.text,
        likes: c.likes,
        timestamp: c.timestamp,
        parentCommentId: c.parent_comment_id,
        replies: [],
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  });
  
  return topLevel;
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId: string, userId: string): Promise<boolean> {
  // First, verify that the user owns this comment
  const { data: comment, error: fetchError } = await supabase
    .from('comments')
    .select('user_wallet')
    .eq('comment_id', commentId)
    .single();
  
  if (fetchError || !comment) {
    console.error('Comment not found:', fetchError);
    return false;
  }
  
  // Only allow user to delete their own comments
  if (comment.user_wallet !== userId) {
    console.error('User does not own this comment');
    return false;
  }
  
  // Delete comment and its replies
  const { error: deleteError } = await supabase
    .from('comments')
    .delete()
    .or(`comment_id.eq.${commentId},parent_comment_id.eq.${commentId}`);
  
  if (deleteError) {
    console.error('Failed to delete comment:', deleteError);
    return false;
  }
  
  return true;
}

/**
 * Like a comment
 */
export async function likeComment(commentId: string): Promise<void> {
  // Get current likes
  const { data: comment, error: fetchError } = await supabase
    .from('comments')
    .select('likes')
    .eq('comment_id', commentId)
    .single();
  
  if (fetchError || !comment) {
    console.error('Comment not found:', fetchError);
    return;
  }
  
  // Increment likes
  const { error: updateError } = await supabase
    .from('comments')
    .update({ likes: comment.likes + 1 })
    .eq('comment_id', commentId);
  
  if (updateError) {
    console.error('Failed to like comment:', updateError);
  }
}

// ============================================================================
// SUBSCRIPTIONS
// ============================================================================

function getSubscriptionsData(): Subscription[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(SUBSCRIPTIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load subscriptions:', error);
    return [];
  }
}

function saveSubscriptionsData(subs: Subscription[]): void {
  localStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify(subs));
}

/**
 * Toggle subscription to a channel
 */
export function toggleSubscription(subscriberId: string, channelId: string): boolean {
  const subs = getSubscriptionsData();
  
  const existingIndex = subs.findIndex(
    s => s.subscriberId === subscriberId && s.channelId === channelId
  );
  
  if (existingIndex >= 0) {
    // Unsubscribe
    subs.splice(existingIndex, 1);
    saveSubscriptionsData(subs);
    return false;
  } else {
    // Subscribe
    subs.push({
      subscriberId,
      channelId,
      timestamp: Date.now(),
    });
    saveSubscriptionsData(subs);
    return true;
  }
}

/**
 * Check if user is subscribed to a channel
 */
export function isSubscribed(subscriberId: string, channelId: string): boolean {
  const subs = getSubscriptionsData();
  return subs.some(s => s.subscriberId === subscriberId && s.channelId === channelId);
}

/**
 * Get subscriber count for a channel
 */
export function getSubscriberCount(channelId: string): number {
  const subs = getSubscriptionsData();
  return subs.filter(s => s.channelId === channelId).length;
}

/**
 * Get channels user is subscribed to
 */
export function getUserSubscriptions(subscriberId: string): string[] {
  const subs = getSubscriptionsData();
  return subs
    .filter(s => s.subscriberId === subscriberId)
    .map(s => s.channelId);
}