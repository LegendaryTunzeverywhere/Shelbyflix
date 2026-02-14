'use client';

import React, { useState, useEffect } from 'react';
import ReactPlayer from 'react-player';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import type { VideoMetadata } from '@/types';
import { getVideoStreamUrl } from '@/lib/shelby';
import { checkVideoAccess, purchaseVideo } from '@/lib/contract';
import { 
  LockClosedIcon,
  ExclamationCircleIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';

interface VideoPlayerProps {
  video: VideoMetadata;
  walletAddress: string;
  hasAccess: boolean; // This refers to the general token requirement
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ video, walletAddress, hasAccess: hasGeneralAccess }) => {
  const { signAndSubmitTransaction, connected } = useWallet();
  const [hasPurchased, setHasPurchased] = useState<boolean>(false);
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkAccess();
  }, [video.videoId, walletAddress, hasGeneralAccess]);

  async function checkAccess() {
    if (!hasGeneralAccess) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const access = await checkVideoAccess(video.videoId, walletAddress);
      setHasPurchased(access);
      
      if (access) {
        await loadVideoStream();
      }
    } catch (err) {
      setError('Failed to check video access');
    } finally {
      setLoading(false);
    }
  }

  async function loadVideoStream() {
    try {
      const url = await getVideoStreamUrl(video.videoId, walletAddress);
      setStreamUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
    }
  }

  async function handlePurchase() {
    if (!connected || !walletAddress) {
      setError('Please connect your wallet first');
      return;
    }

    try {
      setPurchasing(true);
      setError(null);
      await purchaseVideo(walletAddress, signAndSubmitTransaction, video.videoId);
      setHasPurchased(true);
      await loadVideoStream();
    } catch (err) {
      console.error('Purchase error:', err);
      setError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setPurchasing(false);
    }
  }

  // No general access (ShelbyUSD requirement)
  if (!hasGeneralAccess) {
    return (
      <div className="aspect-video bg-gradient-to-br from-gray-900 to-gray-800 
        rounded-xl flex flex-col items-center justify-center text-white p-8 text-center">
        <LockClosedIcon className="w-20 h-20 mb-4 text-gray-400" />
        <h3 className="text-2xl font-bold mb-2">General Access Locked</h3>
        <p className="text-gray-400 max-w-md mb-6">
          You need to hold Shelby Faucet tokens to use this platform.
        </p>
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
    );
  }

  // Not purchased yet
  if (!hasPurchased && !loading) {
    return (
      <div className="aspect-video bg-gradient-to-br from-gray-900 to-gray-800 
        rounded-xl flex flex-col items-center justify-center text-white p-8 text-center">
        <CurrencyDollarIcon className="w-20 h-20 mb-4 text-primary-400" />
        <h3 className="text-2xl font-bold mb-2">Unlock Video</h3>
        <p className="text-gray-400 max-w-md mb-6">
          Viewing Price: <span className="text-white font-bold">{((video.price || 0) / 100000000).toFixed(4)} ShelbyUSD</span>
        </p>
        <button
          onClick={handlePurchase}
          disabled={purchasing}
          className="px-8 py-4 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-600 
            rounded-lg font-bold transition-all transform hover:scale-105"
        >
          {purchasing ? (
            <div className="flex items-center gap-2">
              <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              Processing...
            </div>
          ) : (
            `Pay to Unlock`
          )}
        </button>
        {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
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
          <p className="text-gray-600">Checking access...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && hasPurchased) {
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
      {streamUrl ? (
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
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white">
          Preparing stream...
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
