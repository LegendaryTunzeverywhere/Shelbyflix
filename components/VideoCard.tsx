'use client';

import React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import type { VideoMetadata } from '@/types';
import { formatAddress } from '@/lib/aptos';
import { 
  LockClosedIcon, 
  PlayCircleIcon, 
  EyeIcon,
  ClockIcon 
} from '@heroicons/react/24/outline';

interface VideoCardProps {
  video: VideoMetadata;
  hasAccess: boolean;
}

const VideoCard: React.FC<VideoCardProps> = ({ video, hasAccess }) => {
  const {
    videoId,
    title,
    description,
    thumbnailUrl,
    uploader,
    timestamp,
    views,
  } = video;

  return (
    <Link
      href={`/video/${videoId}`}
      className="group block bg-white rounded-xl overflow-hidden shadow-sm 
        hover:shadow-xl transition-all duration-300 border border-gray-100 
        hover:border-primary-200"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gradient-to-br from-gray-100 to-gray-200 
        overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform 
              duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <PlayCircleIcon className="w-16 h-16 text-gray-400" />
          </div>
        )}
        
        {/* Lock/Unlock Overlay */}
        <div className={`absolute inset-0 flex items-center justify-center 
          ${hasAccess ? 'bg-green-500/0 group-hover:bg-green-500/10' : 'bg-black/60'} 
          transition-colors duration-300`}>
          {hasAccess ? (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity 
              duration-300">
              <PlayCircleIcon className="w-16 h-16 text-white drop-shadow-lg" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <LockClosedIcon className="w-12 h-12 text-white" />
              <span className="text-white text-sm font-medium px-3 py-1 bg-black/50 
                rounded-full">
                {video.price && video.price > 0 
                  ? `${(video.price / 100000000).toFixed(2)} ShelbyUSD` 
                  : 'Token Required'}
              </span>
            </div>
          )}
        </div>

        {/* Duration Badge (if available) */}
        {video.duration && (
          <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/80 text-white 
            text-xs font-medium rounded">
            {formatDuration(video.duration)}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 
          group-hover:text-primary-600 transition-colors">
          {title}
        </h3>
        
        <p className="text-sm text-gray-600 mb-3 line-clamp-2">
          {description}
        </p>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <span className="font-medium">{formatAddress(uploader)}</span>
          </div>
          
          <div className="flex items-center gap-3">
            {views !== undefined && (
              <div className="flex items-center gap-1">
                <EyeIcon className="w-4 h-4" />
                <span>{formatViews(views)}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <ClockIcon className="w-4 h-4" />
              <span>{formatDistanceToNow(timestamp, { addSuffix: true })}</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
};

// Utility functions
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatViews(views: number): string {
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
  return views.toString();
}

export default VideoCard;
