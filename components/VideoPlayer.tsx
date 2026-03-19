'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { VideoMetadata } from '../types';
import { ExclamationCircleIcon } from '@heroicons/react/24/outline';

interface VideoPlayerProps {
  video: VideoMetadata;
  walletAddress?: string;
  hasAccess?: boolean;   // kept for API compat, ignored — all videos are public
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  video,
  autoPlay = false,
  muted = false,
  className = '',
}) => {
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const objectUrlRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    loadVideoStream();

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      loadingRef.current = false;
    };
  }, [video.videoId]);

  useEffect(() => {
    if (streamUrl && videoRef.current) {
      videoRef.current.src = streamUrl;
      videoRef.current.load();
      if (autoPlay) {
        videoRef.current.play().catch(() => {
          // Autoplay may be blocked by browser — silent fail is fine
        });
      }
    }
  }, [streamUrl, autoPlay]);

  async function loadVideoStream() {
    if (loadingRef.current || objectUrlRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    try {
      const { downloadAndDecryptVideo } = await import('@/lib/shelby');
      const { incrementViews } = await import('@/lib/video-service');

      const decryptedBlob = await downloadAndDecryptVideo(
        video.shelbyUrl,
        video.encryptionKey,
        video.blobName
      );

      const url = URL.createObjectURL(decryptedBlob);
      objectUrlRef.current = url;
      setStreamUrl(url);

      incrementViews(video.videoId).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className={`aspect-video bg-zinc-950 rounded-xl flex items-center justify-center ${className}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-red mx-auto mb-3" />
          <p className="text-zinc-500 text-xs font-black uppercase tracking-widest">Decrypting stream...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`aspect-video bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col items-center justify-center p-8 ${className}`}>
        <ExclamationCircleIcon className="w-12 h-12 text-brand-red mb-3" />
        <p className="text-zinc-400 text-sm text-center mb-4">{error}</p>
        <button
          onClick={() => {
            setError(null);
            loadingRef.current = false;
            objectUrlRef.current = null;
            loadVideoStream();
          }}
          className="px-5 py-2 bg-brand-red text-white rounded-xl font-black text-xs tracking-widest hover:bg-brand-red/90 transition-colors"
        >
          RETRY
        </button>
      </div>
    );
  }

  return (
    <div className={`aspect-video bg-black rounded-xl overflow-hidden ${className}`}>
      {streamUrl ? (
        <video
          ref={videoRef}
          controls
          controlsList="nodownload"
          playsInline
          muted={muted}
          className="w-full h-full"
          onError={(e) => {
            const code = e.currentTarget.error?.code;
            const msg = e.currentTarget.error?.message ?? 'Unknown error';
            setError(`Playback error (${code}): ${msg}`);
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-red" />
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;