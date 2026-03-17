'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import VideoCard from '@/components/VideoCard';
import { 
  getAllVideos, 
  searchVideos, 
  getVideosByCategory,
  getTrendingVideos,
  getRecentVideos 
} from '@/lib/metadata-store';
import type { VideoMetadata, VideoCategory } from '@/types';
import { 
  MagnifyingGlassIcon, 
  FunnelIcon,
  SparklesIcon,
  ClockIcon,
  FireIcon,
  VideoCameraIcon,
  XMarkIcon 
} from '@heroicons/react/24/outline';

type SortOption = 'recent' | 'trending' | 'views' | 'oldest';

export default function GalleryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [allVideos, setAllVideos] = useState<VideoMetadata[]>([]);
  const [filteredVideos, setFilteredVideos] = useState<VideoMetadata[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [showShorts, setShowShorts] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    loadVideos();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [allVideos, searchQuery, selectedCategory, sortBy, showShorts]);

  const loadVideos = () => {
    const videos = getAllVideos();
    setAllVideos(videos);
  };

  const applyFilters = () => {
    let videos = [...allVideos];

    // Search filter
    if (searchQuery.trim()) {
      videos = searchVideos(searchQuery);
    }

    // Category filter
    if (selectedCategory !== 'all') {
      videos = videos.filter(v => v.category === selectedCategory);
    }

    // Shorts filter
    if (showShorts) {
      videos = videos.filter(v => v.isShort);
    }

    // Sort
    switch (sortBy) {
      case 'trending':
        videos = videos.sort((a, b) => b.views - a.views);
        break;
      case 'views':
        videos = videos.sort((a, b) => b.views - a.views);
        break;
      case 'recent':
        videos = videos.sort((a, b) => b.uploadTimestamp - a.uploadTimestamp);
        break;
      case 'oldest':
        videos = videos.sort((a, b) => a.uploadTimestamp - b.uploadTimestamp);
        break;
    }

    setFilteredVideos(videos);
  };

  const categories = [
    { value: 'all', label: 'ALL', icon: SparklesIcon },
    { value: 'Entertainment', label: 'ENTERTAINMENT', icon: VideoCameraIcon },
    { value: 'Education', label: 'EDUCATION', icon: SparklesIcon },
    { value: 'Gaming', label: 'GAMING', icon: VideoCameraIcon },
    { value: 'Music', label: 'MUSIC', icon: SparklesIcon },
    { value: 'Sports', label: 'SPORTS', icon: VideoCameraIcon },
    { value: 'News', label: 'NEWS', icon: SparklesIcon },
    { value: 'Technology', label: 'TECH', icon: VideoCameraIcon },
    { value: 'Lifestyle', label: 'LIFESTYLE', icon: SparklesIcon },
    { value: 'Comedy', label: 'COMEDY', icon: VideoCameraIcon },
  ];

  const sortOptions = [
    { value: 'recent', label: 'LATEST', icon: ClockIcon },
    { value: 'trending', label: 'TRENDING', icon: FireIcon },
    { value: 'views', label: 'MOST VIEWED', icon: FireIcon },
    { value: 'oldest', label: 'OLDEST', icon: ClockIcon },
  ];

  return (
    <div className="min-h-screen bg-brand-dark">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-5xl font-black tracking-tighter text-white mb-2">
                VIDEO <span className="text-brand-red">ARCHIVE</span>
              </h1>
              <p className="text-zinc-500 font-medium">
                {filteredVideos.length} {filteredVideos.length === 1 ? 'transmission' : 'transmissions'} available
              </p>
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className="lg:hidden px-6 py-3 bg-zinc-900/50 border border-zinc-800 text-white rounded-2xl font-black text-sm flex items-center gap-2 hover:bg-zinc-800 transition-colors"
            >
              <FunnelIcon className="w-5 h-5" />
              FILTERS
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search videos, tags, or channels..."
              className="w-full pl-14 pr-12 py-5 bg-zinc-900/50 border border-zinc-800 rounded-[24px] text-white placeholder-zinc-600 focus:ring-2 focus:ring-brand-red focus:border-transparent font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-6 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Filters - Desktop */}
        <div className={`mb-8 space-y-6 ${showFilters ? 'block' : 'hidden lg:block'}`}>
          {/* Categories */}
          <div>
            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mb-4">
              CATEGORIES
            </h3>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setSelectedCategory(cat.value)}
                  className={`px-6 py-3 rounded-2xl font-black text-xs tracking-widest transition-all ${
                    selectedCategory === cat.value
                      ? 'bg-brand-red text-white shadow-[0_0_20px_rgba(246,27,46,0.3)]'
                      : 'bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 border border-zinc-800'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort & Filters */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Sort Options */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                SORT BY:
              </span>
              {sortOptions.map((sort) => (
                <button
                  key={sort.value}
                  onClick={() => setSortBy(sort.value as SortOption)}
                  className={`px-5 py-2.5 rounded-xl font-black text-xs tracking-widest transition-all ${
                    sortBy === sort.value
                      ? 'bg-white text-black'
                      : 'bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 border border-zinc-800'
                  }`}
                >
                  {sort.label}
                </button>
              ))}
            </div>

            {/* Shorts Toggle */}
            <button
              onClick={() => setShowShorts(!showShorts)}
              className={`ml-auto px-6 py-3 rounded-2xl font-black text-xs tracking-widest transition-all ${
                showShorts
                  ? 'bg-brand-purple text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]'
                  : 'bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 border border-zinc-800'
              }`}
            >
              <VideoCameraIcon className="w-4 h-4 inline mr-2" />
              {showShorts ? 'SHOWING SHORTS' : 'SHORTS ONLY'}
            </button>
          </div>
        </div>

        {/* Videos Grid */}
        {filteredVideos.length > 0 ? (
          <div className={`grid gap-6 ${
            showShorts 
              ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' 
              : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
          }`}>
            {filteredVideos.map((video) => (
              showShorts ? (
                // Shorts Card (Vertical)
                <div
                  key={video.videoId}
                  onClick={() => router.push(`/video/${video.videoId}`)}
                  className="cursor-pointer group"
                >
                  <div className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-zinc-900/50 border border-zinc-800 group-hover:border-brand-purple transition-all">
                    {video.thumbnailUrl ? (
                      <img
                        src={video.thumbnailUrl}
                        alt={video.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <VideoCameraIcon className="w-12 h-12 text-zinc-700" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <p className="text-white text-sm font-bold line-clamp-2 mb-1">
                        {video.title}
                      </p>
                      <p className="text-zinc-300 text-xs">
                        {video.views.toLocaleString()} views
                      </p>
                    </div>
                    <div className="absolute top-3 right-3 px-2 py-1 bg-brand-purple rounded-lg text-white text-[10px] font-black">
                      SHORT
                    </div>
                  </div>
                </div>
              ) : (
                // Regular Card (Horizontal)
                <VideoCard key={video.videoId} video={video} />
              )
            ))}
          </div>
        ) : (
          // Empty State
          <div className="text-center py-20">
            <div className="w-24 h-24 bg-zinc-900/50 rounded-[32px] border border-zinc-800 flex items-center justify-center mx-auto mb-6">
              <MagnifyingGlassIcon className="w-12 h-12 text-zinc-700" />
            </div>
            <h2 className="text-2xl font-black text-white mb-2 tracking-tighter">
              NO RESULTS FOUND
            </h2>
            <p className="text-zinc-500 font-medium mb-8 max-w-md mx-auto">
              {searchQuery 
                ? `No videos found for "${searchQuery}". Try different keywords.`
                : 'No videos match your current filters. Try adjusting your selection.'}
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
                setShowShorts(false);
              }}
              className="px-8 py-4 bg-brand-red hover:bg-brand-red/90 text-white rounded-2xl font-black text-sm tracking-widest transition-colors"
            >
              CLEAR FILTERS
            </button>
          </div>
        )}
      </main>
    </div>
  );
}