'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import Header from '@/components/Header';
import VideoPlayer from '@/components/VideoPlayer';
import { useWallet } from '@/hooks/useWallet';
 
import { getVideoMetadata, deleteVideoFromChain } from '@/lib/aptos';
import { deleteFromShelby } from '@/lib/shelby';
import { formatAddress } from '@/lib/aptos';
import type { VideoMetadata } from '@/types';
import {
  ArrowLeftIcon,
  ShareIcon,
  EyeIcon,
  ClockIcon,
  CheckIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

export default function VideoPage() {
  const params = useParams();
  const router = useRouter();
  const { address, signAndSubmitTransaction } = useWallet();
  const hasAccess = true; // Fee-based access, not token-gated
  
  const [video, setVideo] = useState<VideoMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const videoId = params.id as string;

  useEffect(() => {
    loadVideo();
  }, [videoId]);

  async function loadVideo() {
    try {
      setLoading(true);
      const metadata = await getVideoMetadata(videoId);
      setVideo(metadata);
    } catch (error) {
      console.error('Error loading video:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }

  async function handleDelete() {
    if (!video || !address || !signAndSubmitTransaction) return;
    if (!confirm('Are you sure you want to delete this video? This action cannot be undone.')) return;

    try {
      setDeleting(true);
      
      // 1. Delete from blockchain
      await deleteVideoFromChain(address, signAndSubmitTransaction, videoId);
      
      // 2. Delete from Shelby storage (best effort)
      const blobId = video.shelbyUrl.replace('shelby://', '');
      await deleteFromShelby(videoId, address);

      router.push('/gallery');
    } catch (error) {
      console.error('Error deleting video:', error);
      alert('Failed to delete video. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  function handleDownload() {
    if (!video || !hasAccess) return;
    const blobId = video.shelbyUrl.replace('shelby://', '');
    window.open(`https://api.shelbynet.shelby.xyz/v1/blob/download/${blobId}?uploader=${video.uploader}`, '_blank');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-dark">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-brand-red mx-auto mb-8"></div>
          <p className="text-zinc-500 font-black uppercase tracking-widest text-sm">Deciphering Archive</p>
        </main>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-brand-dark text-white">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="text-center bg-zinc-900/50 backdrop-blur-xl rounded-[40px] border border-zinc-800 p-20">
            <h1 className="text-4xl font-black tracking-tighter mb-4 uppercase">
              ARCHIVE <span className="text-brand-red">PURGED</span>
            </h1>
            <p className="text-zinc-500 font-medium mb-12 max-w-sm mx-auto">
              The data you are attempting to access has been permanently deleted from the network.
            </p>
            <button
              onClick={() => router.push('/gallery')}
              className="inline-flex items-center gap-2 px-10 py-5 bg-white text-black 
                rounded-2xl font-black text-xs tracking-widest transition-all hover:bg-zinc-200"
            >
              <ArrowLeftIcon className="w-5 h-5" />
              RETURN TO BASE
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-dark text-white">
      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back Button */}
        <button
          onClick={() => router.push('/gallery')}
          className="flex items-center gap-2 text-zinc-500 hover:text-white 
            mb-10 transition-all font-black text-[10px] uppercase tracking-[0.3em] group"
        >
          <ArrowLeftIcon className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span>Exit Vault</span>
        </button>

        {/* Video Player Section */}
        <div className="mb-12 rounded-[40px] overflow-hidden border border-zinc-800 bg-black shadow-2xl relative group">
          {!hasAccess && (
             <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                <div className="w-20 h-20 bg-brand-red/10 rounded-[32px] border border-brand-red/20 flex items-center justify-center mb-6">
                  <ShieldCheckIcon className="w-10 h-10 text-brand-red" />
                </div>
                <h2 className="text-2xl font-black tracking-tighter mb-2">ENCRYPTED STREAM</h2>
                <p className="text-zinc-500 font-medium mb-8">Access level insufficient</p>
                <a
                  href="https://docs.shelby.xyz/apis/faucet/shelbyusd"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-8 py-4 bg-brand-red text-white rounded-2xl font-black text-xs tracking-widest hover:bg-brand-red/90 transition-all"
                >
                  AUTHORIZE ACCESS
                </a>
             </div>
          )}
          <VideoPlayer
            video={video}
            walletAddress={address || ''}
            hasAccess={hasAccess}
          />
        </div>

        {/* Video Info Container */}
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-zinc-900/30 backdrop-blur-md rounded-[40px] border border-zinc-800 p-8 md:p-12">
              <div className="flex items-center gap-3 mb-6">
                 <div className="w-2 h-2 rounded-full bg-brand-pink" />
                 <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">Video Manifest</span>
              </div>
              
              <h1 className="text-4xl md:text-5xl font-black text-white mb-6 tracking-tighter leading-tight">
                {video.title}
              </h1>
              
              <div className="flex flex-wrap items-center gap-8 mb-10 pt-6 border-t border-zinc-800/50">
                <div className="flex items-center gap-2 text-zinc-400">
                  <ClockIcon className="w-4 h-4 text-brand-red" />
                  <span className="text-xs font-black uppercase tracking-widest">
                    {formatDistanceToNow(video.timestamp, { addSuffix: true })}
                  </span>
                </div>
                
                {video.views !== undefined && (
                  <div className="flex items-center gap-2 text-zinc-400">
                    <EyeIcon className="w-4 h-4 text-brand-purple" />
                    <span className="text-xs font-black uppercase tracking-widest">{video.views.toLocaleString()} ARCHIVED VIEWS</span>
                  </div>
                )}
              </div>

              {video.description && (
                <div className="bg-black/20 rounded-[32px] p-8 border border-zinc-800/50">
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">Transmission Data</h3>
                  <p className="text-zinc-400 font-medium leading-relaxed whitespace-pre-wrap">{video.description}</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {/* Actions Panel */}
            <div className="bg-zinc-900/30 backdrop-blur-md rounded-[40px] border border-zinc-800 p-8">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-6 text-center">Operations</h3>
              <div className="space-y-3">
                {hasAccess && (
                  <button
                    onClick={handleDownload}
                    className="w-full flex items-center justify-between px-6 py-4 bg-zinc-800/50 
                      text-white hover:bg-zinc-800 rounded-2xl font-black text-xs tracking-widest 
                      transition-all group border border-zinc-800/50"
                  >
                    <span>EXTRACT DATA</span>
                    <ArrowDownTrayIcon className="w-5 h-5 group-hover:translate-y-1 transition-transform" />
                  </button>
                )}

                <button
                  onClick={handleShare}
                  className="w-full flex items-center justify-between px-6 py-4 bg-zinc-800/50 
                    text-white hover:bg-zinc-800 rounded-2xl font-black text-xs tracking-widest 
                    transition-all group border border-zinc-800/50"
                >
                  <span>{copied ? 'LINK COPIED' : 'SHARE SIGNAL'}</span>
                  {copied ? (
                    <CheckIcon className="w-5 h-5 text-green-500" />
                  ) : (
                    <ShareIcon className="w-5 h-5 group-hover:-translate-y-1 group-hover:translate-x-1 transition-all" />
                  )}
                </button>

                {address?.toLowerCase() === video.uploader.toLowerCase() && (
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="w-full flex items-center justify-between px-6 py-4 bg-brand-red/10 
                      text-brand-red hover:bg-brand-red hover:text-white rounded-2xl font-black text-xs tracking-widest 
                      transition-all group border border-brand-red/20"
                  >
                    <span>{deleting ? 'PURGING...' : 'PURGE ARCHIVE'}</span>
                    <TrashIcon className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Uploader Card */}
            <div className="bg-zinc-900/30 backdrop-blur-md rounded-[40px] border border-zinc-800 p-8">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-6">Source Origin</h3>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-gradient-to-br from-brand-purple to-brand-red 
                  rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-brand-red/20">
                  {video.uploader.slice(2, 4).toUpperCase()}
                </div>
                <div className="overflow-hidden">
                  <p className="font-black text-white text-sm tracking-tight mb-1">
                    {formatAddress(video.uploader)}
                  </p>
                  <p className="text-[10px] text-zinc-500 font-mono truncate">
                    {video.uploader}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
