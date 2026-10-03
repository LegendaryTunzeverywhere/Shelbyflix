'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShortsCommentsSheetProps {
  videoId: string;
  onClose: () => void;
  /** Report the live comment total so the Shorts badge can show it. */
  onCountChange?: (count: number) => void;
}

interface CommentRowProps {
  comment: Comment;
  isReply?: boolean;
  currentUserId: string | null | undefined;
  likedIds: ReadonlySet<string>;
  replyingTo: string | null;
  replyDraft: string;
  setReplyDraft: (text: string) => void;
  confirmingDeleteId: string | null;
  onReply: (commentId: string) => void;
  onCancelReply: () => void;
  onLike: (commentId: string) => void;
  onRequestDelete: (commentId: string) => void;
  onCancelDelete: () => void;
  onDelete: (commentId: string) => void;
  onReplySubmit: (parentId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countAll(comments: Comment[]): number {
  return comments.reduce((total, comment) => total + 1 + (comment.replies?.length ?? 0), 0);
}

function mapTree(
  comments: Comment[],
  commentId: string,
  fn: (comment: Comment) => Comment,
): Comment[] {
  return comments.map((comment) => {
    if (comment.commentId === commentId) return fn(comment);
    if (comment.replies && comment.replies.length > 0) {
      return {
        ...comment,
        replies: comment.replies.map((reply) =>
          reply.commentId === commentId ? fn(reply) : reply,
        ),
      };
    }
    return comment;
  });
}

function Avatar({ comment }: { comment: Comment }) {
  const [failed, setFailed] = useState(false);

  if (comment.userAvatar && !failed) {
    return (
      <img
        src={comment.userAvatar}
        alt=""
        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className="w-8 h-8 bg-gradient-to-br from-brand-purple to-brand-red rounded-full
        flex items-center justify-center text-white font-black text-[10px] flex-shrink-0"
    >
      {comment.userName.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single comment row (with nested replies)
// ---------------------------------------------------------------------------

function CommentRow({
  comment,
  isReply = false,
  currentUserId,
  likedIds,
  replyingTo,
  replyDraft,
  setReplyDraft,
  confirmingDeleteId,
  onReply,
  onCancelReply,
  onLike,
  onRequestDelete,
  onCancelDelete,
  onDelete,
  onReplySubmit,
}: CommentRowProps) {
  const liked = likedIds.has(comment.commentId);
  const confirming = confirmingDeleteId === comment.commentId;
  const isAuthor = !!currentUserId && currentUserId === comment.userId;

  return (
    <div className={isReply ? 'ml-9 pl-3 border-l border-zinc-800/80' : ''}>
      <div className="flex gap-3">
        <Avatar comment={comment} />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <Link
              href={`/channel/${comment.userId}`}
              className="text-white font-bold text-[13px] truncate hover:text-brand-red transition-colors"
            >
              {comment.userName}
            </Link>
            <span className="text-zinc-500 text-[11px] whitespace-nowrap flex-shrink-0">
              {formatDistanceToNow(comment.timestamp, { addSuffix: true })}
            </span>
          </div>

          <p className="text-zinc-200 text-sm leading-snug break-words mt-0.5">
            {comment.text}
          </p>

          {/* Actions — liking is one-shot; the API only ever increments. */}
          <div className="flex items-center gap-4 mt-1.5">
            <button
              type="button"
              onClick={() => onLike(comment.commentId)}
              disabled={liked}
              title={liked ? 'Liked' : 'Like comment'}
              className={`flex items-center gap-1 transition-colors disabled:cursor-default
                ${liked ? 'text-brand-red' : 'text-zinc-500 hover:text-white'}`}
            >
              {liked ? (
                <HandThumbUpIconSolid className="w-3.5 h-3.5" />
              ) : (
                <HandThumbUpIcon className="w-3.5 h-3.5" />
              )}
              <span className="text-[11px] font-bold">{comment.likes || 0}</span>
            </button>

            {!isReply && (
              <button
                type="button"
                onClick={() => onReply(comment.commentId)}
                className="flex items-center gap-1 text-zinc-500 hover:text-white transition-colors"
              >
                <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold">Reply</span>
              </button>
            )}

            {isAuthor &&
              (confirming ? (
                <span className="flex items-center gap-2 text-[11px]">
                  <span className="text-zinc-400">Delete this comment?</span>
                  <button
                    type="button"
                    onClick={onCancelDelete}
                    className="text-zinc-300 hover:text-white font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(comment.commentId)}
                    className="text-red-400 hover:text-red-300 font-bold"
                  >
                    Delete
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onRequestDelete(comment.commentId)}
                  title="Delete comment"
                  className="text-zinc-600 hover:text-red-500 transition-colors"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              ))}
          </div>

          {/* Inline reply composer */}
          {replyingTo === comment.commentId && (
            <div className="mt-2">
              <textarea
                autoFocus
                rows={1}
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    onReplySubmit(comment.commentId);
                  }
                }}
                placeholder={`Reply to ${comment.userName}...`}
                className="w-full resize-none bg-zinc-800/70 border border-zinc-700/60 rounded-xl
                  px-3 py-2 text-sm text-white placeholder-zinc-500 leading-snug
                  focus:outline-none focus:ring-2 focus:ring-brand-red/60 focus:border-transparent"
              />
              <div className="flex justify-end gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={onCancelReply}
                  className="px-3 py-1.5 rounded-xl text-zinc-400 hover:text-white text-xs font-bold
                    transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onReplySubmit(comment.commentId)}
                  disabled={!replyDraft.trim()}
                  className="px-3 py-1.5 rounded-xl bg-brand-red hover:bg-brand-red/90 disabled:bg-zinc-800
                    disabled:text-zinc-500 text-white text-xs font-bold transition-colors"
                >
                  Reply
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map((reply) => (
            <CommentRow
              key={reply.commentId}
              comment={reply}
              isReply
              currentUserId={currentUserId}
              likedIds={likedIds}
              replyingTo={replyingTo}
              replyDraft={replyDraft}
              setReplyDraft={setReplyDraft}
              confirmingDeleteId={confirmingDeleteId}
              onReply={onReply}
              onCancelReply={onCancelReply}
              onLike={onLike}
              onRequestDelete={onRequestDelete}
              onCancelDelete={onCancelDelete}
              onDelete={onDelete}
              onReplySubmit={onReplySubmit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export default function ShortsCommentsSheet({
  videoId,
  onClose,
  onCountChange,
}: ShortsCommentsSheetProps) {
  const { address, account, signMessage } = useWallet();

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [likedIds, setLikedIds] = useState<ReadonlySet<string>>(new Set());

  const panelRef = useRef<HTMLDivElement>(null);
  const reportedCountRef = useRef<number | null>(null);

  const total = countAll(comments);

  const load = useCallback(
    async (showSkeleton: boolean) => {
      if (showSkeleton) setLoading(true);
      setLoadError(null);
      try {
        setComments(await getVideoComments(videoId));
      } catch (error) {
        console.error('Failed to load comments:', error);
        setLoadError('Could not load comments. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [videoId],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  // Tell the Shorts badge the real total. Guarded so an identity-stable
  // callback can never turn this into a render loop.
  useEffect(() => {
    if (reportedCountRef.current === total) return;
    reportedCountRef.current = total;
    onCountChange?.(total);
  }, [total, onCountChange]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const withAddress = async (run: (wallet: string) => Promise<unknown>, failure: string) => {
    if (!address) return false;
    setActionError(null);
    try {
      await run(address.toString());
      return true;
    } catch (error) {
      console.error(failure, error);
      setActionError(failure);
      return false;
    }
  };

  const submitTopLevel = async () => {
    const text = draft.trim();
    if (!address || !text || submitting) return;
    setSubmitting(true);
    const ok = await withAddress(
      async (wallet) => {
        await addComment(videoId, wallet, text, undefined, signMessage, account?.publicKey);
        setDraft('');
      },
      'Could not post your comment. Please try again.',
    );
    setSubmitting(false);
    if (ok) await load(false);
  };

  const submitReply = async (parentId: string) => {
    const text = replyDraft.trim();
    if (!address || !text) return;
    const ok = await withAddress(
      async (wallet) => {
        await addComment(videoId, wallet, text, parentId, signMessage, account?.publicKey);
        setReplyDraft('');
        setReplyingTo(null);
      },
      'Could not post your reply. Please try again.',
    );
    if (ok) await load(false);
  };

  const handleLike = async (commentId: string) => {
    if (!address || likedIds.has(commentId)) return;
    setLikedIds((prev) => new Set(prev).add(commentId));
    setComments((prev) => mapTree(prev, commentId, (c) => ({ ...c, likes: (c.likes ?? 0) + 1 })));

    const ok = await withAddress(
      (wallet) => likeComment(commentId, wallet, signMessage, account?.publicKey),
      'Could not register your like. Please try again.',
    );

    if (!ok) {
      setLikedIds((prev) => {
        const next = new Set(prev);
        next.delete(commentId);
        return next;
      });
      setComments((prev) =>
        mapTree(prev, commentId, (c) => ({ ...c, likes: Math.max(0, (c.likes ?? 0) - 1) })),
      );
    }
  };

  const handleDelete = async (commentId: string) => {
    const ok = await withAddress(
      async (wallet) => {
        await deleteComment(commentId, wallet, signMessage, account?.publicKey);
        setConfirmingDeleteId(null);
      },
      'Could not delete the comment. Please try again.',
    );
    if (ok) await load(false);
  };

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop — tap outside to close. The short keeps playing behind it,
          so it stays visible above the sheet rather than being blacked out. */}
      <div
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Comments"
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 h-[70dvh] max-h-[760px] flex flex-col
          bg-zinc-900 border-t border-zinc-700/60 rounded-t-3xl overflow-hidden
          shadow-[0_-10px_50px_rgba(0,0,0,0.7)] outline-none animate-sheet-in
          pb-[env(safe-area-inset-bottom)]"
      >
        {/* Grab handle */}
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-zinc-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 shrink-0">
          <h2 className="text-white font-black text-sm tracking-wide">
            {total} {total === 1 ? 'comment' : 'comments'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors
              flex items-center justify-center"
          >
            <XMarkIcon className="w-4 h-4 text-zinc-300" />
          </button>
        </div>

        <div className="h-px bg-zinc-800 shrink-0" />

        {/* Action error */}
        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-2 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 shrink-0"
          >
            <ExclamationTriangleIcon className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 flex-1">{actionError}</p>
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label="Dismiss error"
              className="text-red-400 hover:text-red-300"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* List */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4
            space-y-5 scrollbar-none"
          aria-busy={loading}
          aria-live="polite"
        >
          {loading ? (
            <>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-zinc-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 bg-zinc-800 rounded" />
                    <div className="h-3 w-3/4 bg-zinc-800 rounded" />
                    <div className="h-3 w-1/3 bg-zinc-800 rounded" />
                  </div>
                </div>
              ))}
              <p className="sr-only">Loading comments...</p>
            </>
          ) : loadError ? (
            <div className="text-center py-10">
              <ExclamationTriangleIcon className="w-10 h-10 text-red-500/70 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm mb-4">{loadError}</p>
              <button
                type="button"
                onClick={() => void load(true)}
                className="px-5 py-2 bg-brand-red hover:bg-brand-red/90 text-white rounded-xl
                  font-bold text-xs uppercase tracking-widest transition-colors"
              >
                Retry
              </button>
            </div>
          ) : comments.length === 0 ? (
            <div className="text-center py-14">
              <ChatBubbleLeftIcon className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm font-medium">No comments yet</p>
              <p className="text-zinc-600 text-xs mt-1">Be the first to comment</p>
            </div>
          ) : (
            comments.map((comment) => (
              <CommentRow
                key={comment.commentId}
                comment={comment}
                currentUserId={address?.toString()}
                likedIds={likedIds}
                replyingTo={replyingTo}
                replyDraft={replyDraft}
                setReplyDraft={setReplyDraft}
                confirmingDeleteId={confirmingDeleteId}
                onReply={(id) => {
                  setConfirmingDeleteId(null);
                  setReplyingTo((prev) => (prev === id ? null : id));
                }}
                onCancelReply={() => setReplyingTo(null)}
                onLike={handleLike}
                onRequestDelete={(id) => {
                  setReplyingTo(null);
                  setConfirmingDeleteId(id);
                }}
                onCancelDelete={() => setConfirmingDeleteId(null)}
                onDelete={handleDelete}
                onReplySubmit={submitReply}
              />
            ))
          )}
        </div>

        {/* Composer — pinned to the bottom, video still playing behind */}
        <div className="shrink-0 border-t border-zinc-800 px-4 py-3">
          {address ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitTopLevel();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submitTopLevel();
                  }
                }}
                placeholder="Add a comment..."
                aria-label="Add a comment"
                className="flex-1 min-h-[42px] max-h-28 resize-none bg-zinc-800/70
                  border border-zinc-700/60 rounded-2xl px-4 py-2.5 text-sm text-white
                  placeholder-zinc-500 leading-snug focus:outline-none focus:ring-2
                  focus:ring-brand-red/60 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={!draft.trim() || submitting}
                className="h-[42px] shrink-0 px-5 rounded-full bg-brand-red hover:bg-brand-red/90
                  disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-sm font-bold
                  transition-colors"
              >
                {submitting ? 'Posting' : 'Post'}
              </button>
            </form>
          ) : (
            <div className="py-2 text-center text-sm text-zinc-500 font-medium">
              Connect your wallet to comment
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
