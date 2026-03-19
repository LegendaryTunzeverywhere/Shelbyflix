'use client';

import { useState } from 'react';
import type { VideoMetadata } from '@/types';
import {
  ExclamationTriangleIcon,
  TrashIcon,
  XMarkIcon,
  ShieldExclamationIcon,
  CubeTransparentIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline';

interface DeleteVideoModalProps {
  video: VideoMetadata;
  signAndSubmitTransaction: any;
  onClose: () => void;
  onSuccess: () => void;
}

type DeleteStage = 'confirm' | 'deleting_db' | 'deleting_chain' | 'done' | 'error';

export default function DeleteVideoModal({
  video,
  signAndSubmitTransaction,
  onClose,
  onSuccess,
}: DeleteVideoModalProps) {
  const [stage, setStage] = useState<DeleteStage>('confirm');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');

  const confirmed = confirmText.trim().toLowerCase() === 'delete';

  async function handleDelete() {
    if (!confirmed) return;
    setError('');

    try {
      // Step 1: Remove from Supabase
      setStage('deleting_db');
      const { supabase } = await import('@/lib/supabase');
      const { error: dbError } = await supabase
        .from('videos')
        .delete()
        .eq('video_id', video.videoId);

      if (dbError) throw new Error(`Database error: ${dbError.message}`);

      // Step 2: Remove from Shelby cache + on-chain blob expiry signal
      setStage('deleting_chain');
      const { deleteFromShelby } = await import('@/lib/shelby');
      await deleteFromShelby(
        video.videoId,
        video.shelbyUrl,
        video.blobName,
        signAndSubmitTransaction
      );

      setStage('done');
      setTimeout(() => {
        onSuccess();
      }, 1200);

    } catch (e) {
      console.error('Delete failed:', e);
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setStage('error');
    }
  }

  const isProcessing = stage === 'deleting_db' || stage === 'deleting_chain';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={!isProcessing ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden">

        {/* Close button */}
        {!isProcessing && stage !== 'done' && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 bg-zinc-800 hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors z-10"
          >
            <XMarkIcon className="w-4 h-4 text-zinc-400" />
          </button>
        )}

        {/* Header — danger zone */}
        <div className="bg-red-950/40 border-b border-red-900/30 px-6 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-red/20 border border-brand-red/30 rounded-2xl flex items-center justify-center flex-shrink-0">
              <ExclamationTriangleIcon className="w-5 h-5 text-brand-red" />
            </div>
            <div>
              <h2 className="text-white font-black text-lg tracking-tight">Delete Video</h2>
              <p className="text-red-400 text-xs font-bold uppercase tracking-widest">Permanent · Cannot be undone</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Video preview */}
          <div className="flex gap-3 p-3 bg-zinc-900/60 border border-zinc-800 rounded-2xl">
            <div className="w-20 aspect-video bg-zinc-800 rounded-xl overflow-hidden flex-shrink-0">
              {video.thumbnailUrl ? (
                <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <TrashIcon className="w-5 h-5 text-zinc-600" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 py-0.5">
              <p className="text-white font-bold text-sm line-clamp-2 leading-snug">{video.title}</p>
              <p className="text-zinc-500 text-xs mt-1">{video.views.toLocaleString()} views</p>
            </div>
          </div>

          {/* What gets deleted */}
          <div className="space-y-2">
            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">This will permanently remove:</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5 text-sm text-zinc-300">
                <CircleStackIcon className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                Video metadata from the database
              </div>
              <div className="flex items-center gap-2.5 text-sm text-zinc-300">
                <CubeTransparentIcon className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                Encrypted file from Shelbynet storage
              </div>
              <div className="flex items-center gap-2.5 text-sm text-zinc-300">
                <ShieldExclamationIcon className="w-4 h-4 text-brand-red flex-shrink-0" />
                <span>On-chain blob registration · <span className="text-brand-red font-bold">cannot be recovered</span></span>
              </div>
            </div>
          </div>

          {/* Progress stages */}
          {(isProcessing || stage === 'done') && (
            <div className="space-y-2 py-1">
              <StageRow
                label="Removing from database"
                status={stage === 'deleting_db' ? 'active' : (stage === 'deleting_chain' || stage === 'done') ? 'done' : 'pending'}
              />
              <StageRow
                label="Removing from Shelbynet"
                status={stage === 'deleting_chain' ? 'active' : stage === 'done' ? 'done' : 'pending'}
              />
              {stage === 'done' && (
                <p className="text-green-400 text-sm font-bold text-center pt-1">✓ Video deleted successfully</p>
              )}
            </div>
          )}

          {/* Error state */}
          {stage === 'error' && (
            <div className="p-3 bg-red-950/40 border border-red-900/30 rounded-xl">
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={() => setStage('confirm')}
                className="mt-2 text-xs text-zinc-400 hover:text-white underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* Confirmation input */}
          {stage === 'confirm' && (
            <div>
              <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">
                Type <span className="text-white">delete</span> to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="delete"
                autoFocus
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 focus:border-brand-red rounded-xl text-white placeholder-zinc-600 text-sm outline-none transition-colors"
              />
            </div>
          )}

          {/* Action buttons */}
          {stage === 'confirm' && (
            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!confirmed}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-brand-red hover:bg-red-700 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white rounded-xl font-black text-sm tracking-widest transition-colors"
              >
                <TrashIcon className="w-4 h-4" />
                DELETE
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageRow({ label, status }: { label: string; status: 'pending' | 'active' | 'done' }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
        {status === 'done' && (
          <div className="w-5 h-5 bg-green-500/20 border border-green-500/40 rounded-full flex items-center justify-center">
            <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        )}
        {status === 'active' && (
          <div className="w-4 h-4 border-2 border-brand-red border-t-transparent rounded-full animate-spin" />
        )}
        {status === 'pending' && (
          <div className="w-3 h-3 border border-zinc-700 rounded-full" />
        )}
      </div>
      <span className={`text-sm ${status === 'done' ? 'text-green-400' : status === 'active' ? 'text-white font-bold' : 'text-zinc-600'}`}>
        {label}
      </span>
    </div>
  );
}