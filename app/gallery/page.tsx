'use client';

import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import VideoCard from '@/components/VideoCard';
import { getAllVideosFromChain } from '@/lib/contract';
 
import type { VideoMetadata, GalleryFilters } from '@/types';
import { MagnifyingGlassIcon, AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';

export default function GalleryPage() {
  const { hasAccess } =  
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
      <div className="min-h-screen bg-brand-dark">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="flex flex-col items-center justify-center h-64">
            <div className="relative">
              <div className="absolute inset-0 bg-brand-red blur-xl opacity-20 animate-pulse"></div>
              <div className="relative animate-spin rounded-full h-16 w-16 border-t-2 border-brand-red"></div>
            </div>
            <p className="text-zinc-500 mt-8 font-black uppercase tracking-widest text-sm">Initializing Gallery</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-dark text-white">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Page Header */}
        <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-brand-red animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Live Library</span>
            </div>
            <h1 className="text-5xl font-black tracking-tighter">THE <span className="text-brand-red">VAULT</span></h1>
          </div>
          <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs bg-zinc-900 px-4 py-2 rounded-full border border-zinc-800">
            {videos.length} <span className="text-white">{videos.length === 1 ? 'OBJECT' : 'OBJECTS'}</span> DISCOVERED
          </p>
        </div>

        {/* Filters */}
        <div className="bg-zinc-900/50 backdrop-blur-md rounded-[24px] border border-zinc-800 p-3 mb-12 flex flex-col md:flex-row gap-3 items-stretch">
          {/* Search */}
          <div className="flex-1 relative group">
            <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 
              w-5 h-5 text-zinc-600 group-focus-within:text-brand-pink transition-colors" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              placeholder="SEARCH THE VOID..."
              className="w-full bg-black/40 border-none rounded-[16px] pl-12 pr-4 py-4 text-sm font-bold uppercase tracking-widest 
                focus:ring-1 focus:ring-zinc-700 transition-all placeholder:text-zinc-700 text-white"
            />
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2 bg-black/40 rounded-[16px] px-4 border border-zinc-800/50">
            <AdjustmentsHorizontalIcon className="w-5 h-5 text-zinc-600" />
            <select
              value={filters.sortBy}
              onChange={(e) =>
                setFilters({ ...filters, sortBy: e.target.value as any })
              }
              className="bg-transparent border-none text-xs font-black uppercase tracking-widest py-4 focus:ring-0 text-zinc-400 cursor-pointer hover:text-white transition-colors"
            >
              <option value="newest" className="bg-zinc-900">Newest</option>
              <option value="oldest" className="bg-zinc-900">Oldest</option>
              <option value="popular" className="bg-zinc-900">Popular</option>
            </select>
          </div>
        </div>

        {/* Video Grid */}
        {filteredVideos.length === 0 ? (
          <div className="text-center py-32 bg-zinc-900/20 rounded-[40px] border border-dashed border-zinc-800">
            <p className="text-zinc-600 font-black uppercase tracking-[0.2em] mb-6">
              {filters.search
                ? 'NO DATA MATCHES THE QUERY'
                : 'THE VAULT IS CURRENTLY EMPTY'}
            </p>
            {filters.search && (
              <button
                onClick={() => setFilters({ ...filters, search: '' })}
                className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
              >
                RESET SCAN
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredVideos.map((video) => (
              <VideoCard key={video.videoId} video={video} hasAccess={hasAccess} />
            ))}
          </div>
        )}

        {/* Access Notice */}
        {!hasAccess && videos.length > 0 && (
          <div className="mt-20 relative group overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-brand-purple to-brand-red opacity-10 group-hover:opacity-20 transition-opacity"></div>
            <div className="relative bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-[32px] p-10 flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="text-center md:text-left">
                <h3 className="text-2xl font-black tracking-tighter mb-2">SECURE CONTENT DETECTED</h3>
                <p className="text-zinc-500 font-medium max-w-md">
                  Some archives are locked behind token-gated encryption. Use Shelby Faucet tokens to gain full administrative access.
                </p>
              </div>
              <a
                href="https://docs.shelby.xyz/apis/faucet/shelbyusd"
                target="_blank"
                rel="noopener noreferrer"
                className="px-10 py-5 bg-white text-black rounded-2xl font-black text-sm tracking-widest hover:bg-zinc-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]"
              >
                AUTHORIZE ACCESS
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
