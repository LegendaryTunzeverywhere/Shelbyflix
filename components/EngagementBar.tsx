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

  useEffect(() => {
    loadEngagement();
  }, [videoId]);

  async function loadEngagement() {
    try {
      const { supabase } = await import('@/lib/supabase');
      const { data } = await supabase
        .from('videos').select('likes, dislikes').eq('video_id', videoId).single();
      if (data) {
        setLikes(data.likes ?? 0);
        setDislikes(data.dislikes ?? 0);
      }

      if (address) {
        const { data: eng } = await supabase
          .from('video_engagement')
          .select('liked, disliked')
          .eq('video_id', videoId)
          .eq('wallet_address', address.toString())
          .single();
        if (eng) {
          setLiked(eng.liked);
          setDisliked(eng.disliked);
        }
      }
    } catch {}
  }

  async function handleLike() {
    if (!address) return;
    const newLiked = !liked;
    const delta = newLiked ? 1 : -1;

    setLiked(newLiked);
    setLikes(l => l + delta);
    if (disliked && newLiked) {
      setDisliked(false);
      setDislikes(d => Math.max(0, d - 1));
    }

    try {
      const { supabase } = await import('@/lib/supabase');
      const fn = newLiked ? 'increment_likes' : 'decrement_likes';
      await supabase.rpc(fn, { video_id_param: videoId });

      await supabase.from('video_engagement').upsert({
        video_id: videoId,
        wallet_address: address.toString(),
        liked: newLiked,
        disliked: disliked && newLiked ? false : disliked,
        updated_at: new Date().toISOString(),
      });
    } catch {}
  }

  async function handleDislike() {
    if (!address) return;
    const newDisliked = !disliked;
    const delta = newDisliked ? 1 : -1;

    setDisliked(newDisliked);
    setDislikes(d => d + delta);
    if (liked && newDisliked) {
      setLiked(false);
      setLikes(l => Math.max(0, l - 1));
    }

    try {
      const { supabase } = await import('@/lib/supabase');
      const fn = newDisliked ? 'increment_dislikes' : 'decrement_dislikes';
      await supabase.rpc(fn, { video_id_param: videoId });

      await supabase.from('video_engagement').upsert({
        video_id: videoId,
        wallet_address: address.toString(),
        liked: liked && newDisliked ? false : liked,
        disliked: newDisliked,
        updated_at: new Date().toISOString(),
      });
    } catch {}
  }

  if (vertical) {
    return (
      <div className="flex flex-col items-center gap-4">
        <button onClick={handleLike} className="flex flex-col items-center gap-1 group">
          <div className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center">
            {liked
              ? <HandThumbUpSolid className="w-5 h-5 text-brand-red" />
              : <HandThumbUpIcon className="w-5 h-5 text-white group-hover:text-brand-red transition-colors" />
            }
          </div>
          <span className="text-white text-xs font-bold">{likes.toLocaleString()}</span>
        </button>
        <button onClick={handleDislike} className="flex flex-col items-center gap-1 group">
          <div className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center">
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
        className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-700 transition-colors"
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
        className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-700 transition-colors"
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