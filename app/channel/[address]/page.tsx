'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import Header from '@/components/Header';
import VideoCard from '@/components/VideoCard';
import EditVideoModal from '@/components/EditVideoModal';
import DeleteVideoModal from '@/components/DeleteVideoModal';
import { useWallet } from '@/hooks/useWallet';
import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { formatAddress } from '@/lib/aptos';
import type { VideoMetadata } from '@/types';
import {
  PlayCircleIcon,
  FilmIcon,
  EyeIcon,
  HandThumbUpIcon,
  PencilSquareIcon,
  TrashIcon,
  PlusCircleIcon,
  Squares2X2Icon,
  ClockIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';

type Tab = 'videos' | 'shorts';

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 flex items-center gap-4">
      <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-brand-red" />
      </div>
      <div>
        <p className="text-xl font-black text-white">{value}</p>
        <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">{label}</p>
      </div>
    </div>
  );
}

function ChannelVideoRow({
  video,
  isOwner,
  onEdit,
  onDelete,
}: {
  video: VideoMetadata;
  isOwner: boolean;
  onEdit: (v: VideoMetadata) => void;
  onDelete: (v: VideoMetadata) => void;
}) {
  return (
    <div className="flex gap-4 group p-3 rounded-2xl hover:bg-zinc-900/50 transition-colors">
      {/* Thumbnail */}
      <Link href={`/video/${video.videoId}`} className="relative flex-shrink-0 w-40 aspect-video bg-zinc-900 rounded-xl overflow-hidden">
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-900">
            <PlayCircleIcon className="w-8 h-8 text-zinc-700" />
          </div>
        )}
        <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/80 text-white text-[10px] font-black rounded">
          {Math.floor(video.duration / 60)}:{(video.duration % 60).toString().padStart(2, '0')}
        </span>
        {video.isShort && (
          <span className="absolute top-1.5 left-1.5 px-2 py-0.5 bg-brand-red text-white text-[9px] font-black rounded-full">SHORT</span>
        )}
      </Link>

      {/* Info */}
      <div className="flex-1 min-w-0 py-1">
        <Link href={`/video/${video.videoId}`}>
          <h3 className="text-white font-bold text-sm line-clamp-2 hover:text-brand-red transition-colors mb-1 leading-snug">
            {video.title}
          </h3>
        </Link>
        <p className="text-zinc-500 text-xs line-clamp-1 mb-2">{video.description}</p>
        <div className="flex items-center gap-4 text-zinc-600 text-xs">
          <span className="flex items-center gap-1">
            <EyeIcon className="w-3.5 h-3.5" />
            {video.views.toLocaleString()} views
          </span>
          <span className="flex items-center gap-1">
            <HandThumbUpIcon className="w-3.5 h-3.5" />
            {video.likes.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon className="w-3.5 h-3.5" />
            {formatDistanceToNow(video.uploadTimestamp, { addSuffix: true })}
          </span>
          <span className="px-2 py-0.5 bg-zinc-800 rounded-full text-zinc-400">{video.category}</span>
        </div>
      </div>

      {/* Owner actions */}
      {isOwner && (
        <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(video)}
            className="w-9 h-9 bg-zinc-800 hover:bg-zinc-700 rounded-xl flex items-center justify-center transition-colors"
            title="Edit"
          >
            <PencilSquareIcon className="w-4 h-4 text-zinc-300" />
          </button>
          <button
            onClick={() => onDelete(video)}
            className="w-9 h-9 bg-zinc-800 hover:bg-red-900/50 hover:border-brand-red/50 border border-transparent rounded-xl flex items-center justify-center transition-colors"
            title="Delete"
          >
            <TrashIcon className="w-4 h-4 text-zinc-400 hover:text-brand-red" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChannelPage() {
  const params = useParams();
  const router = useRouter();
  const { address, user } = useWallet();
  const { signAndSubmitTransaction } = useAptosWallet();

  const channelAddress = (params.address as string).toLowerCase();
  const isOwner = address?.toString().toLowerCase() === channelAddress;

  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('videos');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const [editingVideo, setEditingVideo] = useState<VideoMetadata | null>(null);
  const [deletingVideo, setDeletingVideo] = useState<VideoMetadata | null>(null);

  useEffect(() => {
    loadVideos();
  }, [channelAddress]);

  async function loadVideos() {
    setLoading(true);
    try {
      const { getVideosByUploader } = await import('@/lib/video-service');
      const all = await getVideosByUploader(channelAddress);
      setVideos(all);
    } catch (e) {
      console.error('Failed to load channel videos:', e);
    } finally {
      setLoading(false);
    }
  }

  function handleDeleteSuccess(videoId: string) {
    setVideos(v => v.filter(x => x.videoId !== videoId));
    setDeletingVideo(null);
  }

  function handleEditSuccess(updated: VideoMetadata) {
    setVideos(v => v.map(x => x.videoId === updated.videoId ? updated : x));
    setEditingVideo(null);
  }

  const allVideos = videos.filter(v => !v.isShort && v.duration >= 60);
  const shorts = videos.filter(v => v.isShort || v.duration < 60);
  const displayed = tab === 'videos' ? allVideos : shorts;

  const totalViews = videos.reduce((s, v) => s + v.views, 0);
  const totalLikes = videos.reduce((s, v) => s + v.likes, 0);

  const displayName = isOwner
    ? (user?.display_name || user?.username || formatAddress(channelAddress))
    : formatAddress(channelAddress);

  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-brand-dark text-white">
      <Header />

      {/* Channel banner */}
      <div className="relative h-40 bg-gradient-to-br from-brand-purple/30 via-zinc-900 to-brand-red/20 border-b border-zinc-800">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #7B2BF9 0%, transparent 50%), radial-gradient(circle at 80% 50%, #F61B2E 0%, transparent 50%)' }}
        />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Channel identity */}
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-5 -mt-12 mb-8 relative z-10">
          <div className="w-24 h-24 bg-gradient-to-br from-brand-purple to-brand-red rounded-3xl flex items-center justify-center text-white font-black text-3xl shadow-2xl border-4 border-brand-dark flex-shrink-0">
            {initials}
          </div>

          <div className="flex-1 min-w-0 pb-1">
            <h1 className="text-2xl font-black tracking-tight text-white">{displayName}</h1>
            <p className="text-zinc-500 text-sm font-mono mt-0.5">{channelAddress}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
              <span><span className="text-white font-bold">{videos.length}</span> videos</span>
              <span><span className="text-white font-bold">{formatViews(totalViews)}</span> total views</span>
            </div>
          </div>

          {isOwner && (
            <div className="flex gap-2 pb-1">
              <Link
                href="/upload"
                className="flex items-center gap-2 px-4 py-2.5 bg-brand-red hover:bg-brand-red/90 text-white rounded-xl font-black text-xs tracking-widest transition-colors"
              >
                <PlusCircleIcon className="w-4 h-4" />
                UPLOAD
              </Link>
            </div>
          )}
        </div>

        {/* Stats row — owner only */}
        {isOwner && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <StatCard icon={FilmIcon} label="Total Videos" value={videos.length.toString()} />
            <StatCard icon={BoltIcon} label="Shorts" value={shorts.length.toString()} />
            <StatCard icon={EyeIcon} label="Total Views" value={formatViews(totalViews)} />
            <StatCard icon={HandThumbUpIcon} label="Total Likes" value={formatViews(totalLikes)} />
          </div>
        )}

        {/* Tabs + view toggle */}
        <div className="flex items-center justify-between mb-6 border-b border-zinc-800 pb-0">
          <div className="flex gap-1">
            {(['videos', 'shorts'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 text-sm font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
                  tab === t
                    ? 'text-white border-brand-red'
                    : 'text-zinc-500 border-transparent hover:text-white'
                }`}
              >
                {t} {t === 'videos' ? `(${allVideos.length})` : `(${shorts.length})`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 pb-3">
            <button
              onClick={() => setViewMode('list')}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-zinc-700 text-white' : 'text-zinc-600 hover:text-white'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="3" rx="1" fill="currentColor"/><rect x="1" y="7" width="14" height="3" rx="1" fill="currentColor"/><rect x="1" y="12" width="14" height="3" rx="1" fill="currentColor"/></svg>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-zinc-700 text-white' : 'text-zinc-600 hover:text-white'}`}
            >
              <Squares2X2Icon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-red" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-24">
            <PlayCircleIcon className="w-16 h-16 text-zinc-800 mx-auto mb-4" />
            <h3 className="text-xl font-black text-zinc-600 mb-2">
              {tab === 'videos' ? 'No videos yet' : 'No shorts yet'}
            </h3>
            {isOwner && (
              <Link
                href="/upload"
                className="inline-flex items-center gap-2 mt-4 px-6 py-3 bg-brand-red text-white rounded-xl font-black text-sm tracking-widest hover:bg-brand-red/90 transition-colors"
              >
                <PlusCircleIcon className="w-4 h-4" />
                UPLOAD YOUR FIRST {tab === 'videos' ? 'VIDEO' : 'SHORT'}
              </Link>
            )}
          </div>
        ) : viewMode === 'list' ? (
          <div className="space-y-1 pb-16">
            {displayed.map(video => (
              <ChannelVideoRow
                key={video.videoId}
                video={video}
                isOwner={isOwner}
                onEdit={setEditingVideo}
                onDelete={setDeletingVideo}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pb-16">
            {displayed.map(video => (
              <div key={video.videoId} className="relative group">
                <VideoCard video={video} />
                {isOwner && (
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button
                      onClick={(e) => { e.preventDefault(); setEditingVideo(video); }}
                      className="w-8 h-8 bg-black/80 hover:bg-zinc-700 rounded-lg flex items-center justify-center"
                    >
                      <PencilSquareIcon className="w-3.5 h-3.5 text-white" />
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); setDeletingVideo(video); }}
                      className="w-8 h-8 bg-black/80 hover:bg-red-900/80 rounded-lg flex items-center justify-center"
                    >
                      <TrashIcon className="w-3.5 h-3.5 text-brand-red" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {editingVideo && (
        <EditVideoModal
          video={editingVideo}
          onClose={() => setEditingVideo(null)}
          onSuccess={handleEditSuccess}
        />
      )}

      {deletingVideo && (
        <DeleteVideoModal
          video={deletingVideo}
          signAndSubmitTransaction={signAndSubmitTransaction}
          onClose={() => setDeletingVideo(null)}
          onSuccess={() => handleDeleteSuccess(deletingVideo.videoId)}
        />
      )}
    </div>
  );
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}