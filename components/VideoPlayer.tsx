'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { VideoMetadata } from '../types';
import {
  ArrowPathIcon,
  ExclamationCircleIcon,
  FilmIcon,
  LockClosedIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import useVideoAccess from '@/hooks/useVideoAccess';
import PurchaseGate from './PurchaseGate';

// ---------------------------------------------------------------------------
// VideoPlayer
//
// Renders an access gate matching the server-resolved `reason` BEFORE ever
// attempting to download / decrypt the video blob (Req 7.6). Access is
// resolved through `useVideoAccess`, which calls
// GET /api/videos/:id/access and is the single source of truth for
// whether this viewer can play the video right now.
//
// The ordering below matters:
//   1. Access hook is loading → show "checking access" spinner.
//   2. Access hook errored   → show a generic playback error with retry.
//   3. Access denied (`!hasAccess`) → render the gate matching `reason`:
//        - expired          → terminal "Video Not Available" (no retry)
//        - time_locked      → live countdown + auto-refetch at zero
//        - not_on_allowlist → terminal message (no retry)
//        - payment_required → <PurchaseGate /> with onPurchased=refetch
//   4. Access granted → proceed with downloadAndDecryptVideo as before.
//
// For access-granting reasons (`public`, `owner`, `allowlisted`,
// `purchased`) we fall through to the download flow. Owner-detected
// videos skip the gate entirely via `reason === 'owner'` which resolves
// to `hasAccess === true` in the server.
//
// The previous implementation called `markVideoUnavailable` on 404
// downloads. That was the pre-access-control expiration workaround — the
// access endpoint now checks `expiration_timestamp` directly and returns
// `reason: 'expired'` before we ever fetch the blob, so we no longer need
// that local side-effect. Removing it also fixes a scoping bug where
// `markVideoUnavailable` was imported inside a dynamic `await import(...)`
// block but referenced from a catch statement further down.
//
// Requirements: 2.2, 3.4, 4.1, 4.3, 4.4, 5.1, 5.6, 7.6.
// ---------------------------------------------------------------------------

interface VideoPlayerProps {
  video: VideoMetadata;
  walletAddress?: string;
  hasAccess?: boolean;   // kept for API compat, superseded by useVideoAccess
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
}

type DownloadErrorKind = 'unavailable' | 'network' | 'playback' | null;

const BASE_CONTAINER =
  'aspect-video bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-8 text-center';

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  video,
  walletAddress,
  autoPlay = false,
  muted = false,
  className = '',
}) => {
  // ── Access resolution ────────────────────────────────────────────────
  // `walletAddress` is optional. Pass undefined → null through to the
  // hook so the server resolves the caller as anonymous.
  const {
    loading: accessLoading,
    access,
    error: accessError,
    refetch: refetchAccess,
  } = useVideoAccess(video.videoId, walletAddress ?? null);

  // ── Download / decrypt state ─────────────────────────────────────────
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadErrorKind, setDownloadErrorKind] =
    useState<DownloadErrorKind>(null);

  const objectUrlRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Clear any object URL / stream state when the video changes or when
  // access flips back to denied (e.g. owner removed a viewer from an
  // allowlist while they were watching).
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      loadingRef.current = false;
    };
  }, [video.videoId]);

  // Start the download only once access has been granted. This is the key
  // invariant of Req 7.6: no blob fetch unless the server said yes.
  useEffect(() => {
    if (!access || !access.hasAccess) return;
    if (streamUrl || objectUrlRef.current || loadingRef.current) return;

    let cancelled = false;

    (async () => {
      loadingRef.current = true;
      setDownloading(true);
      setDownloadError(null);
      setDownloadErrorKind(null);

      try {
        const { downloadAndDecryptVideo } = await import('@/lib/shelby');
        const { incrementViews } = await import('@/lib/video-service');

        const decryptedBlob = await downloadAndDecryptVideo(
          video.shelbyUrl,
          video.encryptionKey,
          video.blobName,
        );

        if (cancelled) return;

        const url = URL.createObjectURL(decryptedBlob);
        objectUrlRef.current = url;
        setStreamUrl(url);

        // Fire-and-forget; failures here shouldn't affect playback.
        incrementViews(video.videoId).catch(() => {});
      } catch (err) {
        if (cancelled) return;
        const errorMsg =
          err instanceof Error ? err.message : 'Failed to load video';

        // The access endpoint owns expiration now, so 404s at this layer
        // mean the blob is genuinely missing from storage — treat as a
        // terminal unavailability rather than trying to mark it.
        if (
          errorMsg.includes('404') ||
          errorMsg.includes('Download failed: 404') ||
          errorMsg.includes('Download failed')
        ) {
          setDownloadErrorKind('unavailable');
          setDownloadError(
            'This video is no longer available. It may have expired or been removed by the creator.',
          );
        } else if (/network|fetch|timeout|offline/i.test(errorMsg)) {
          setDownloadErrorKind('network');
          setDownloadError(
            "We couldn't reach the video storage. Check your connection and try again.",
          );
        } else {
          setDownloadErrorKind('playback');
          setDownloadError('Unable to play video. Please refresh and try again.');
        }

        console.error('Video load error:', err);
      } finally {
        loadingRef.current = false;
        if (!cancelled) setDownloading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Depending on `access.reason` specifically means a flip from e.g.
    // `payment_required` to `purchased` (after refetch) restarts the
    // download without restarting it on every identity change of the
    // `access` object.
  }, [access?.hasAccess, access?.reason, video.videoId, video.shelbyUrl, video.encryptionKey, video.blobName, streamUrl]);

  // Attach the blob URL to the <video> element and kick off autoplay.
  useEffect(() => {
    if (streamUrl && videoRef.current) {
      videoRef.current.src = streamUrl;
      videoRef.current.load();
      if (autoPlay) {
        videoRef.current.play().catch(() => {
          // Autoplay may be blocked by browser — silent fail is fine.
        });
      }
    }
  }, [streamUrl, autoPlay]);

  // ── 1. Access check is in flight ─────────────────────────────────────
  if (accessLoading && !access) {
    return (
      <div
        className={`aspect-video bg-zinc-950 rounded-xl flex items-center justify-center ${className}`}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-red mx-auto mb-3" />
          <p className="text-zinc-500 text-xs font-black uppercase tracking-widest">
            Checking access...
          </p>
        </div>
      </div>
    );
  }

  // ── 2. Access endpoint itself failed ─────────────────────────────────
  // Distinct from download failures below. The hook already tries once;
  // we surface a manual retry so a flaky connection can recover without
  // a full page reload.
  if (accessError && !access) {
    return (
      <div role="alert" className={`${BASE_CONTAINER} ${className}`}>
        <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
          <ExclamationCircleIcon className="w-8 h-8 text-brand-red" />
        </div>
        <h3 className="text-white font-black text-base mb-2 tracking-tight">
          Connection Problem
        </h3>
        <p className="text-zinc-400 text-sm max-w-md mb-5 leading-relaxed">
          We couldn&apos;t check whether you can play this video. Check your
          connection and try again.
        </p>
        <button
          onClick={() => refetchAccess()}
          className="px-5 py-2 bg-brand-red text-white rounded-xl font-black text-xs tracking-widest hover:bg-brand-red/90 transition-colors"
        >
          RETRY
        </button>
      </div>
    );
  }

  // ── 2b. Chain temporarily unreachable ──────────────────────────────────
  // Distinct from the generic accessError branch above: the server
  // responded successfully but reported that the chain node was
  // unreachable when it tried to resolve the access policy. We show a
  // retryable state with NO "expired" copy so a transient node outage
  // doesn't look like a permanent content takedown (Req 7.3, 7.6).
  if (access?.reason === 'chain_unavailable') {
    return (
      <div
        role="alert"
        aria-label="Chain unavailable"
        className={`${BASE_CONTAINER} ${className}`}
      >
        <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
          <ArrowPathIcon className="w-8 h-8 text-zinc-400" />
        </div>
        <h3 className="text-white font-black text-base mb-2 tracking-tight">
          Chain Temporarily Unreachable
        </h3>
        <p className="text-zinc-400 text-sm max-w-md mb-5 leading-relaxed">
          We couldn&apos;t confirm this video&apos;s access policy. Try again in a moment.
        </p>
        <button
          onClick={() => refetchAccess()}
          className="px-5 py-2 bg-brand-red text-white rounded-xl font-black text-xs tracking-widest hover:bg-brand-red/90 transition-colors"
        >
          RETRY
        </button>
      </div>
    );
  }

  // ── 3. Access denied — render gate matching `reason` ─────────────────
  if (access && !access.hasAccess) {
    switch (access.reason) {
      case 'expired':
        // Terminal state — preserves the existing "Video Not Available"
        // copy so creators and viewers see the same message they used to
        // (no retry button, same FilmIcon + zinc palette).
        return (
          <div role="alert" className={`${BASE_CONTAINER} ${className}`}>
            <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
              <FilmIcon className="w-8 h-8 text-zinc-500" />
            </div>
            <h3 className="text-white font-black text-base mb-2 tracking-tight">
              Video Not Available
            </h3>
            <p className="text-zinc-400 text-sm max-w-md leading-relaxed">
              This video has expired or been removed by the creator.
            </p>
          </div>
        );

      case 'not_on_allowlist':
        return (
          <div
            role="alert"
            className={`${BASE_CONTAINER} ${className}`}
            aria-label="Not on allowlist"
          >
            <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
              <LockClosedIcon className="w-8 h-8 text-zinc-400" />
            </div>
            <h3 className="text-white font-black text-base mb-2 tracking-tight">
              Restricted Video
            </h3>
            <p className="text-zinc-400 text-sm max-w-md leading-relaxed">
              You&apos;re not on the allowlist for this video.
            </p>
          </div>
        );

      case 'time_locked':
        // Live countdown to unlockAt. Auto-refetches when the countdown
        // reaches zero so the gate disappears without a manual refresh.
        return (
          <TimeLockGate
            className={className}
            unlockAt={access.unlockAt}
            onUnlock={refetchAccess}
          />
        );

      case 'payment_required':
        // Delegates to <PurchaseGate />. `onPurchased={refetchAccess}` is
        // the wire for task 5.6: once /api/payments/verify succeeds, the
        // hook re-runs, the server returns reason='purchased', and we
        // fall through to the download flow.
        return (
          <div className={className}>
            <PurchaseGate
              video={video}
              walletAddress={walletAddress ?? null}
              onPurchased={refetchAccess}
            />
          </div>
        );

      default:
        // Defensive fallback for any unexpected deny reason (e.g. a new
        // reason string added server-side that this client hasn't been
        // deployed with yet). Showing the generic unavailability state
        // is the least-surprising option.
        return (
          <div role="alert" className={`${BASE_CONTAINER} ${className}`}>
            <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
              <LockClosedIcon className="w-8 h-8 text-zinc-500" />
            </div>
            <h3 className="text-white font-black text-base mb-2 tracking-tight">
              Video Not Available
            </h3>
            <p className="text-zinc-400 text-sm max-w-md leading-relaxed">
              You don&apos;t currently have access to this video.
            </p>
          </div>
        );
    }
  }

  // ── 4. Access granted — download / playback states ──────────────────
  if (downloading) {
    return (
      <div
        className={`aspect-video bg-zinc-950 rounded-xl flex items-center justify-center ${className}`}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-red mx-auto mb-3" />
          <p className="text-zinc-500 text-xs font-black uppercase tracking-widest">
            Decrypting stream...
          </p>
        </div>
      </div>
    );
  }

  if (downloadError) {
    const isUnavailable = downloadErrorKind === 'unavailable';
    const Icon = isUnavailable ? FilmIcon : ExclamationCircleIcon;
    const iconColor = isUnavailable ? 'text-zinc-500' : 'text-brand-red';
    const headline = isUnavailable
      ? 'Video Not Available'
      : downloadErrorKind === 'network'
        ? 'Connection Problem'
        : 'Playback Error';

    return (
      <div role="alert" className={`${BASE_CONTAINER} ${className}`}>
        <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
          <Icon className={`w-8 h-8 ${iconColor}`} />
        </div>
        <h3 className="text-white font-black text-base mb-2 tracking-tight">
          {headline}
        </h3>
        <p className="text-zinc-400 text-sm max-w-md mb-5 leading-relaxed">
          {downloadError}
        </p>
        {!isUnavailable && (
          <button
            onClick={() => {
              setDownloadError(null);
              setDownloadErrorKind(null);
              loadingRef.current = false;
              objectUrlRef.current = null;
              setStreamUrl('');
              // Trigger the download effect to re-run by refetching access;
              // a no-op on success but cleanly handles the case where
              // access has since flipped.
              refetchAccess();
            }}
            className="px-5 py-2 bg-brand-red text-white rounded-xl font-black text-xs tracking-widest hover:bg-brand-red/90 transition-colors"
          >
            RETRY
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`aspect-video bg-black rounded-xl overflow-hidden ${className}`}>
      {streamUrl ? (
        <video
          ref={videoRef}
          controls
          controlsList="nodownload"
          playsInline
          muted={muted}
          className="w-full h-full"
          onError={(e) => {
            const code = e.currentTarget.error?.code;
            const msg = e.currentTarget.error?.message ?? 'Unknown error';
            setDownloadErrorKind('playback');
            setDownloadError(`Playback error (${code}): ${msg}`);
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-red" />
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TimeLockGate
//
// Renders a live countdown to `unlockAt` using a 1-second setInterval.
// When the countdown hits zero we call `onUnlock` (the parent's
// `refetchAccess`) so the server re-resolves and the gate disappears.
//
// Kept as a local component so the interval lifecycle (mount/cleanup,
// unlockAt changes) is scoped to the time-locked path only — when the
// viewer is watching a public or purchased video we never pay the
// setInterval cost.
// ---------------------------------------------------------------------------
function TimeLockGate({
  className,
  unlockAt,
  onUnlock,
}: {
  className: string;
  unlockAt: number | undefined;
  onUnlock: () => void;
}): React.ReactElement {
  // If the server ever returns time_locked without an unlockAt we fall
  // back to showing a neutral "locked" state rather than counting down
  // against an undefined target. This is a belt-and-braces guard; the
  // access endpoint always includes unlockAt on time_locked responses.
  const target = typeof unlockAt === 'number' ? unlockAt : null;
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    target !== null ? Math.max(0, target - Date.now()) : 0,
  );

  useEffect(() => {
    if (target === null) return;
    // Recompute immediately so a prop change (e.g. creator edited the
    // unlock time) is reflected without waiting a full second.
    setRemainingMs(Math.max(0, target - Date.now()));

    const id = setInterval(() => {
      const next = Math.max(0, target - Date.now());
      setRemainingMs(next);
      if (next === 0) {
        // Stop ticking immediately and ask the parent to refetch. The
        // next access resolution will either grant access (unlock passed)
        // or update unlockAt (creator pushed the time back).
        clearInterval(id);
        onUnlock();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [target, onUnlock]);

  const countdown = formatCountdown(remainingMs);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`${BASE_CONTAINER} ${className}`}
    >
      <div className="w-16 h-16 rounded-full bg-brand-purple/15 border border-brand-purple/40 flex items-center justify-center mb-5">
        <ClockIcon className="w-8 h-8 text-brand-purple" />
      </div>
      <p className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-2">
        Unlocks in
      </p>
      <div className="text-white font-black text-3xl sm:text-4xl tracking-tight tabular-nums">
        {countdown}
      </div>
      {target !== null && (
        <p className="text-zinc-500 text-xs mt-3">
          {new Date(target).toLocaleString()}
        </p>
      )}
    </div>
  );
}

/**
 * Format a millisecond duration as `DDd HH:MM:SS` / `HH:MM:SS` / `MM:SS`.
 * Days are only shown when the remaining time is ≥ 24h; otherwise the
 * two-segment form keeps the big type legible at a glance.
 */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export default VideoPlayer;
