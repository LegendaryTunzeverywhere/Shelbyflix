'use client';

import React, { useState, useEffect } from 'react';
import ReactPlayer from 'react-player';
import type { VideoMetadata } from '@/types';
import { getVideoStreamUrl } from '@/lib/shelby';
import { 
  LockClosedIcon,
  ExclamationCircleIcon 
} from '@heroicons/react/24/outline';

interface VideoPlayerProps {
  video: VideoMetadata;
  walletAddress: string;
  hasAccess: boolean;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ video, walletAddress, hasAccess }) => {
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasAccess) {
      setLoading(false);
      return;
    }

    loadVideoStream();
  }, [video.videoId, walletAddress, hasAccess]);

  async function loadVideoStream() {
    try {
      setLoading(true);
      setError(null);

      const url = await getVideoStreamUrl(video.videoId, walletAddress);
      setStreamUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
    } finally {
      setLoading(false);
    }
  }

  // No access - show locked state
  if (!hasAccess) {
    return (
      <div className="aspect-video bg-gradient-to-br from-gray-900 to-gray-800 
        rounded-xl flex flex-col items-center justify-center text-white p-8">
        <LockClosedIcon className="w-20 h-20 mb-4 text-gray-400" />
        <h3 className="text-2xl font-bold mb-2">Content Locked</h3>
        <p className="text-gray-400 text-center max-w-md mb-6">
          You need to hold Shelby Faucet tokens to watch this video.
          Connect a wallet with the required tokens to unlock access.
        </p>
        <div className="flex gap-3">
          <a
            href="https://docs.shelby.xyz/apis/faucet/shelbyusd"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 bg-primary-600 hover:bg-primary-700 rounded-lg 
              font-medium transition-colors"
          >
            Get Test Tokens
          </a>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="aspect-video bg-gray-100 rounded-xl flex items-center 
        justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 
            border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading video...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="aspect-video bg-red-50 border-2 border-red-200 rounded-xl 
        flex flex-col items-center justify-center p-8">
        <ExclamationCircleIcon className="w-16 h-16 text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-red-900 mb-2">Error Loading Video</h3>
        <p className="text-red-700 text-center mb-4">{error}</p>
        <button
          onClick={loadVideoStream}
          className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg 
            font-medium transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Video player
  return (
    <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-2xl">
      <ReactPlayer
        url={streamUrl}
        controls
        width="100%"
        height="100%"
        playing={false}
        config={{
          file: {
            attributes: {
              controlsList: 'nodownload',
            },
          },
        }}
      />
    </div>
  );
};

export default VideoPlayer;
