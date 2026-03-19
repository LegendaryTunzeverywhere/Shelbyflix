'use client';

import { useState, useEffect } from 'react';
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
  const { address } = useWallet();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  useEffect(() => { loadComments(); }, [videoId]);

  const loadComments = () => setComments(getVideoComments(videoId));

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !newComment.trim()) return;
    const userName = address.toString().slice(0, 6) + '...' + address.toString().slice(-4);
    addComment(videoId, address.toString(), userName, newComment.trim());
    setNewComment('');
    loadComments();
  };

  const handleReply = (parentCommentId: string) => {
    if (!address || !replyText.trim()) return;
    const userName = address.toString().slice(0, 6) + '...' + address.toString().slice(-4);
    addComment(videoId, address.toString(), userName, replyText.trim(), parentCommentId);
    setReplyText('');
    setReplyingTo(null);
    loadComments();
  };

  const handleDeleteRequest = (commentId: string) => {
    if (!address) return;
    setDeletingCommentId(commentId);
  };

  const handleDeleteConfirm = () => {
    if (!address || !deletingCommentId) return;
    deleteComment(deletingCommentId, address.toString());
    setDeletingCommentId(null);
    loadComments();
  };

  const handleLike = (commentId: string) => {
    likeComment(commentId);
    loadComments();
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
              disabled={!newComment.trim()}
              className="px-6 py-2 bg-brand-red hover:bg-brand-red/90 disabled:bg-zinc-700
                disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm transition-colors"
            >
              Comment
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
        {comments.map((comment) => (
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
        ))}
      </div>

      {comments.length === 0 && (
        <div className="text-center py-12">
          <ChatBubbleLeftIcon className="w-16 h-16 text-zinc-800 mx-auto mb-4" />
          <p className="text-zinc-500 font-medium">No comments yet. Be the first!</p>
        </div>
      )}
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
              <p className="text-white font-bold text-sm">{comment.userName}</p>
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