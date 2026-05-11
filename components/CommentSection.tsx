'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useWallet } from '@/hooks/useWallet';
import {
  addComment,
  getVideoComments,
  deleteComment,
  likeComment,
} from '@/lib/engagement-store';
import type { Comment } from '@/types';
import {
  ChatBubbleLeftIcon,
  HandThumbUpIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { HandThumbUpIcon as HandThumbUpIconSolid } from '@heroicons/react/24/solid';
import { formatDistanceToNow } from 'date-fns';

// ── Delete confirmation modal ─────────────────────────────────────────────────
function DeleteCommentModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl animate-in">
        {/* Close */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors"
        >
          <XMarkIcon className="w-4 h-4 text-zinc-400" />
        </button>

        {/* Icon */}
        <div className="w-14 h-14 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <ExclamationTriangleIcon className="w-7 h-7 text-red-500" />
        </div>

        {/* Text */}
        <h3 className="text-white font-black text-lg text-center tracking-tight mb-2">
          Delete Comment?
        </h3>
        <p className="text-zinc-400 text-sm text-center mb-6 leading-relaxed">
          This comment will be permanently removed and cannot be recovered.
        </p>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-black text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-black text-sm transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface CommentSectionProps {
  videoId: string;
}

export default function CommentSection({ videoId }: CommentSectionProps) {
  const { address, user } = useWallet();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadComments(); }, [videoId]);

  const loadComments = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loadedComments = await getVideoComments(videoId);
      setComments(loadedComments);
    } catch (error) {
      console.error('Failed to load comments:', error);
      setLoadError('Could not load comments. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !user || !newComment.trim()) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await addComment(videoId, address.toString(), user.username, newComment.trim());
      setNewComment('');
      await loadComments();
    } catch (error) {
      console.error('Failed to add comment:', error);
      setActionError('Could not post your comment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (parentCommentId: string) => {
    if (!address || !user || !replyText.trim()) return;
    setActionError(null);
    try {
      await addComment(videoId, address.toString(), user.username, replyText.trim(), parentCommentId);
      setReplyText('');
      setReplyingTo(null);
      await loadComments();
    } catch (error) {
      console.error('Failed to add reply:', error);
      setActionError('Could not post your reply. Please try again.');
    }
  };

  const handleDeleteRequest = (commentId: string) => {
    if (!address) return;
    setDeletingCommentId(commentId);
  };

  const handleDeleteConfirm = async () => {
    if (!address || !deletingCommentId) return;
    setActionError(null);
    try {
      await deleteComment(deletingCommentId, address.toString());
      setDeletingCommentId(null);
      await loadComments();
    } catch (error) {
      console.error('Failed to delete comment:', error);
      setActionError('Could not delete comment. Please try again.');
      setDeletingCommentId(null);
    }
  };

  const handleLike = async (commentId: string) => {
    setActionError(null);
    try {
      await likeComment(commentId);
      await loadComments();
    } catch (error) {
      console.error('Failed to like comment:', error);
      setActionError('Could not register your like. Please try again.');
    }
  };

  const totalComments = comments.reduce((t, c) => t + 1 + (c.replies?.length || 0), 0);

  return (
    <div className="space-y-6">
      {/* Delete modal */}
      {deletingCommentId && (
        <DeleteCommentModal
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingCommentId(null)}
        />
      )}

      {/* Header */}
      <h3 className="text-xl font-black text-white tracking-tighter flex items-center gap-2">
        <ChatBubbleLeftIcon className="w-5 h-5 text-brand-red" />
        {totalComments} COMMENTS
      </h3>

      {/* Action error banner */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl"
        >
          <ExclamationTriangleIcon className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-300 flex-1">{actionError}</p>
          <button
            onClick={() => setActionError(null)}
            className="text-red-400 hover:text-red-300"
            aria-label="Dismiss error"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Add comment */}
      {address ? (
        <form onSubmit={handleAddComment} className="space-y-3">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            rows={3}
            className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-2xl text-white
              placeholder-zinc-600 focus:ring-2 focus:ring-brand-red focus:border-transparent resize-none"
          />
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setNewComment('')}
              className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newComment.trim() || submitting}
              className="px-6 py-2 bg-brand-red hover:bg-brand-red/90 disabled:bg-zinc-700
                disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm transition-colors"
            >
              {submitting ? 'Posting...' : 'Submit'}
            </button>
          </div>
        </form>
      ) : (
        <div className="p-6 bg-zinc-900/30 border border-zinc-800 rounded-2xl text-center">
          <p className="text-zinc-500 font-medium">Connect your wallet to comment</p>
        </div>
      )}

      {/* Comments list */}
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-live="polite">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 animate-pulse"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 bg-zinc-800 rounded" />
                    <div className="h-2 w-16 bg-zinc-800 rounded" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full bg-zinc-800 rounded" />
                  <div className="h-3 w-3/4 bg-zinc-800 rounded" />
                </div>
              </div>
            ))}
            <p className="sr-only">Loading comments...</p>
          </div>
        ) : loadError ? (
          <div className="text-center py-12 bg-zinc-900/30 border border-zinc-800 rounded-2xl">
            <ExclamationTriangleIcon className="w-12 h-12 text-red-500/70 mx-auto mb-3" />
            <p className="text-zinc-400 text-sm mb-4">{loadError}</p>
            <button
              onClick={loadComments}
              className="px-5 py-2 bg-brand-red hover:bg-brand-red/90 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-colors"
            >
              Retry
            </button>
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center py-12">
            <ChatBubbleLeftIcon className="w-16 h-16 text-zinc-800 mx-auto mb-4" />
            <p className="text-zinc-500 font-medium">No comments yet. Be the first!</p>
          </div>
        ) : (
          comments.map((comment) => (
            <CommentItem
              key={comment.commentId}
              comment={comment}
              onReply={(id) => setReplyingTo(id)}
              onDelete={handleDeleteRequest}
              onLike={handleLike}
              replyingTo={replyingTo}
              replyText={replyText}
              setReplyText={setReplyText}
              handleReply={handleReply}
              currentUserId={address?.toString()}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Comment item ──────────────────────────────────────────────────────────────
interface CommentItemProps {
  comment: Comment;
  onReply: (id: string) => void;
  onDelete: (id: string) => void;
  onLike: (id: string) => void;
  replyingTo: string | null;
  replyText: string;
  setReplyText: (text: string) => void;
  handleReply: (parentId: string) => void;
  currentUserId: string | null | undefined;
  isReply?: boolean;
}

function CommentItem({
  comment,
  onReply,
  onDelete,
  onLike,
  replyingTo,
  replyText,
  setReplyText,
  handleReply,
  currentUserId,
  isReply = false,
}: CommentItemProps) {
  const [liked, setLiked] = useState(false);

  return (
    <div className={isReply ? 'ml-12' : ''}>
      <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-brand-purple to-brand-red rounded-full
              flex items-center justify-center text-white font-black text-xs flex-shrink-0">
              {comment.userName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <Link
                href={`/channel/${comment.userId}`}
                className="text-white font-bold text-sm hover:text-brand-red transition-colors"
              >
                {comment.userName}
              </Link>
              <p className="text-zinc-500 text-xs">
                {formatDistanceToNow(comment.timestamp, { addSuffix: true })}
              </p>
            </div>
          </div>

          {currentUserId === comment.userId && (
            <button
              onClick={() => onDelete(comment.commentId)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-600
                hover:text-red-500 hover:bg-red-500/10 transition-colors"
              title="Delete comment"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Text */}
        <p className="text-white mb-3 leading-relaxed text-sm">{comment.text}</p>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => { onLike(comment.commentId); setLiked(!liked); }}
            className="flex items-center gap-1 text-zinc-500 hover:text-brand-red transition-colors"
          >
            {liked
              ? <HandThumbUpIconSolid className="w-4 h-4 text-brand-red" />
              : <HandThumbUpIcon className="w-4 h-4" />
            }
            <span className="text-xs font-bold">{comment.likes || 0}</span>
          </button>

          {!isReply && currentUserId && (
            <button
              onClick={() => onReply(comment.commentId)}
              className="flex items-center gap-1 text-zinc-500 hover:text-white transition-colors"
            >
              <ArrowUturnLeftIcon className="w-4 h-4" />
              <span className="text-xs font-bold">Reply</span>
            </button>
          )}
        </div>
      </div>

      {/* Reply form */}
      {replyingTo === comment.commentId && (
        <div className="ml-12 mt-3 space-y-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            rows={2}
            className="w-full px-4 py-2 bg-zinc-900/50 border border-zinc-800 rounded-xl text-white
              placeholder-zinc-600 focus:ring-2 focus:ring-brand-red focus:border-transparent resize-none text-sm"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => onReply('')}
              className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-bold text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => handleReply(comment.commentId)}
              disabled={!replyText.trim()}
              className="px-4 py-1.5 bg-brand-red hover:bg-brand-red/90 disabled:bg-zinc-700
                text-white rounded-lg font-bold text-xs transition-colors"
            >
              Reply
            </button>
          </div>
        </div>
      )}

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.commentId}
              comment={reply}
              onReply={onReply}
              onDelete={onDelete}
              onLike={onLike}
              replyingTo={replyingTo}
              replyText={replyText}
              setReplyText={setReplyText}
              handleReply={handleReply}
              currentUserId={currentUserId}
              isReply={true}
            />
          ))}
        </div>
      )}
    </div>
  );
}