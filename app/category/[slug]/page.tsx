'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import VideoCard from '@/components/VideoCard';
import { getVideosByCategory } from '@/lib/metadata-store';
import type { VideoMetadata, VideoCategory } from '@/types';
import { ArrowLeftIcon, VideoCameraIcon } from '@heroicons/react/24/outline';

export default function CategoryPage() {
  const params = useParams();
  const router = useRouter();
  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  const category = decodeURIComponent(params.slug as string);

  useEffect(() => {
    loadCategoryVideos();
  }, [category]);

  const loadCategoryVideos = () => {
    setLoading(true);
    const categoryVideos = getVideosByCategory(category);
    setVideos(categoryVideos);
    setLoading(false);
  };

  const categoryIcons: Record<string, string> = {
    Entertainment: '🎬',
    Education: '📚',
    Gaming: '🎮',
    Music: '🎵',
    Sports: '⚽',
    News: '📰',
    Technology: '💻',
    Lifestyle: '✨',
    Comedy: '😂',
  };

  return (
    <div className="min-h-screen bg-brand-dark">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back Button */}
        <button
          onClick={() => router.push('/gallery')}
          className="flex items-center gap-2 text-zinc-500 hover:text-white mb-8 transition-all font-black text-xs uppercase tracking-widest group"
        >
          <ArrowLeftIcon className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          BACK TO GALLERY
        </button>

        {/* Category Header */}
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-brand-purple to-brand-red rounded-[24px] flex items-center justify-center text-4xl">
              {categoryIcons[category] || '📁'}
            </div>
            <div>
              <h1 className="text-5xl font-black tracking-tighter text-white">
                {category.toUpperCase()}
              </h1>
              <p className="text-zinc-500 font-medium mt-1">
                {videos.length} {videos.length === 1 ? 'video' : 'videos'} in this category
              </p>
            </div>
          </div>
        </div>

        {/* Videos Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-16 h-16 border-4 border-brand-red border-t-transparent rounded-full animate-spin" />
          </div>
        ) : videos.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {videos.map((video) => (
              <VideoCard key={video.videoId} video={video} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <VideoCameraIcon className="w-24 h-24 text-zinc-800 mx-auto mb-6" />
            <h2 className="text-2xl font-black text-white mb-2 tracking-tighter">
              NO VIDEOS YET
            </h2>
            <p className="text-zinc-500 font-medium mb-8 max-w-md mx-auto">
              No videos have been uploaded to the {category} category yet.
            </p>
            <button
              onClick={() => router.push('/upload')}
              className="px-8 py-4 bg-brand-red hover:bg-brand-red/90 text-white rounded-2xl font-black text-sm tracking-widest transition-colors"
            >
              UPLOAD VIDEO
            </button>
          </div>
        )}
      </main>
    </div>
  );
}