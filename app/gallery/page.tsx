'use client';

import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import VideoCard from '@/components/VideoCard';
import { getAllVideosFromChain } from '@/lib/contract';
import { useTokenAccess } from '@/hooks/useTokenAccess';
import type { VideoMetadata, GalleryFilters } from '@/types';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export default function GalleryPage() {
  const { hasAccess } = useTokenAccess();
  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [filteredVideos, setFilteredVideos] = useState<VideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<GalleryFilters>({
    search: '',
    sortBy: 'newest',
  });

  useEffect(() => {
    loadVideos();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [videos, filters]);

  async function loadVideos() {
    try {
      setLoading(true);
      const allVideos = await getAllVideosFromChain();
      setVideos(allVideos);
    } catch (error) {
      console.error('Error loading videos:', error);
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    let result = [...videos];

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter(
        (video) =>
          video.title.toLowerCase().includes(searchLower) ||
          video.description.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'newest':
          return b.timestamp - a.timestamp;
        case 'oldest':
          return a.timestamp - b.timestamp;
        case 'popular':
          return (b.views || 0) - (a.views || 0);
        default:
          return 0;
      }
    });

    setFilteredVideos(result);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 
                border-primary-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading videos...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Video Gallery</h1>
          <p className="text-gray-600">
            {videos.length} {videos.length === 1 ? 'video' : 'videos'} available
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-8 flex flex-col md:flex-row 
          gap-4 items-stretch md:items-center">
          {/* Search */}
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 
              w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="Search videos..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg 
                focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Sort by:
            </label>
            <select
              value={filters.sortBy}
              onChange={(e) =>
                setFilters({ ...filters, sortBy: e.target.value as any })
              }
              className="px-4 py-2 border border-gray-300 rounded-lg 
                focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="popular">Most Popular</option>
            </select>
          </div>
        </div>

        {/* Video Grid */}
        {filteredVideos.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 text-lg mb-4">
              {filters.search
                ? 'No videos found matching your search.'
                : 'No videos yet. Be the first to upload!'}
            </p>
            {filters.search && (
              <button
                onClick={() => setFilters({ ...filters, search: '' })}
                className="text-primary-600 hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredVideos.map((video) => (
              <VideoCard key={video.videoId} video={video} hasAccess={hasAccess} />
            ))}
          </div>
        )}

        {/* Access Notice */}
        {!hasAccess && videos.length > 0 && (
          <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-6 
            text-center">
            <p className="text-yellow-800 font-medium mb-2">
              🔒 Some videos are locked
            </p>
            <p className="text-yellow-700 text-sm">
              Connect a wallet with Shelby Faucet tokens to unlock all videos
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
