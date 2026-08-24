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
  signMessage: (args: { message: string; nonce: string }) => Promise<any>;
  walletAddress: string;
  walletPublicKeyHex?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type DeleteStage =
  | 'confirm'
  | 'checking_chain'
  | 'deleting_chain_blob'
  | 'deleting_db'
  | 'deleting_shelby'
  | 'done'
  | 'error';

export default function DeleteVideoModal({
  video,
  signAndSubmitTransaction,
  signMessage,
  walletAddress,
  walletPublicKeyHex,
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

    // Read the flag at the point of use, not module load (Req 15.6)
    const isMoveBackend = process.env.NEXT_PUBLIC_ACCESS_BACKEND === 'move';

    if (isMoveBackend) {
      await handleMoveDelete();
    } else {
      await handleSupabaseDelete();
    }
  }

  /**
   * Supabase-flag delete — now routes through the same authenticated
   * server-side deletion as the Move-flag path (lib/video-service.ts's
   * deleteVideo), which performs the Shelby storage deletion (signed by
   * the platform account, the actual on-chain owner) and the Supabase row
   * deletion together in one authorized call.
   */
  async function handleSupabaseDelete() {
    try {
      setStage('deleting_shelby');
      const { deleteVideo } = await import('@/lib/video-service');
      await deleteVideo(video.videoId, signMessage, walletAddress, walletPublicKeyHex);

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

  /**
   * Move-flag delete flow (Req 10.1, 10.2, 10.3, 10.4, 10.6):
   *
   * Strict ordering — do not advance on failure:
   *   (a) Pre-check get_maybe_blob_metadata_bcs(full_blob_name) with 10s timeout
   *       - None → skip delete_blob, proceed to (c)
   *       - Some → proceed to (b)
   *   (b) Submit delete_blob(full_blob_name) signed by creator, waitForTransaction 60s
   *   (c)+(d) Delete Shelby storage blob + Supabase videos row via the
   *       authenticated server route (lib/video-service.ts's deleteVideo) —
   *       both now happen server-side under the platform account, the
   *       actual on-chain owner of Shelby blobs.
   */
  async function handleMoveDelete() {
    try {
      const { getAptosClient } = await import('@/lib/aptos-client');
      const { ACCESS_CONTROL_MODULE } = await import('@/lib/move-contract');
      const { logChainWriteSuccess } = await import('@/lib/move-logging');
      const { normalizeAddress } = await import('@/lib/access-control');

      // ── (a) Pre-check: resolve full_blob_name and check chain state ────
      setStage('checking_chain');

      // Resolve the full blob name via the server endpoint
      const blobNameRes = await fetch(`/api/videos/${video.videoId}/blob-name`);
      if (!blobNameRes.ok) {
        throw new Error(
          `Failed to resolve blob name: ${blobNameRes.status} ${blobNameRes.statusText}`
        );
      }
      const { fullBlobName } = await blobNameRes.json();

      // Pre-check get_maybe_blob_metadata_bcs with 10-second timeout (Req 10.6)
      const aptos = getAptosClient();
      let blobExistsOnChain = false;

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Pre-check timeout (10s)')), 10_000)
        );
        const viewPromise = aptos.view({
          payload: {
            function: `${ACCESS_CONTROL_MODULE}get_maybe_blob_metadata_bcs` as `${string}::${string}::${string}`,
            typeArguments: [],
            functionArguments: [fullBlobName],
          },
        });

        const result = await Promise.race([viewPromise, timeoutPromise]);

        // The view returns a hex-encoded Option<BlobMetadataV2>.
        // We only need to know if it's None (skip delete_blob) or Some (proceed).
        // None is represented as a hex string whose first byte (Option tag) is 0x00.
        if (Array.isArray(result) && result.length === 1 && typeof result[0] === 'string') {
          const hexPayload = result[0] as string;
          const cleanHex = hexPayload.startsWith('0x') ? hexPayload.slice(2) : hexPayload;
          // Option tag: first byte — 0x00 = None, 0x01 = Some
          if (cleanHex.length >= 2) {
            const optionTag = parseInt(cleanHex.slice(0, 2), 16);
            blobExistsOnChain = optionTag === 1;
          }
        }
      } catch (preCheckErr) {
        // Pre-check timeout or failure — abort the entire delete (Req 10.3)
        const msg = preCheckErr instanceof Error ? preCheckErr.message : String(preCheckErr);
        throw new Error(`Chain pre-check failed: ${msg}`);
      }

      // ── (b) Submit delete_blob if blob exists on chain ─────────────────
      if (blobExistsOnChain) {
        setStage('deleting_chain_blob');

        const payload = {
          function: `${ACCESS_CONTROL_MODULE}delete_blob` as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [fullBlobName],
        };

        // Sign and submit — catch wallet rejections (Req 10.3)
        let txHash: string;
        try {
          const response = await signAndSubmitTransaction({ data: payload });
          txHash = response.hash;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Categorize signing failure
          if (
            msg.toLowerCase().includes('user rejected') ||
            msg.toLowerCase().includes('user denied') ||
            msg.toLowerCase().includes('rejected by user') ||
            msg.toLowerCase().includes('cancelled')
          ) {
            throw new Error(`Signing rejected: User declined the delete_blob transaction.`);
          }
          throw new Error(`Wallet signing failed (delete_blob): ${msg}`);
        }

        // Wait for transaction with 60-second timeout (Req 10.3)
        let txResult: any;
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Transaction commit timeout (60s)')), 60_000)
          );
          const waitPromise = aptos.waitForTransaction({
            transactionHash: txHash,
            options: { checkSuccess: false },
          });
          txResult = await Promise.race([waitPromise, timeoutPromise]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`delete_blob commit failed: ${msg}`);
        }

        // Check on-chain result (Req 10.3)
        if (txResult.success === false) {
          const vmStatus: string = txResult.vm_status ?? '';
          throw new Error(
            `delete_blob aborted on-chain: ${vmStatus || 'Unknown VM error'} (abort code: ${vmStatus})`
          );
        }

        // Emit logChainWriteSuccess on confirmed commit (Req 14.2)
        const version = txResult.version ?? 0;
        logChainWriteSuccess('delete_blob', {
          videoId: video.videoId,
          txHash,
          version,
        });
      }

      // ── (c) + (d) Delete the Shelby storage blob and the Supabase row.
      // Both now go through the single authenticated server-side route
      // (lib/video-service.ts's deleteVideo) rather than separate client
      // calls — the platform account (not this wallet) is the actual
      // on-chain owner of the Shelby blob post-architecture-change, so
      // only the server can sign that deletion successfully.
      setStage('deleting_db');
      const { deleteVideo } = await import('@/lib/video-service');
      await deleteVideo(video.videoId, signMessage, walletAddress, walletPublicKeyHex);

      setStage('done');
      setTimeout(() => {
        onSuccess();
      }, 1200);
    } catch (e) {
      console.error('Move delete failed:', e);
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setStage('error');
    }
  }

  const isProcessing =
    stage === 'checking_chain' ||
    stage === 'deleting_chain_blob' ||
    stage === 'deleting_db' ||
    stage === 'deleting_shelby';

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
              {process.env.NEXT_PUBLIC_ACCESS_BACKEND === 'move' ? (
                <>
                  <StageRow
                    label="Checking on-chain state"
                    status={
                      stage === 'checking_chain'
                        ? 'active'
                        : stage === 'deleting_chain_blob' ||
                          stage === 'deleting_db' ||
                          stage === 'deleting_shelby' ||
                          stage === 'done'
                        ? 'done'
                        : 'pending'
                    }
                  />
                  <StageRow
                    label="Removing on-chain blob"
                    status={
                      stage === 'deleting_chain_blob'
                        ? 'active'
                        : stage === 'deleting_db' ||
                          stage === 'deleting_shelby' ||
                          stage === 'done'
                        ? 'done'
                        : 'pending'
                    }
                  />
                  <StageRow
                    label="Removing from database"
                    status={
                      stage === 'deleting_db'
                        ? 'active'
                        : stage === 'deleting_shelby' || stage === 'done'
                        ? 'done'
                        : 'pending'
                    }
                  />
                  <StageRow
                    label="Removing from Shelbynet"
                    status={
                      stage === 'deleting_shelby'
                        ? 'active'
                        : stage === 'done'
                        ? 'done'
                        : 'pending'
                    }
                  />
                </>
              ) : (
                <>
                  <StageRow
                    label="Removing from database"
                    status={
                      stage === 'deleting_db'
                        ? 'active'
                        : stage === 'deleting_shelby' || stage === 'done'
                        ? 'done'
                        : 'pending'
                    }
                  />
                  <StageRow
                    label="Removing from Shelbynet"
                    status={
                      stage === 'deleting_shelby'
                        ? 'active'
                        : stage === 'done'
                        ? 'done'
                        : 'pending'
                    }
                  />
                </>
              )}
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
