'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VideoCategory, VideoType, UploadProgress, VideoMetadata } from '@/types';
import { uploadToShelby, validateVideoFile } from '@/lib/shelby';
import { useNotification } from '@/hooks/useNotification';
import { useWallet } from '@/hooks/useWallet';
import CategorySelector from './CategorySelector';
import TagInput from './TagInput';
import ExpirationPicker from './ExpirationPicker';
import UploadProgressDisplay from './UploadProgress';
import { saveVideo } from '@/lib/video-service';
import {
  CloudArrowUpIcon,
  VideoCameraIcon,
  FilmIcon,
  DevicePhoneMobileIcon,
  XMarkIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';

export default function UploadForm() {
  const router = useRouter();
  const { success, error } = useNotification();
  const { address, connected, user, signAndSubmitTransaction } = useWallet();

  const [videoType, setVideoType] = useState<VideoType>('long');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<VideoCategory>(VideoCategory.OTHER);
  const [tags, setTags] = useState<string[]>([]);
  const [availabilityDays, setAvailabilityDays] = useState(30);
  const [price, setPrice] = useState('10000000');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const validation = validateVideoFile(selectedFile);
    if (!validation.valid) {
      error(validation.error || 'Invalid file');
      return;
    }

    setFile(selectedFile);

    try {
      const { getVideoDuration, generateThumbnail } = await import('@/lib/encryption');
      const duration = await getVideoDuration(selectedFile);
      setVideoDuration(duration);
      if (duration < 60) setVideoType('short');
      const thumbnail = await generateThumbnail(selectedFile, Math.floor(duration / 2));
      setThumbnailPreview(thumbnail);
    } catch (err) {
      console.error('Failed to process video:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !address) {
      error('Please select a file and connect your wallet');
      return;
    }

    if (!title.trim()) {
      error('Please enter a title');
      return;
    }

    setIsUploading(true);

    try {
      const walletAddress = address.toString();

      const result = await uploadToShelby(
        file,
        {
          title,
          description,
          category,
          tags,
          availabilityPeriod: availabilityDays,
          uploader: walletAddress,
          channelId: walletAddress,
          channelName: walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4),
          price: parseInt(price),
        },
        address,
        signAndSubmitTransaction,
        setUploadProgress
      );

      const isShort = videoType === 'short';

      const videoMetadata: VideoMetadata = {
        videoId: result.videoId,
        blobId: result.blobId,
        blobName: result.blobName,
        channelId: walletAddress,
        channelName: user?.username || walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4),
        title,
        description,
        category,
        tags,
        shelbyUrl: result.shelbyUrl,
        encryptionKey: result.encryptionKey,
        duration: result.duration,
        thumbnailUrl: result.thumbnailUrl,
        uploadTimestamp: Date.now(),
        expirationTimestamp: Date.now() + (availabilityDays * 24 * 60 * 60 * 1000),
        availabilityPeriod: availabilityDays,
        views: 0,
        likes: 0,
        dislikes: 0,
        commentCount: 0,
        isShort,
        videoType,
        uploader: walletAddress,
        timestamp: Date.now(),
        price: parseInt(price),
      };

      await saveVideo(videoMetadata);
      success('Video uploaded successfully!');

      setFile(null);
      setTitle('');
      setDescription('');
      setCategory(VideoCategory.OTHER);
      setTags([]);
      setThumbnailPreview(null);
      setVideoDuration(0);
      setVideoType('long');

      setTimeout(() => {
        router.push(isShort ? '/shorts' : '/gallery');
      }, 2000);

    } catch (err) {
      console.error('Upload failed:', err);
      error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* VIDEO TYPE PICKER */}
      <div>
        <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
          Content Type <span className="text-brand-red">*</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setVideoType('long')}
            disabled={isUploading}
            className={`relative flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all
              ${videoType === 'long'
                ? 'border-brand-red bg-brand-red/10'
                : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600'
              }`}
          >
            <div className={`relative w-16 h-9 rounded-lg border-2 flex items-center justify-center
              ${videoType === 'long' ? 'border-brand-red' : 'border-zinc-600'}`}>
              <FilmIcon className={`w-4 h-4 ${videoType === 'long' ? 'text-brand-red' : 'text-zinc-500'}`} />
              {videoType === 'long' && (
                <CheckCircleIcon className="absolute -top-2 -right-2 w-4 h-4 text-brand-red bg-black rounded-full" />
              )}
            </div>
            <div className="text-center">
              <p className={`text-sm font-black tracking-tight ${videoType === 'long' ? 'text-white' : 'text-zinc-400'}`}>
                Long Video
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5">16:9 · Gallery</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setVideoType('short')}
            disabled={isUploading}
            className={`relative flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all
              ${videoType === 'short'
                ? 'border-brand-purple bg-brand-purple/10'
                : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600'
              }`}
          >
            <div className={`relative w-9 h-16 rounded-lg border-2 flex items-center justify-center
              ${videoType === 'short' ? 'border-brand-purple' : 'border-zinc-600'}`}>
              <DevicePhoneMobileIcon className={`w-4 h-4 ${videoType === 'short' ? 'text-brand-purple' : 'text-zinc-500'}`} />
              {videoType === 'short' && (
                <CheckCircleIcon className="absolute -top-2 -right-2 w-4 h-4 text-brand-purple bg-black rounded-full" />
              )}
            </div>
            <div className="text-center">
              <p className={`text-sm font-black tracking-tight ${videoType === 'short' ? 'text-white' : 'text-zinc-400'}`}>
                Short
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5">9:16 · Vertical · Shorts feed</p>
            </div>
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 mt-2 font-medium">
          {videoType === 'short'
            ? '📱 Shorts appear in the vertical Shorts feed. Film vertically for best results.'
            : '🎬 Long videos appear in Gallery. Horizontal (landscape) format recommended.'}
        </p>
      </div>

      {/* FILE UPLOAD */}
      <div>
        <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
          Video File <span className="text-brand-red">*</span>
        </label>

        {!file ? (
          <label className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded-2xl cursor-pointer
            bg-zinc-900/40 hover:bg-zinc-800/40 transition-colors
            ${videoType === 'short' ? 'border-brand-purple/40 hover:border-brand-purple/70' : 'border-zinc-700 hover:border-zinc-500'}
            ${videoType === 'short' ? 'aspect-[9/16] max-h-64' : 'h-48'}`}
          >
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <CloudArrowUpIcon className={`w-10 h-10 mb-3 ${videoType === 'short' ? 'text-brand-purple' : 'text-zinc-500'}`} />
              <p className="text-sm font-bold text-zinc-300 mb-1">
                Click to upload {videoType === 'short' ? 'vertical short' : 'video'}
              </p>
              <p className="text-xs text-zinc-600">MP4, WebM, MOV · Max 100MB</p>
              {videoType === 'short' && (
                <p className="text-[10px] text-brand-purple mt-2 font-bold">Best in 9:16 portrait mode</p>
              )}
            </div>
            <input
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              className="hidden"
              disabled={isUploading}
            />
          </label>
        ) : (
          <div className={`relative border-2 rounded-2xl overflow-hidden
            ${videoType === 'short' ? 'border-brand-purple/50' : 'border-brand-red/50'}`}>
            <div className={`relative bg-black ${videoType === 'short' ? 'aspect-[9/16] max-h-72 mx-auto' : 'aspect-video'}`}>
              {thumbnailPreview ? (
                <img src={thumbnailPreview} alt="Video thumbnail" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                  <VideoCameraIcon className="w-12 h-12 text-zinc-700" />
                </div>
              )}
              <div className={`absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest
                ${videoType === 'short' ? 'bg-brand-purple text-white' : 'bg-brand-red text-white'}`}>
                {videoType === 'short' ? '📱 SHORT' : '🎬 VIDEO'}
              </div>
              {!isUploading && (
                <button
                  type="button"
                  onClick={() => { setFile(null); setThumbnailPreview(null); setVideoDuration(0); }}
                  className="absolute top-3 right-3 w-7 h-7 bg-black/70 rounded-full flex items-center justify-center hover:bg-black transition-colors"
                >
                  <XMarkIcon className="w-4 h-4 text-white" />
                </button>
              )}
            </div>
            <div className="p-4 bg-zinc-900/80">
              <p className="text-white font-bold text-sm truncate">{file.name}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                {videoDuration > 0 && (
                  <>
                    <span>·</span>
                    <span>{Math.floor(videoDuration / 60)}:{(videoDuration % 60).toString().padStart(2, '0')}</span>
                  </>
                )}
                <span>·</span>
                <span className={videoType === 'short' ? 'text-brand-purple font-bold' : 'text-brand-red font-bold'}>
                  {videoType === 'short' ? '9:16 Short' : '16:9 Video'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TITLE */}
      <div>
        <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
          Title <span className="text-brand-red">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={videoType === 'short' ? 'Short title, punchy...' : 'Enter video title...'}
          maxLength={200}
          required
          disabled={isUploading}
          className="w-full px-4 py-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-white
            placeholder-zinc-600 focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red
            disabled:opacity-50 transition-colors text-sm"
        />
        <p className="text-[11px] text-zinc-600 mt-1">{title.length}/200</p>
      </div>

      {/* DESCRIPTION */}
      <div>
        <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your content..."
          rows={videoType === 'short' ? 2 : 4}
          maxLength={2000}
          disabled={isUploading}
          className="w-full px-4 py-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-white
            placeholder-zinc-600 focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red
            disabled:opacity-50 transition-colors text-sm resize-none"
        />
        <p className="text-[11px] text-zinc-600 mt-1">{description.length}/2000</p>
      </div>

      <CategorySelector value={category} onChange={setCategory} />
      <TagInput tags={tags} onChange={setTags} maxTags={10} />
      <ExpirationPicker value={availabilityDays} onChange={setAvailabilityDays} />

      {/* WATCH FEE */}
      <div>
        <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
          Watch Fee (ShelbyUSD)
        </label>
        <div className="relative">
          <input
            type="number"
            value={parseInt(price) / 100000000}
            onChange={(e) => setPrice((parseFloat(e.target.value) * 100000000).toString())}
            step="0.01"
            min="0"
            disabled={isUploading}
            className="w-full px-4 py-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-white
              focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red
              disabled:opacity-50 transition-colors text-sm pr-28"
          />
          <span className="absolute right-4 top-3 text-zinc-500 text-xs font-bold">SHELBY_USD</span>
        </div>
        <p className="text-[11px] text-zinc-600 mt-1">Viewers pay this fee to watch</p>
      </div>

      {uploadProgress && (
        <div className="p-5 bg-zinc-900 rounded-2xl border border-zinc-800">
          <UploadProgressDisplay progress={uploadProgress} />
        </div>
      )}

      <button
        type="submit"
        disabled={!file || !title || !address || isUploading}
        className={`w-full py-4 rounded-2xl font-black text-sm tracking-widest transition-all
          disabled:opacity-40 disabled:cursor-not-allowed
          ${videoType === 'short'
            ? 'bg-brand-purple hover:bg-brand-purple/90 text-white shadow-[0_0_30px_rgba(123,43,249,0.3)]'
            : 'bg-brand-red hover:bg-brand-red/90 text-white shadow-[0_0_30px_rgba(246,27,46,0.3)]'
          }`}
      >
        {isUploading
          ? 'UPLOADING...'
          : videoType === 'short'
          ? '📱 PUBLISH SHORT'
          : '🎬 PUBLISH VIDEO'}
      </button>
    </form>
  );
}
