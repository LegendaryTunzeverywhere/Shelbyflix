'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { 
  toggleLike, 
  toggleDislike, 
  getUserEngagement,
  getTotalLikes,
  getTotalDislikes 
} from '@/lib/engagement-store';
import { 
  HandThumbUpIcon, 
  HandThumbDownIcon, 
  ShareIcon,
  BookmarkIcon 
} from '@heroicons/react/24/outline';
import { 
  HandThumbUpIcon as HandThumbUpIconSolid,
  HandThumbDownIcon as HandThumbDownIconSolid 
} from '@heroicons/react/24/solid';

interface EngagementBarProps {
  videoId: string;
}

export default function EngagementBar({ videoId }: EngagementBarProps) {
  const { address } = useWallet();
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [dislikeCount, setDislikeCount] = useState(0);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    loadEngagement();
  }, [videoId, address]);

  const loadEngagement = () => {
    if (address) {
      const engagement = getUserEngagement(videoId, address);
      setLiked(engagement.liked);
      setDisliked(engagement.disliked);
    }
    
    setLikeCount(getTotalLikes(videoId));
    setDislikeCount(getTotalDislikes(videoId));
  };

  const handleLike = () => {
    if (!address) return;
    
    const result = toggleLike(videoId, address);
    setLiked(result.liked);
    setDisliked(result.disliked);
    loadEngagement();
  };

  const handleDislike = () => {
    if (!address) return;
    
    const result = toggleDislike(videoId, address);
    setLiked(result.liked);
    setDisliked(result.disliked);
    loadEngagement();
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Like Button */}
      <button
        onClick={handleLike}
        disabled={!address}
        className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-sm transition-all ${
          liked
            ? 'bg-brand-red text-white'
            : 'bg-zinc-900/50 text-white hover:bg-zinc-800 border border-zinc-800'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {liked ? (
          <HandThumbUpIconSolid className="w-5 h-5" />
        ) : (
          <HandThumbUpIcon className="w-5 h-5" />
        )}
        <span>{likeCount}</span>
      </button>

      {/* Dislike Button */}
      <button
        onClick={handleDislike}
        disabled={!address}
        className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-sm transition-all ${
          disliked
            ? 'bg-zinc-700 text-white'
            : 'bg-zinc-900/50 text-white hover:bg-zinc-800 border border-zinc-800'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {disliked ? (
          <HandThumbDownIconSolid className="w-5 h-5" />
        ) : (
          <HandThumbDownIcon className="w-5 h-5" />
        )}
        <span>{dislikeCount}</span>
      </button>

      {/* Share Button */}
      <button
        onClick={handleShare}
        className="flex items-center gap-2 px-6 py-3 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 text-white rounded-2xl font-black text-sm transition-all"
      >
        <ShareIcon className="w-5 h-5" />
        <span>{shared ? 'COPIED!' : 'SHARE'}</span>
      </button>

      {/* Save Button */}
      <button
        className="flex items-center gap-2 px-6 py-3 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 text-white rounded-2xl font-black text-sm transition-all"
      >
        <BookmarkIcon className="w-5 h-5" />
        <span>SAVE</span>
      </button>
    </div>
  );
}