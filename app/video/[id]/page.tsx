'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import Header from '@/components/Header';
import VideoPlayer from '@/components/VideoPlayer';
import EngagementBar from '@/components/EngagementBar';
import CommentSection from '@/components/CommentSection';
import SubscribeButton from '@/components/SubscribeButton';
import { useWallet } from '@/hooks/useWallet';
import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { formatAddress } from '@/lib/aptos';
import { getSubscriberCount } from '@/lib/engagement-store';
import type { VideoMetadata } from '@/types';
import {
  ArrowLeftIcon,
  ShareIcon,
  CheckIcon,
  TrashIcon,
  EyeIcon,
  ClockIcon,
  PlayCircleIcon,
  UserGroupIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';

function RelatedVideoCard({ video }: { video: VideoMetadata }) {
  return (
    <Link href={`/video/${video.videoId}`} className="flex gap-3 group">
      <div className="relative w-36 sm:w-40 aspect-video bg-zinc-900 rounded-xl overflow-hidden flex-shrink-0">
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <PlayCircleIcon className="w-8 h-8 text-zinc-700" />
          </div>
        )}
        {video.duration > 0 && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/80 text-white text-[10px] font-black rounded">
            {Math.floor(video.duration / 60)}:{(video.duration % 60).toString().padStart(2, '0')}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-white text-sm font-bold line-clamp-2 group-hover:text-brand-red transition-colors leading-snug mb-1">
          {video.title}
        </h4>
        <Link
          href={`/channel/${video.channelId}`}
          className="text-zinc-500 text-xs hover:text-brand-red transition-colors"
          onClick={e => e.stopPropagation()}
        >
          {video.channelName}
        </Link>
        <p className="text-zinc-600 text-xs mt-0.5">
          {video.views.toLocaleString()} views · {formatDistanceToNow(video.uploadTimestamp, { addSuffix: true })}
        </p>
      </div>
    </Link>
  );
}

export default function VideoPage() {
  const params = useParams();
  const router = useRouter();
  const { address } = useWallet();
  const { signAndSubmitTransaction } = useAptosWallet();

  const [video, setVideo] = useState<VideoMetadata | null>(null);
  const [related, setRelated] = useState<VideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [channelSubCount, setChannelSubCount] = useState(0);

  const videoId = params.id as string;

  useEffect(() => {
    loadVideo();
  }, [videoId]);

  async function loadVideo() {
    setLoading(true);
    try {
      const { getVideoById, getAllVideos } = await import('@/lib/video-service');
      const [metadata, all] = await Promise.all([getVideoById(videoId), getAllVideos()]);

      if (!metadata) { setVideo(null); return; }
      setVideo(metadata);
      setChannelSubCount(getSubscriberCount(metadata.channelId));

      const rel = all
        .filter(v => v.videoId !== videoId)
        .sort((a, b) => {
          const sameCategory = (a.category === metadata.category ? 1 : 0) - (b.category === metadata.category ? 1 : 0);
          if (sameCategory !== 0) return -sameCategory;
          return b.views - a.views;
        })
        .slice(0, 12);
      setRelated(rel);
    } catch (e) {
      console.error('Error loading video:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function handleDelete() {
    if (!video || !address) return;
    if (!confirm('Delete this video? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const { deleteVideo } = await import('@/lib/video-service');
      await deleteVideo(video.videoId, video.blobName, signAndSubmitTransaction, video.shelbyUrl);
      router.push('/gallery');
    } catch (e) {
      alert('Failed to delete. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-dark">
        <Header />
        <div className="max-w-7xl mx-auto px-4 py-16 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-red" />
        </div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-brand-dark text-white">
        <Header />
        <div className="max-w-3xl mx-auto px-4 py-24 text-center">
          <h1 className="text-4xl font-black tracking-tighter mb-4">VIDEO NOT FOUND</h1>
          <p className="text-zinc-500 mb-8">This video may have expired or been removed.</p>
          <button onClick={() => router.push('/')} className="px-8 py-4 bg-brand-red text-white rounded-2xl font-black text-sm tracking-widest hover:bg-brand-red/90 transition-colors">
            GO HOME
          </button>
        </div>
      </div>
    );
  }

  const isOwner = address?.toString().toLowerCase() === video.uploader.toLowerCase();
  const channelInitials = video.channelName.slice(0, 2).toUpperCase();
  const formattedSubCount = channelSubCount >= 1_000_000
    ? `${(channelSubCount / 1_000_000).toFixed(1)}M`
    : channelSubCount >= 1_000
    ? `${(channelSubCount / 1_000).toFixed(1)}K`
    : channelSubCount.toString();

  return (
    <div className="min-h-screen bg-brand-dark text-white">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-zinc-500 hover:text-white mb-5 transition-colors text-sm font-bold group"
        >
          <ArrowLeftIcon className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back
        </button>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            <div className="rounded-2xl overflow-hidden bg-black mb-4 shadow-2xl">
              <VideoPlayer video={video} walletAddress={address?.toString()} />
            </div>

            <h1 className="text-xl sm:text-2xl font-black tracking-tight mb-4 leading-tight">{video.title}</h1>

            {/* Channel profile card — clickable, public-facing */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 border-y border-zinc-800 mb-4">
              <Link
                href={`/channel/${video.channelId}`}
                className="group flex items-center gap-3 hover:opacity-90 transition-opacity min-w-0"
              >
                <div className="w-11 h-11 bg-gradient-to-br from-brand-purple to-brand-red rounded-full
                  flex items-center justify-center text-white font-black text-sm flex-shrink-0
                  group-hover:scale-105 transition-transform shadow-lg">
                  {channelInitials}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-white font-black text-sm group-hover:text-brand-red transition-colors truncate">
                      {video.channelName}
                    </p>
                    <ChevronRightIcon className="w-3.5 h-3.5 text-zinc-600 group-hover:text-brand-red transition-colors flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-1 text-zinc-500 text-xs mt-0.5">
                    <UserGroupIcon className="w-3 h-3 flex-shrink-0" />
                    <span className="font-bold text-white">{formattedSubCount}</span>
                    <span>{channelSubCount === 1 ? 'subscriber' : 'subscribers'}</span>
                  </div>
                </div>
              </Link>

              <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                <SubscribeButton channelId={video.channelId} onSubscribe={() => setChannelSubCount(getSubscriberCount(video.channelId))} />

                <button
                  onClick={handleShare}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-bold transition-colors"
                >
                  {copied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <ShareIcon className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Share'}
                </button>

                {isOwner && (
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-red-900/50 hover:text-brand-red rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
                  >
                    <TrashIcon className="w-4 h-4" />
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </div>
            </div>

            <div className="mb-4">
              <EngagementBar videoId={video.videoId} />
            </div>

            <div className="bg-zinc-900/50 rounded-2xl p-4 mb-6">
              <div className="flex items-center gap-4 text-zinc-400 text-xs mb-3">
                <div className="flex items-center gap-1">
                  <EyeIcon className="w-3.5 h-3.5" />
                  <span className="font-bold">{video.views.toLocaleString()} views</span>
                </div>
                <div className="flex items-center gap-1">
                  <ClockIcon className="w-3.5 h-3.5" />
                  <span>{formatDistanceToNow(video.uploadTimestamp, { addSuffix: true })}</span>
                </div>
                {video.category && (
                  <span className="px-2 py-0.5 bg-zinc-800 rounded-full">{video.category}</span>
                )}
              </div>
              {video.description && (
                <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{video.description}</p>
              )}
              {video.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {video.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-zinc-800 text-brand-purple text-xs rounded-full">#{tag}</span>
                  ))}
                </div>
              )}
            </div>

            <CommentSection videoId={video.videoId} />
          </div>

          <div className="lg:w-96 flex-shrink-0">
            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">Up Next</h3>
            <div className="space-y-3">
              {related.length === 0 ? (
                <p className="text-zinc-600 text-sm">No related videos yet.</p>
              ) : (
                related.map(v => <RelatedVideoCard key={v.videoId} video={v} />)
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}