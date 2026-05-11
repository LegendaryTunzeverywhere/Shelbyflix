'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import EngagementBar from '@/components/EngagementBar';
import SubscribeButton from '@/components/SubscribeButton';
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

function ShortPlayer({
  video,
  isActive,
  isMuted,
}: {
  video: VideoMetadata;
  isActive: boolean;
  isMuted: boolean;
}) {
  const [streamUrl, setStreamUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!isActive || loadedRef.current) return;
    loadedRef.current = true;

    (async () => {
      try {
        const { downloadAndDecryptVideo } = await import('@/lib/shelby');
        const blob = await downloadAndDecryptVideo(video.shelbyUrl, video.encryptionKey, video.blobName);
        const url = URL.createObjectURL(blob);
        setStreamUrl(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [isActive]);

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
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black">
          <p className="text-zinc-400 text-sm px-8 text-center">{error}</p>
        </div>
      )}
      {/* 9:16 container — video stays portrait on any screen */}
      <div className="relative h-full max-h-full aspect-[9/16] bg-black overflow-hidden">
        <video
          ref={videoRef}
          loop
          playsInline
          className="w-full h-full object-cover"
          onPlay={() => setIsPaused(false)}
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

  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

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
      if (e.key === 'ArrowDown') goNext();
      if (e.key === 'ArrowUp') goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

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
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
      </div>
    );
  }

  if (shorts.length === 0) {
    return (
      <div className="min-h-screen bg-black">
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

  return (
    <div className="h-screen bg-black overflow-hidden flex flex-col">
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
              <ShortPlayer video={short} isActive={idx === currentIndex} isMuted={isMuted} />
            </div>
          );
        })}

        {/* Info overlay */}
        <div className="absolute bottom-0 left-0 right-16 p-5 z-20 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none">
          <div className="flex items-center gap-3 mb-3 pointer-events-auto">
            <Link href={`/channel/${current.channelId}`}>
              <div className="w-10 h-10 bg-gradient-to-br from-brand-purple to-brand-red rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                {current.channelName.slice(0, 2).toUpperCase()}
              </div>
            </Link>
            <div className="flex-1 min-w-0">
              <p className="text-white font-black text-sm truncate">{current.channelName}</p>
              <p className="text-zinc-400 text-xs">{formatDistanceToNow(current.uploadTimestamp, { addSuffix: true })}</p>
            </div>
            <div className="pointer-events-auto">
              <SubscribeButton channelId={current.channelId} />
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
            <div className="flex items-center gap-1">
              <ChatBubbleLeftIcon className="w-3.5 h-3.5" />
              <span className="font-bold">{current.commentCount || 0}</span>
            </div>
          </div>
        </div>

        {/* Navigation controls */}
        <div className="absolute right-3 bottom-24 z-20 flex flex-col items-center gap-5">
          <EngagementBar videoId={current.videoId} vertical />
          
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
    </div>
  );
}

export default function ShortsPage() {
  return (
    <AuthGuard requireUsername={false}>
      <ShortsContent />
    </AuthGuard>
  );
}
