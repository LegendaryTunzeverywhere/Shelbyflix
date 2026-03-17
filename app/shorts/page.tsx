'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import VideoPlayer from '@/components/VideoPlayer';
import EngagementBar from '@/components/EngagementBar';
import SubscribeButton from '@/components/SubscribeButton';
import { getShortVideos } from '@/lib/metadata-store';
import { useWallet } from '@/hooks/useWallet';
import type { VideoMetadata } from '@/types';
import { 
  ChevronUpIcon, 
  ChevronDownIcon,
  EyeIcon,
  ChatBubbleLeftIcon 
} from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';

export default function ShortsPage() {
  const router = useRouter();
    const { address } = useWallet();
  const [shorts, setShorts] = useState<VideoMetadata[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    loadShorts();
  }, []);

  const loadShorts = () => {
    const shortVideos = getShortVideos();
    setShorts(shortVideos);
  };

  const handleNext = () => {
    if (currentIndex < shorts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') handlePrevious();
      if (e.key === 'ArrowDown') handleNext();
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentIndex, shorts.length]);

  if (shorts.length === 0) {
    return (
      <div className="min-h-screen bg-brand-dark">
        <Header />
        <main className="flex items-center justify-center h-[80vh]">
          <div className="text-center">
            <h2 className="text-3xl font-black text-white mb-4 tracking-tighter">
              NO SHORTS YET
            </h2>
            <p className="text-zinc-500 font-medium mb-8">
              Upload videos under 60 seconds to see them here
            </p>
            <button
              onClick={() => router.push('/upload')}
              className="px-8 py-4 bg-brand-red hover:bg-brand-red/90 text-white rounded-2xl font-black text-sm tracking-widest transition-colors"
            >
              UPLOAD SHORT
            </button>
          </div>
        </main>
      </div>
    );
  }

  const currentShort = shorts[currentIndex];

  return (
    <div className="min-h-screen bg-black">
      <Header />

      <main className="relative h-[calc(100vh-80px)] flex items-center justify-center overflow-hidden">
        {/* Video Container */}
        <div className="relative max-w-[500px] w-full h-full bg-black">
          {/* Video Player */}
          <div className="absolute inset-0">
            <VideoPlayer
              video={currentShort}
              walletAddress={address || ''}
              hasAccess={true}
            />
          </div>

          {/* Overlay Info */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Top Gradient */}
            <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
            
            {/* Bottom Info */}
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 via-black/50 to-transparent pointer-events-auto">
              {/* Channel Info */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-brand-purple to-brand-red rounded-full flex items-center justify-center text-white font-black">
                  {currentShort.channelName.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-white font-bold text-sm">
                    {currentShort.channelName}
                  </p>
                  <p className="text-zinc-400 text-xs">
                    {formatDistanceToNow(currentShort.uploadTimestamp, { addSuffix: true })}
                  </p>
                </div>
                <SubscribeButton channelId={currentShort.channelId} />
              </div>

              {/* Title & Description */}
              <div className="mb-4">
                <h2 className="text-white font-black text-lg mb-1 line-clamp-2">
                  {currentShort.title}
                </h2>
                {currentShort.description && (
                  <p className="text-zinc-300 text-sm line-clamp-2">
                    {currentShort.description}
                  </p>
                )}
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-white text-sm mb-4">
                <div className="flex items-center gap-1">
                  <EyeIcon className="w-4 h-4" />
                  <span className="font-bold">{currentShort.views.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ChatBubbleLeftIcon className="w-4 h-4" />
                  <span className="font-bold">{currentShort.commentCount || 0}</span>
                </div>
              </div>

              {/* Engagement */}
              <EngagementBar videoId={currentShort.videoId} />
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-4 pointer-events-auto">
            <button
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className="w-12 h-12 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronUpIcon className="w-6 h-6" />
            </button>
            
            <button
              onClick={handleNext}
              disabled={currentIndex === shorts.length - 1}
              className="w-12 h-12 bg-black/50 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center text-white hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronDownIcon className="w-6 h-6" />
            </button>
          </div>

          {/* Progress Indicator */}
          <div className="absolute top-4 left-0 right-0 px-6 pointer-events-none">
            <div className="flex gap-1">
              {shorts.map((_, idx) => (
                <div
                  key={idx}
                  className={`flex-1 h-1 rounded-full transition-all ${
                    idx === currentIndex
                      ? 'bg-white'
                      : idx < currentIndex
                      ? 'bg-white/50'
                      : 'bg-white/20'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Side Info Panel (Desktop) */}
        <div className="hidden lg:block absolute right-8 top-1/2 -translate-y-1/2 w-80 space-y-4">
          <div className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 rounded-3xl p-6">
            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">
              UP NEXT
            </h3>
            <div className="space-y-3">
              {shorts.slice(currentIndex + 1, currentIndex + 4).map((short, idx) => (
                <div
                  key={short.videoId}
                  onClick={() => setCurrentIndex(currentIndex + idx + 1)}
                  className="flex gap-3 cursor-pointer group"
                >
                  <div className="relative w-20 aspect-[9/16] bg-zinc-800 rounded-xl overflow-hidden flex-shrink-0">
                    {short.thumbnailUrl ? (
                      <img
                        src={short.thumbnailUrl}
                        alt={short.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <EyeIcon className="w-6 h-6 text-zinc-600" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-bold line-clamp-2 group-hover:text-brand-red transition-colors">
                      {short.title}
                    </p>
                    <p className="text-zinc-500 text-xs mt-1">
                      {short.views.toLocaleString()} views
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}