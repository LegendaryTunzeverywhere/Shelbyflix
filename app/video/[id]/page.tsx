'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import Header from '@/components/Header';
import VideoPlayer from '@/components/VideoPlayer';
import { useWallet } from '@/hooks/useWallet';
import { useTokenAccess } from '@/hooks/useTokenAccess';
import { getVideoMetadata, deleteVideoFromChain } from '@/lib/contract';
import { deleteVideoBlob } from '@/lib/shelby-sdk';
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
} from '@heroicons/react/24/outline';

export default function VideoPage() {
  const params = useParams();
  const router = useRouter();
  const { address, signAndSubmitTransaction } = useWallet();
  const { hasAccess } = useTokenAccess();
  
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
      await deleteVideoBlob(blobId, address);

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
    // In a real app, we'd fetch the blob and trigger a download.
    // For now, we'll open the streaming URL in a new tab which allows "Save Video As"
    const blobId = video.shelbyUrl.replace('shelby://', '');
    window.open(`https://api.shelbynet.shelby.xyz/v1/blob/download/${blobId}?uploader=${video.uploader}`, '_blank');
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
              <p className="text-gray-600">Loading video...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Video Not Found
            </h1>
            <p className="text-gray-600 mb-6">
              The video you're looking for doesn't exist or has been removed.
            </p>
            <button
              onClick={() => router.push('/gallery')}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 
                hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
            >
              <ArrowLeftIcon className="w-5 h-5" />
              Back to Gallery
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back Button */}
        <button
          onClick={() => router.push('/gallery')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 
            mb-6 transition-colors"
        >
          <ArrowLeftIcon className="w-5 h-5" />
          <span className="font-medium">Back to Gallery</span>
        </button>

        {/* Video Player */}
        <div className="mb-8">
          <VideoPlayer
            video={video}
            walletAddress={address || ''}
            hasAccess={hasAccess}
          />
        </div>

        {/* Video Info */}
        <div className="bg-white rounded-xl shadow-sm p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between 
            gap-4 mb-6">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900 mb-3">
                {video.title}
              </h1>
              
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <ClockIcon className="w-4 h-4" />
                  <span>
                    {formatDistanceToNow(video.timestamp, { addSuffix: true })}
                  </span>
                </div>
                
                {video.views !== undefined && (
                  <div className="flex items-center gap-1">
                    <EyeIcon className="w-4 h-4" />
                    <span>{video.views.toLocaleString()} views</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {hasAccess && (
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-50 
                    text-primary-700 hover:bg-primary-100 rounded-lg font-medium 
                    transition-colors whitespace-nowrap"
                >
                  <ArrowDownTrayIcon className="w-5 h-5" />
                  <span>Download</span>
                </button>
              )}

              <button
                onClick={handleShare}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 
                  hover:bg-gray-200 rounded-lg font-medium transition-colors 
                  whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <CheckIcon className="w-5 h-5 text-green-600" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <ShareIcon className="w-5 h-5" />
                    <span>Share</span>
                  </>
                )}
              </button>

              {address?.toLowerCase() === video.uploader.toLowerCase() && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-50 
                    text-red-600 hover:bg-red-100 rounded-lg font-medium 
                    transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <TrashIcon className="w-5 h-5" />
                  <span>{deleting ? 'Deleting...' : 'Delete'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Description */}
          {video.description && (
            <div className="mb-6 pb-6 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-2">Description</h3>
              <p className="text-gray-700 whitespace-pre-wrap">{video.description}</p>
            </div>
          )}

          {/* Uploader Info */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Uploader</h3>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-purple-500 
                rounded-full flex items-center justify-center text-white font-bold">
                {video.uploader.slice(2, 4).toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  {formatAddress(video.uploader)}
                </p>
                <p className="text-sm text-gray-500 font-mono break-all">
                  {video.uploader}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Token Requirement Notice */}
        {!hasAccess && (
          <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <h3 className="font-semibold text-yellow-900 mb-2">
              🔒 Token Required
            </h3>
            <p className="text-yellow-800 text-sm mb-4">
              This video requires Shelby Faucet tokens to watch. Connect a wallet 
              with the required tokens to unlock access.
            </p>
            <a
              href="https://docs.shelby.xyz/apis/faucet/shelbyusd"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-600 
                hover:bg-yellow-700 text-white rounded-lg font-medium 
                transition-colors text-sm"
            >
              Get Test Tokens
              <ArrowLeftIcon className="w-4 h-4 rotate-180" />
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
