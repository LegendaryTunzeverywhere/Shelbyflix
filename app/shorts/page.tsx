'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import EngagementBar from '@/components/EngagementBar';
import SubscribeButton from '@/components/SubscribeButton';
import ShortsCommentsSheet from '@/components/ShortsCommentsSheet';
import { useWallet } from '@/hooks/useWallet';
import type { VideoMetadata } from '@/types';
import {
  ChevronUpIcon,
  ChevronDownIcon,
  EyeIcon,
  ChatBubbleLeftIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';

/**
 * Channel DP for the overlay. The feed payload has no avatar field, so the
 * caller resolves `users.avatar_url` per channel; until it lands (or when
 * there is no profile) we fall back to the gradient initials used everywhere
 * else in the app.
 */
function ChannelAvatar({
  avatarUrl,
  channelName,
}: {
  avatarUrl?: string | null;
  channelName: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : avatarUrl;

  return (
    <div
      className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 flex items-center
        justify-center bg-gradient-to-br from-brand-purple to-brand-red text-white
        font-black text-sm"
    >
      {src ? (
        <img
          src={src}
          alt={channelName}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{channelName.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}

function ShortPlayer({
  video,
  isActive,
  isMuted,
  walletAddress,
  onFirstPlay,
}: {
  video: VideoMetadata;
  isActive: boolean;
  isMuted: boolean;
  walletAddress?: string | null;
  onFirstPlay?: () => void;
}) {
  const [streamUrl, setStreamUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 'session' = 401 wallet_session_required from the key endpoint; the
  // overlay shows a Sign In button and retries on wallet-session-established.
  const [errorKind, setErrorKind] = useState<'session' | 'other' | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!isActive || loadedRef.current) return;
    loadedRef.current = true;

    (async () => {
      try {
        const { downloadAndDecryptVideo, downloadRawVideo, fetchDecryptionKey } =
          await import('@/lib/shelby');

        // Unencrypted uploads skip the key endpoint entirely — raw bytes,
        // plain fetch. Encrypted ones (default) stay key-gated.
        const blob =
          video.isEncrypted !== false
            ? await downloadAndDecryptVideo(
                video.shelbyUrl,
                await fetchDecryptionKey(video.videoId, walletAddress),
                video.blobName,
              )
            : await downloadRawVideo(video.shelbyUrl, video.blobName);

        const url = URL.createObjectURL(blob);
        setStreamUrl(url);
        setErrorKind(null);
      } catch (e) {
        if (e instanceof Error && e.name === 'WalletSessionRequiredError') {
          setErrorKind('session');
          setError('Sign in with your wallet to watch this video.');
        } else if (e instanceof Error && /403/.test(e.message)) {
          setErrorKind('other');
          setError('This video requires purchase or access approval.');
        } else {
          setErrorKind('other');
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [isActive, video.videoId, video.shelbyUrl, video.blobName, video.isEncrypted, walletAddress, retryTick]);

  // A wallet session just completed after a 401 — reset the loader and
  // re-run the effect above.
  useEffect(() => {
    if (errorKind !== 'session') return;
    const onSessionEstablished = () => {
      loadedRef.current = false;
      setError('');
      setErrorKind(null);
      setLoading(true);
      setRetryTick((n) => n + 1);
    };
    window.addEventListener('wallet-session-established', onSessionEstablished);
    return () =>
      window.removeEventListener('wallet-session-established', onSessionEstablished);
  }, [errorKind]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !streamUrl) return;
    vid.src = streamUrl;
    vid.load();
    if (isActive) {
      vid.muted = isMuted;
      vid.play().catch(() => {});
    } else {
      vid.pause();
      vid.currentTime = 0;
    }
  }, [streamUrl, isActive]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted]);

  function togglePause() {
    const vid = videoRef.current;
    if (!vid || !streamUrl) return;
    if (vid.paused) { vid.play(); setIsPaused(false); }
    else { vid.pause(); setIsPaused(true); }
  }

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center" onClick={togglePause}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black gap-4">
          <p className="text-zinc-400 text-sm px-8 text-center">{error}</p>
          {errorKind === 'session' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new Event('shelbyflix:authorize-session'));
              }}
              className="px-5 py-2 bg-brand-red text-white rounded-xl font-black text-xs tracking-widest hover:bg-brand-red/90 transition-colors"
            >
              SIGN IN
            </button>
          )}
        </div>
      )}
      {/* 9:16 container — video stays portrait on any screen */}
      <div className="relative h-full max-h-full aspect-[9/16] bg-black overflow-hidden">
        <video
          ref={videoRef}
          loop
          playsInline
          className="w-full h-full object-cover"
          onPlay={() => {
            setIsPaused(false);
            onFirstPlay?.();
          }}
          onPause={() => setIsPaused(true)}
        />
        {isPaused && streamUrl && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-16 h-16 bg-black/50 rounded-full flex items-center justify-center">
              <PlayIcon className="w-8 h-8 text-white" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ShortsContent() {
  const router = useRouter();
  const { address } = useWallet();
  const [shorts, setShorts] = useState<VideoMetadata[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [channelAvatars, setChannelAvatars] = useState<Record<string, string | null>>({});

  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const countFetchedRef = useRef<Set<string>>(new Set());
  const avatarFetchedRef = useRef<Set<string>>(new Set());

  // One view per video per page session, same as the normal player's
  // countedViewForVideoRef. Kept here (not in ShortPlayer) so swiping past a
  // short and back — which unmounts and remounts it — doesn't double count.
  const countedViewsRef = useRef<Set<string>>(new Set());

  const countView = useCallback((video: VideoMetadata) => {
    if (countedViewsRef.current.has(video.videoId)) return;
    countedViewsRef.current.add(video.videoId);

    import('@/lib/video-service')
      .then(({ incrementViews }) => incrementViews(video.videoId))
      .then((views) => {
        setShorts(prev =>
          prev.map(v => (v.videoId === video.videoId ? { ...v, views } : v)),
        );
      })
      .catch((error) => {
        countedViewsRef.current.delete(video.videoId);
        console.error('Failed to record video view:', error);
      });
  }, []);

  const activeShort = shorts[currentIndex];

  // `comment_count` on the videos row is never written, so the badge can't
  // come from the feed payload. Ask once per short (cheap public GET) so the
  // overlay isn't stuck at 0; the open sheet corrects it as you read/post.
  useEffect(() => {
    const videoId = activeShort?.videoId;
    if (!videoId || countFetchedRef.current.has(videoId)) return;
    countFetchedRef.current.add(videoId);

    (async () => {
      try {
        const { getVideoComments } = await import('@/lib/engagement-store');
        const list = await getVideoComments(videoId);
        const total = list.reduce((t, c) => t + 1 + (c.replies?.length ?? 0), 0);
        setCommentCounts(prev => ({ ...prev, [videoId]: total }));
      } catch {
        // Leave the badge alone and try again next time it becomes active.
        countFetchedRef.current.delete(videoId);
      }
    })();
  }, [activeShort?.videoId]);

  // Channel DP: `videos` carries no avatar, so look the uploader up once per
  // channel. getUserByWallet resolves to null on 404 (no profile row).
  useEffect(() => {
    const channelId = activeShort?.channelId;
    if (!channelId || avatarFetchedRef.current.has(channelId)) return;
    avatarFetchedRef.current.add(channelId);

    (async () => {
      try {
        const { getUserByWallet } = await import('@/lib/user-service');
        const user = await getUserByWallet(channelId);
        setChannelAvatars(prev => ({ ...prev, [channelId]: user?.avatar_url ?? null }));
      } catch {
        avatarFetchedRef.current.delete(channelId);
      }
    })();
  }, [activeShort?.channelId]);

  useEffect(() => {
    (async () => {
      try {
        const { getAllVideos } = await import('@/lib/video-service');
        const all = await getAllVideos();
        setShorts(all.filter(v => {
          const isShortVideo = v.videoType === 'short' || v.isShort || v.duration < 60;
          if (!isShortVideo) return false;

          // Hide timelocked videos that haven't unlocked yet
          if (v.accessMode === 'timelock' && v.unlockAt && v.unlockAt > Date.now()) {
            return false;
          }

          return true;
        }));
      } catch (e) {
        console.error('Failed to load shorts:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ✅ FIX: Allow both next AND previous navigation
  const goNext = useCallback(() => {
    setCurrentIndex(i => {
      const next = i + 1;
      if (next >= shorts.length) return i; // Can't go beyond last
      return next;
    });
  }, [shorts.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex(i => {
      const prev = i - 1;
      if (prev < 0) return i; // Can't go before first
      return prev;
    });
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // The comments sheet owns the keyboard while it's open (arrows would
      // otherwise swipe the feed out from under it).
      if (commentsOpen) return;
      if (e.key === 'ArrowDown') goNext();
      if (e.key === 'ArrowUp') goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, commentsOpen]);

  // Touch navigation
  function onTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
  }

  function onTouchEnd(e: React.TouchEvent) {
    const dy = touchStartY.current - e.changedTouches[0].clientY;
    const dt = Date.now() - touchStartTime.current;
    
    // Swipe threshold
    if (Math.abs(dy) > 60 || (Math.abs(dy) > 30 && dt < 300)) {
      if (dy > 0) goNext();      // Swipe up → next
      else goPrev();             // Swipe down → previous ✅
    }
  }

  // Mouse wheel navigation
  const wheelLock = useRef(false);
  function onWheel(e: React.WheelEvent) {
    e.preventDefault(); // Prevent page scroll
    
    if (wheelLock.current) return;
    wheelLock.current = true;
    
    if (e.deltaY > 0) goNext();      // Scroll down → next
    else goPrev();                    // Scroll up → previous ✅
    
    setTimeout(() => { wheelLock.current = false; }, 600);
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
      </div>
    );
  }

  if (shorts.length === 0) {
    return (
      <div className="fixed inset-0 bg-black overflow-hidden">
        <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-4">
          <Link href="/" className="text-white font-black text-xl tracking-tighter">
            SHELBY<span className="text-brand-red">FLIX</span>
          </Link>
        </div>
        <main className="flex items-center justify-center h-[80vh]">
          <div className="text-center">
            <h2 className="text-3xl font-black text-white mb-4 tracking-tighter">NO SHORTS YET</h2>
            <p className="text-zinc-500 mb-8">Upload a vertical short to see it here</p>
            <button
              onClick={() => router.push('/upload')}
              className="px-8 py-4 bg-brand-red text-white rounded-2xl font-black text-sm tracking-widest hover:bg-brand-red/90 transition-colors"
            >
              UPLOAD SHORT
            </button>
          </div>
        </main>
      </div>
    );
  }

  const current = shorts[currentIndex];
  const commentTotal = commentCounts[current.videoId] ?? current.commentCount ?? 0;

  const openComments = () => setCommentsOpen(true);
  const handleCommentCount = (videoId: string, count: number) => {
    setCommentCounts(prev => (prev[videoId] === count ? prev : { ...prev, [videoId]: count }));
  };

  return (
    <div className="fixed inset-0 bg-black overflow-hidden flex flex-col">
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-4">
        <Link href="/" className="text-white font-black text-xl tracking-tighter">
          SHELBY<span className="text-brand-red">FLIX</span>
        </Link>
        <button
          onClick={() => setIsMuted(m => !m)}
          className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white"
        >
          {isMuted ? <SpeakerXMarkIcon className="w-5 h-5" /> : <SpeakerWaveIcon className="w-5 h-5" />}
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
      >
        {/* Progress indicator */}
        <div className="absolute top-14 left-4 right-16 z-20 flex gap-1">
          {shorts.map((_, idx) => (
            <div key={idx} className="flex-1 h-0.5 rounded-full bg-white/20 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${idx <= currentIndex ? 'bg-white w-full' : 'w-0'}`} />
            </div>
          ))}
        </div>

        {/* Video slides */}
        {shorts.map((short, idx) => {
          // Render current, previous, and next for smooth transitions
          if (Math.abs(idx - currentIndex) > 1) return null;
          return (
            <div
              key={short.videoId}
              className="absolute inset-0 transition-transform duration-300 ease-out"
              style={{ transform: `translateY(${(idx - currentIndex) * 100}%)` }}
            >
              <ShortPlayer
                video={short}
                isActive={idx === currentIndex}
                isMuted={isMuted}
                walletAddress={address?.toString()}
                onFirstPlay={() => countView(short)}
              />
            </div>
          );
        })}

        {/* Info overlay */}
        <div className="absolute bottom-0 left-0 right-14 sm:right-16 p-4 sm:p-5 z-20 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none">
          {/* Constrained so the subscribe control stays beside the channel on
              wide screens instead of being pushed to the far right edge. */}
          <div className="max-w-xl">
            <div className="flex items-center gap-3 mb-3 pointer-events-auto">
              <Link
                href={`/channel/${current.channelId}`}
                className="group flex items-center gap-3 min-w-0"
                title={`Open ${current.channelName}'s channel`}
              >
                <ChannelAvatar
                  key={current.channelId}
                  avatarUrl={channelAvatars[current.channelId]}
                  channelName={current.channelName}
                />
                <div className="min-w-0">
                  <p className="text-white font-black text-sm truncate group-hover:text-brand-red transition-colors">
                    {current.channelName}
                  </p>
                  <p className="text-zinc-400 text-xs truncate">{formatDistanceToNow(current.uploadTimestamp, { addSuffix: true })}</p>
                </div>
              </Link>
              <div>
                <SubscribeButton channelId={current.channelId} compact />
              </div>
            </div>
            <h2 className="text-white font-black text-base mb-1 line-clamp-2 leading-tight">{current.title}</h2>
            {current.description && (
              <p className="text-zinc-300 text-sm line-clamp-2 mb-3">{current.description}</p>
            )}
            <div className="flex items-center gap-4 text-white text-xs pointer-events-none">
              <div className="flex items-center gap-1">
                <EyeIcon className="w-3.5 h-3.5" />
                <span className="font-bold">{current.views.toLocaleString()}</span>
              </div>
              <button
                type="button"
                onClick={openComments}
                className="flex items-center gap-1 pointer-events-auto hover:text-brand-red
                  transition-colors"
                title="Comments"
              >
                <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
                <span className="font-bold">{commentTotal}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Navigation controls */}
        <div className="absolute right-2 sm:right-3 bottom-20 sm:bottom-24 z-20 flex flex-col items-center gap-4 sm:gap-5">
          <EngagementBar videoId={current.videoId} vertical />

          {/* Comments — opens the sheet over the video, which keeps playing */}
          <button
            type="button"
            onClick={openComments}
            className="flex flex-col items-center gap-1 group"
            title="Comments"
            aria-label={`Comments (${commentTotal})`}
          >
            <div
              className="w-10 h-10 backdrop-blur-md bg-black/50 group-hover:bg-black/70
                rounded-full flex items-center justify-center transition-colors"
            >
              <ChatBubbleLeftIcon className="w-5 h-5 text-white group-hover:text-brand-red transition-colors" />
            </div>
            <span className="text-white text-xs font-bold">{commentTotal}</span>
          </button>
          
          {/* Up button - Always enabled for previous ✅ */}
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white 
              disabled:opacity-30 disabled:cursor-not-allowed
              hover:bg-black/70 transition-all"
            title="Previous short"
          >
            <ChevronUpIcon className="w-5 h-5" />
          </button>
          
          {/* Down button - Next */}
          <button
            onClick={goNext}
            disabled={currentIndex === shorts.length - 1}
            className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white 
              disabled:opacity-30 disabled:cursor-not-allowed
              hover:bg-black/70 transition-all"
            title="Next short"
          >
            <ChevronDownIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Comments sheet — a sibling of the feed, so nothing about playback
          is touched: the short keeps running behind it. */}
      {commentsOpen && (
        <ShortsCommentsSheet
          videoId={current.videoId}
          onClose={() => setCommentsOpen(false)}
          onCountChange={(count) => handleCommentCount(current.videoId, count)}
        />
      )}
    </div>
  );
}

export default function ShortsPage() {
  // The feed is a fixed, full-viewport surface, but the document could still
  // be scrolled (residual offset from the previous route, safe-area padding,
  // mobile URL-bar resizing) which shifted the frame and pushed the like rail
  // and the subscribe row off screen.
  useEffect(() => {
    const { body, documentElement: html } = document;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevScrollBehavior = html.style.scrollBehavior;

    html.style.scrollBehavior = 'auto';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    // Arriving from another page can leave a scroll offset behind.
    if (window.scrollY > 0) window.scrollTo(0, 0);

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      html.style.scrollBehavior = prevScrollBehavior;
    };
  }, []);

  return (
    <AuthGuard requireUsername={false}>
      <ShortsContent />
    </AuthGuard>
  );
}
