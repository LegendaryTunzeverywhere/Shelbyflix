import type { VideoEngagement, Comment, Subscription } from '@/types';

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

function getCommentsData(): Comment[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(COMMENTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load comments:', error);
    return [];
  }
}

function saveCommentsData(comments: Comment[]): void {
  localStorage.setItem(COMMENTS_KEY, JSON.stringify(comments));
}

/**
 * Add a comment to a video
 */
export function addComment(
  videoId: string,
  userId: string,
  userName: string,
  text: string,
  parentCommentId?: string
): Comment {
  const comments = getCommentsData();
  
  const comment: Comment = {
    commentId: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    videoId,
    userId,
    userName,
    text,
    likes: 0,
    timestamp: Date.now(),
    parentCommentId,
    replies: [],
  };
  
  comments.push(comment);
  saveCommentsData(comments);
  
  return comment;
}

/**
 * Get comments for a video
 */
export function getVideoComments(videoId: string): Comment[] {
  const allComments = getCommentsData();
  
  // Get top-level comments (no parent)
  const topLevel = allComments
    .filter(c => c.videoId === videoId && !c.parentCommentId)
    .sort((a, b) => b.timestamp - a.timestamp);
  
  // Attach replies to each top-level comment
  topLevel.forEach(comment => {
    comment.replies = allComments
      .filter(c => c.parentCommentId === comment.commentId)
      .sort((a, b) => a.timestamp - b.timestamp);
  });
  
  return topLevel;
}

/**
 * Delete a comment
 */
export function deleteComment(commentId: string, userId: string): boolean {
  const comments = getCommentsData();
  const commentIndex = comments.findIndex(c => c.commentId === commentId);
  
  if (commentIndex === -1) return false;
  
  const comment = comments[commentIndex];
  
  // Only allow user to delete their own comments
  if (comment.userId !== userId) return false;
  
  // Delete comment and its replies
  const filtered = comments.filter(
    c => c.commentId !== commentId && c.parentCommentId !== commentId
  );
  
  saveCommentsData(filtered);
  return true;
}

/**
 * Like a comment
 */
export function likeComment(commentId: string): void {
  const comments = getCommentsData();
  const comment = comments.find(c => c.commentId === commentId);
  
  if (comment) {
    comment.likes = (comment.likes || 0) + 1;
    saveCommentsData(comments);
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