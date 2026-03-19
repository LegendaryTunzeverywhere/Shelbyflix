'use client';

import { useState, useEffect } from 'react';
import { HandThumbUpIcon, HandThumbDownIcon } from '@heroicons/react/24/outline';
import { HandThumbUpIcon as HandThumbUpSolid, HandThumbDownIcon as HandThumbDownSolid } from '@heroicons/react/24/solid';
import { useWallet } from '@/hooks/useWallet';

interface EngagementBarProps {
  videoId: string;
  vertical?: boolean;
}

export default function EngagementBar({ videoId, vertical = false }: EngagementBarProps) {
  const { address } = useWallet();
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [dislikes, setDislikes] = useState(0);
  // One-way lock — once engaged, cannot undo
  const [hasLiked, setHasLiked] = useState(false);
  const [hasDisliked, setHasDisliked] = useState(false);

  useEffect(() => {
    loadEngagement();
  }, [videoId, address]);

  async function loadEngagement() {
    try {
      const { supabase } = await import('@/lib/supabase');

      // Load counts from videos table
      const { data } = await supabase
        .from('videos')
        .select('likes, dislikes')
        .eq('video_id', videoId)
        .single();
      if (data) {
        setLikes(data.likes ?? 0);
        setDislikes(data.dislikes ?? 0);
      }

      // Load this user's engagement
      if (address) {
        const { data: eng } = await supabase
          .from('video_engagement')
          .select('liked, disliked')
          .eq('video_id', videoId)
          .eq('wallet_address', address.toString())
          .maybeSingle();

        if (eng) {
          setLiked(eng.liked);
          setDisliked(eng.disliked);
          setHasLiked(eng.liked);
          setHasDisliked(eng.disliked);
        }
      }
    } catch {}
  }

  async function handleLike() {
    if (!address || hasLiked) return; // locked

    setLiked(true);
    setHasLiked(true);
    setLikes(l => l + 1);
    if (disliked) {
      setDisliked(false);
      setHasDisliked(false);
      setDislikes(d => Math.max(0, d - 1));
    }

    try {
      const { supabase } = await import('@/lib/supabase');
      await supabase.rpc('increment_likes', { video_id_param: videoId });
      await supabase.from('video_engagement').upsert(
        {
          video_id: videoId,
          wallet_address: address.toString(),
          liked: true,
          disliked: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'video_id,wallet_address' }
      );
    } catch {}
  }

  async function handleDislike() {
    if (!address || hasDisliked) return; // locked

    setDisliked(true);
    setHasDisliked(true);
    setDislikes(d => d + 1);
    if (liked) {
      setLiked(false);
      setHasLiked(false);
      setLikes(l => Math.max(0, l - 1));
    }

    try {
      const { supabase } = await import('@/lib/supabase');
      await supabase.rpc('increment_dislikes', { video_id_param: videoId });
      await supabase.from('video_engagement').upsert(
        {
          video_id: videoId,
          wallet_address: address.toString(),
          liked: false,
          disliked: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'video_id,wallet_address' }
      );
    } catch {}
  }

  if (vertical) {
    return (
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={handleLike}
          disabled={hasLiked}
          className="flex flex-col items-center gap-1 group disabled:cursor-not-allowed"
        >
          <div className={`w-10 h-10 backdrop-blur-md rounded-full flex items-center justify-center transition-colors
            ${hasLiked ? 'bg-brand-red/30' : 'bg-black/50 group-hover:bg-black/70'}`}>
            {liked
              ? <HandThumbUpSolid className="w-5 h-5 text-brand-red" />
              : <HandThumbUpIcon className="w-5 h-5 text-white group-hover:text-brand-red transition-colors" />
            }
          </div>
          <span className="text-white text-xs font-bold">{likes.toLocaleString()}</span>
        </button>

        <button
          onClick={handleDislike}
          disabled={hasDisliked}
          className="flex flex-col items-center gap-1 group disabled:cursor-not-allowed"
        >
          <div className={`w-10 h-10 backdrop-blur-md rounded-full flex items-center justify-center transition-colors
            ${hasDisliked ? 'bg-zinc-600/50' : 'bg-black/50 group-hover:bg-black/70'}`}>
            {disliked
              ? <HandThumbDownSolid className="w-5 h-5 text-zinc-400" />
              : <HandThumbDownIcon className="w-5 h-5 text-white group-hover:text-zinc-400 transition-colors" />
            }
          </div>
          <span className="text-white text-xs font-bold">{dislikes.toLocaleString()}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 bg-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={handleLike}
        disabled={hasLiked}
        title={hasLiked ? 'Already liked' : 'Like'}
        className={`flex items-center gap-2 px-4 py-2 transition-colors disabled:cursor-not-allowed
          ${hasLiked ? 'text-brand-red bg-brand-red/10' : 'hover:bg-zinc-700'}`}
      >
        {liked
          ? <HandThumbUpSolid className="w-4 h-4 text-brand-red" />
          : <HandThumbUpIcon className="w-4 h-4" />
        }
        <span className="text-sm font-bold">{likes.toLocaleString()}</span>
      </button>

      <div className="w-px h-5 bg-zinc-700" />

      <button
        onClick={handleDislike}
        disabled={hasDisliked}
        title={hasDisliked ? 'Already disliked' : 'Dislike'}
        className={`flex items-center gap-2 px-4 py-2 transition-colors disabled:cursor-not-allowed
          ${hasDisliked ? 'text-zinc-400 bg-zinc-700/50' : 'hover:bg-zinc-700'}`}
      >
        {disliked
          ? <HandThumbDownSolid className="w-4 h-4 text-zinc-400" />
          : <HandThumbDownIcon className="w-4 h-4" />
        }
        <span className="text-sm font-bold">{dislikes.toLocaleString()}</span>
      </button>
    </div>
  );
}