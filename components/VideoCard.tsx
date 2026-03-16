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
  hasAccess?: boolean; // Make optional with default
}

const VideoCard: React.FC<VideoCardProps> = ({ video, hasAccess = true }) => {
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
      className="group block bg-zinc-900/50 backdrop-blur-md rounded-[24px] overflow-hidden 
        border border-zinc-800 hover:border-brand-red/50 transition-all duration-500 hover:-translate-y-1"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-zinc-950 overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform 
              duration-700"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-900 to-black">
            <PlayCircleIcon className="w-16 h-16 text-zinc-800" />
          </div>
        )}
        
        {/* Overlay */}
        <div className={`absolute inset-0 flex items-center justify-center transition-all duration-500
          ${hasAccess ? 'bg-black/0 group-hover:bg-black/40' : 'bg-black/80 backdrop-blur-[2px]'}`}>
          {hasAccess ? (
            <div className="opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all duration-500">
              <div className="w-16 h-16 bg-brand-red rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(246,27,46,0.5)]">
                <PlayCircleIcon className="w-10 h-10 text-white" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-14 h-14 bg-zinc-800/50 rounded-2xl flex items-center justify-center border border-zinc-700/50">
                <LockClosedIcon className="w-7 h-7 text-brand-red" />
              </div>
              <span className="text-[10px] text-white font-black uppercase tracking-[0.2em] px-4 py-1.5 bg-brand-red rounded-full">
                {video.price && video.price > 0 
                  ? `${(video.price / 100000000).toFixed(2)} SUSD` 
                  : 'AUTH REQUIRED'}
              </span>
            </div>
          )}
        </div>

        {/* Duration Badge */}
        {video.duration && (
          <div className="absolute bottom-3 right-3 px-2 py-1 bg-black/80 backdrop-blur-md text-white 
            text-[10px] font-black tracking-widest rounded border border-zinc-800">
            {formatDuration(video.duration)}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-pink opacity-50" />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Digital Archive</span>
        </div>
        
        <h3 className="font-black text-white mb-2 line-clamp-1 text-lg tracking-tighter
          group-hover:text-brand-red transition-colors">
          {title}
        </h3>
        
        <p className="text-xs text-zinc-500 mb-6 line-clamp-2 font-medium leading-relaxed">
          {description}
        </p>

        <div className="flex items-center justify-between pt-4 border-t border-zinc-800/50">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-zinc-800 rounded-full flex items-center justify-center">
              <div className="w-2 h-2 bg-brand-purple rounded-full" />
            </div>
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
              {formatAddress(uploader)}
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            {views !== undefined && (
              <div className="flex items-center gap-1.5 text-zinc-600">
                <EyeIcon className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black tracking-tighter">{formatViews(views)}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-zinc-600">
              <ClockIcon className="w-3.5 h-3.5" />
              <span className="text-[10px] font-black tracking-tighter uppercase">
                {formatDistanceToNow(timestamp, { addSuffix: false }).replace('about ', '')}
              </span>
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
