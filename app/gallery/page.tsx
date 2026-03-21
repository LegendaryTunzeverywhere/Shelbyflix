'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import AuthGuard from '@/components/AuthGuard';
import VideoCard from '@/components/VideoCard';
import type { VideoMetadata } from '@/types';
import { MagnifyingGlassIcon, FunnelIcon } from '@heroicons/react/24/outline';

const CATEGORIES = ['All', 'Music', 'Gaming', 'Education', 'Entertainment', 'Sports', 'Technology', 'Other'];

function GalleryContent() {
  const router = useRouter();
  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [filteredVideos, setFilteredVideos] = useState<VideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'popular' | 'oldest'>('recent');

  useEffect(() => {
    loadVideos();
  }, []);

  async function loadVideos() {
    try {
      const { getAllVideos } = await import('@/lib/video-service');
      const allVideos = await getAllVideos();
      
      // Filter out shorts (duration < 60 seconds)
      const regularVideos = allVideos.filter(v => 
        v.videoType !== 'short' && !v.isShort && v.duration >= 60
      );
      
      setVideos(regularVideos);
      setFilteredVideos(regularVideos);
    } catch (error) {
      console.error('Failed to load videos:', error);
    } finally {
      setLoading(false);
    }
  }

  // Apply filters whenever videos, category, search, or sort changes
  useEffect(() => {
    let result = [...videos];

    // Filter by category
    if (selectedCategory !== 'All') {
      result = result.filter(v => v.category === selectedCategory);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(v =>
        v.title.toLowerCase().includes(query) ||
        v.description?.toLowerCase().includes(query) ||
        v.channelName.toLowerCase().includes(query) ||
        v.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // Sort
    if (sortBy === 'recent') {
      result.sort((a, b) => b.uploadTimestamp - a.uploadTimestamp);
    } else if (sortBy === 'popular') {
      result.sort((a, b) => b.views - a.views);
    } else if (sortBy === 'oldest') {
      result.sort((a, b) => a.uploadTimestamp - b.uploadTimestamp);
    }

    setFilteredVideos(result);
  }, [videos, selectedCategory, searchQuery, sortBy]);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-dark">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-[60vh]">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-zinc-700 border-t-brand-red rounded-full animate-spin mx-auto mb-4" />
              <p className="text-zinc-500">Loading videos...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-dark">
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">Video Gallery</h1>
          <p className="text-zinc-500">Browse all videos</p>
        </div>

        {/* Filters */}
        <div className="mb-6 space-y-4">
          {/* Search bar */}
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search videos, channels, tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder:text-zinc-500 focus:outline-none focus:border-brand-red transition-colors"
            />
          </div>

          {/* Category tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-all ${
                  selectedCategory === category
                    ? 'bg-brand-red text-white'
                    : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          {/* Sort options */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-500">
              {filteredVideos.length} {filteredVideos.length === 1 ? 'video' : 'videos'}
            </p>
            <div className="flex items-center gap-2">
              <FunnelIcon className="w-4 h-4 text-zinc-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand-red cursor-pointer"
              >
                <option value="recent">Most Recent</option>
                <option value="popular">Most Popular</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>
          </div>
        </div>

        {/* Videos grid */}
        {filteredVideos.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {filteredVideos.map((video) => (
              <VideoCard key={video.videoId} video={video} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <MagnifyingGlassIcon className="w-10 h-10 text-zinc-600" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">No videos found</h3>
            <p className="text-zinc-500 mb-6">
              {searchQuery
                ? `No results for "${searchQuery}"`
                : selectedCategory !== 'All'
                ? `No videos in ${selectedCategory} category`
                : 'No videos available'}
            </p>
            {searchQuery || selectedCategory !== 'All' ? (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                }}
                className="px-6 py-3 bg-brand-red text-white rounded-xl font-bold hover:bg-brand-red/90 transition-colors"
              >
                Clear Filters
              </button>
            ) : (
              <button
                onClick={() => router.push('/upload')}
                className="px-6 py-3 bg-brand-red text-white rounded-xl font-bold hover:bg-brand-red/90 transition-colors"
              >
                Upload First Video
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function GalleryPage() {
  return (
    <AuthGuard requireUsername={true}>
      <GalleryContent />
    </AuthGuard>
  );
}