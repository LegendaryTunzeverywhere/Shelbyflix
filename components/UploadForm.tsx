'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VideoCategory, VideoType, UploadProgress, VideoMetadata, AccessMode } from '@/types';
import { uploadToShelby, validateVideoFile } from '@/lib/shelby';
import { useNotification } from '@/hooks/useNotification';
import { useWallet } from '@/hooks/useWallet';
import CategorySelector from './CategorySelector';
import TagInput from './TagInput';
import ExpirationPicker from './ExpirationPicker';
import AccessModeSelector from './AccessModeSelector';
import AllowlistEditor from './AllowlistEditor';
import TimeLockPicker from './TimeLockPicker';
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
  const [accessMode, setAccessMode] = useState<AccessMode>('public');
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [unlockAt, setUnlockAt] = useState<number | undefined>(undefined);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Shared file processing logic
  const processFile = async (selectedFile: File) => {
    setIsProcessing(true);
    try {
      const validation = validateVideoFile(selectedFile);
      if (!validation.valid) {
        error(validation.error || 'Invalid file');
        return;
      }

      setFile(selectedFile);

      const { getVideoDuration, generateThumbnail } = await import('@/lib/encryption');
      const duration = await getVideoDuration(selectedFile);
      setVideoDuration(duration);
      
      // Auto-detect short videos (< 60 seconds)
      if (duration < 60) {
        setVideoType('short');
        success('📱 Detected short video (vertical recommended)');
      }
      
      const thumbnail = await generateThumbnail(selectedFile, Math.floor(duration / 2));
      setThumbnailPreview(thumbnail);
    } catch (err) {
      console.error('Failed to process video:', err);
      error(err instanceof Error ? err.message : 'Failed to process video');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    await processFile(selectedFile);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;

    await processFile(droppedFile);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !address) {
      error('Please select a file and connect your wallet');
      return;
    }

    // Import validation functions
    const { 
      validateTitle, 
      validateDescription, 
      validateTags, 
      validateAvailabilityPeriod, 
      validatePrice 
    } = await import('@/lib/validation');

    // Validate all metadata
    const titleVal = validateTitle(title);
    if (!titleVal.valid) {
      setValidationErrors({ title: titleVal.error || 'Invalid title' });
      error(titleVal.error || 'Invalid title');
      return;
    }

    const descVal = validateDescription(description);
    if (!descVal.valid) {
      setValidationErrors({ description: descVal.error || 'Invalid description' });
      error(descVal.error || 'Invalid description');
      return;
    }

    const tagsVal = validateTags(tags);
    if (!tagsVal.valid) {
      setValidationErrors({ tags: tagsVal.error || 'Invalid tags' });
      error(tagsVal.error || 'Invalid tags');
      return;
    }

    const daysVal = validateAvailabilityPeriod(availabilityDays);
    if (!daysVal.valid) {
      error(daysVal.error || 'Invalid availability period');
      return;
    }

    const priceVal = validatePrice(parseInt(price));
    if (!priceVal.valid) {
      error(priceVal.error || 'Invalid price');
      return;
    }

    // Mode-specific validation (Req 1.3, 1.4, 1.5).
    const expirationTimestamp = Date.now() + daysVal.days * 24 * 60 * 60 * 1000;

    if (accessMode === 'purchasable' && priceVal.price <= 0) {
      error('Purchasable videos require a price greater than zero');
      return;
    }

    if (accessMode === 'allowlist' && allowlist.length < 1) {
      error('Add at least one wallet address to the allowlist');
      return;
    }

    if (accessMode === 'timelock') {
      if (unlockAt === undefined) {
        error('Pick an unlock time for this video');
        return;
      }
      if (unlockAt <= Date.now()) {
        error('Unlock time must be in the future');
        return;
      }
      if (unlockAt >= expirationTimestamp) {
        error('Unlock time must be before the video expires');
        return;
      }
    }

    setIsUploading(true);

    try {
      const walletAddress = address.toString();

      const result = await uploadToShelby(
        file,
        {
          title: titleVal.title,
          description: descVal.description,
          category,
          tags: tagsVal.tags,
          availabilityPeriod: daysVal.days,
          uploader: walletAddress,
          channelId: walletAddress,
          channelName: walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4),
          price: priceVal.price,
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
        channelName: (user?.username || walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4)) as string,
        title: titleVal.title,
        description: descVal.description,
        category,
        tags: tagsVal.tags,
        shelbyUrl: result.shelbyUrl,
        encryptionKey: result.encryptionKey,
        duration: result.duration,
        thumbnailUrl: result.thumbnailUrl,
        uploadTimestamp: Date.now(),
        expirationTimestamp,
        availabilityPeriod: daysVal.days,
        views: 0,
        likes: 0,
        dislikes: 0,
        commentCount: 0,
        isShort,
        videoType,
        uploader: walletAddress,
        timestamp: Date.now(),
        price: priceVal.price,
        // Access mode selection wired from form state (Req 1.6). Non-applicable
        // fields are narrowed here so we never persist stale values from a
        // mode the creator abandoned before submit.
        accessMode,
        allowlist: accessMode === 'allowlist' ? allowlist : [],
        unlockAt: accessMode === 'timelock' ? unlockAt : undefined,
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
      setAccessMode('public');
      setAllowlist([]);
      setUnlockAt(undefined);

      setTimeout(() => {
        router.push(isShort ? '/shorts' : '/gallery');
      }, 2000);

    } catch (err) {
      console.error('Upload failed:', err);
      const errMsg = err instanceof Error ? err.message : 'Upload failed';

      // Insufficient ShelbyUSD — give the user a direct path to fix it
      if (errMsg.includes('Insufficient ShelbyUSD') || errMsg.includes('E_INSUFFICIENT_FUNDS')) {
        error(
          `Not enough ShelbyUSD to pay for storage. Get free test tokens at https://faucet.shelbynet.shelby.xyz, then try again.`
        );
      } else {
        error(errMsg);
      }
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
          <label
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center w-full border-2 border-dashed rounded-2xl cursor-pointer transition-all
              ${isDragOver 
                ? `${videoType === 'short' ? 'border-brand-purple bg-brand-purple/20' : 'border-brand-red bg-brand-red/20'} scale-105` 
                : `bg-zinc-900/40 hover:bg-zinc-800/40 ${videoType === 'short' ? 'border-brand-purple/40 hover:border-brand-purple/70' : 'border-zinc-700 hover:border-zinc-500'}`}
              ${videoType === 'short' ? 'aspect-[9/16] max-h-64' : 'h-48'}`}
          >
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <CloudArrowUpIcon className={`w-10 h-10 mb-3 transition-transform ${isDragOver ? 'scale-110' : ''} ${videoType === 'short' ? 'text-brand-purple' : 'text-zinc-500'}`} />
              <p className="text-sm font-bold text-zinc-300 mb-1">
                {isDragOver ? (
                  <span className={videoType === 'short' ? 'text-brand-purple' : 'text-brand-red'}>Drop your video here!</span>
                ) : (
                  <>Click or drag to upload {videoType === 'short' ? 'vertical short' : 'video'}</>
                )}
              </p>
              <p className="text-xs text-zinc-600">MP4, WebM, MOV · Max 10GB</p>
              {videoType === 'short' && (
                <p className="text-[10px] text-brand-purple mt-2 font-bold">Best in 9:16 portrait mode</p>
              )}
              {isProcessing && (
                <p className="text-[10px] text-yellow-500 mt-2 font-bold animate-pulse">⏳ Processing video...</p>
              )}
            </div>
            <input
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              className="hidden"
              disabled={isUploading || isProcessing}
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
        <div className="flex items-center justify-between mb-3">
          <label className="block text-xs font-black uppercase tracking-widest text-zinc-400">
            Title <span className="text-brand-red">*</span>
          </label>
          <span className={`text-[10px] font-bold ${title.length > 180 ? 'text-brand-red' : 'text-zinc-500'}`}>
            {title.length}/200
          </span>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setValidationErrors({ ...validationErrors, title: '' });
          }}
          placeholder={videoType === 'short' ? 'Short title, punchy...' : 'Enter video title...'}
          maxLength={200}
          required
          disabled={isUploading}
          className={`w-full px-4 py-3 bg-zinc-900/60 border rounded-xl text-white
            placeholder-zinc-600 focus:outline-none focus:ring-1 transition-colors text-sm
            disabled:opacity-50
            ${validationErrors.title
              ? 'border-brand-red focus:border-brand-red focus:ring-brand-red'
              : 'border-zinc-800 focus:border-brand-red focus:ring-brand-red'
            }`}
        />
        {validationErrors.title && (
          <p className="text-[11px] text-brand-red mt-1 font-medium">⚠️ {validationErrors.title}</p>
        )}
        {title.length > 0 && !validationErrors.title && (
          <p className="text-[11px] text-green-500 mt-1 font-medium">✓ Title looks good</p>
        )}
      </div>

      {/* DESCRIPTION */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-xs font-black uppercase tracking-widest text-zinc-400">
            Description <span className="text-zinc-600">(Optional)</span>
          </label>
          <span className={`text-[10px] font-bold ${description.length > 4500 ? 'text-brand-red' : 'text-zinc-500'}`}>
            {description.length}/5000
          </span>
        </div>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setValidationErrors({ ...validationErrors, description: '' });
          }}
          placeholder="Describe your content..."
          maxLength={5000}
          disabled={isUploading}
          rows={4}
          className={`w-full px-4 py-3 bg-zinc-900/60 border rounded-xl text-white resize-none
            placeholder-zinc-600 focus:outline-none focus:ring-1 transition-colors text-sm
            disabled:opacity-50
            ${validationErrors.description
              ? 'border-brand-red focus:border-brand-red focus:ring-brand-red'
              : 'border-zinc-800 focus:border-brand-red focus:ring-brand-red'
            }`}
        />
        {validationErrors.description && (
          <p className="text-[11px] text-brand-red mt-1 font-medium">⚠️ {validationErrors.description}</p>
        )}
      </div>

      <CategorySelector value={category} onChange={setCategory} />
      <TagInput tags={tags} onChange={setTags} maxTags={10} />
      <ExpirationPicker value={availabilityDays} onChange={setAvailabilityDays} />

      {/* ACCESS MODE */}
      <AccessModeSelector
        value={accessMode}
        onChange={setAccessMode}
        disabled={isUploading}
      />

      {/* MODE-SPECIFIC EDITOR */}
      {accessMode === 'allowlist' && (
        <AllowlistEditor
          value={allowlist}
          onChange={setAllowlist}
          disabled={isUploading}
        />
      )}
      {accessMode === 'timelock' && (
        <TimeLockPicker
          value={unlockAt}
          onChange={setUnlockAt}
          expirationTimestamp={Date.now() + availabilityDays * 24 * 60 * 60 * 1000}
          disabled={isUploading}
        />
      )}

      {/* PRICE (Purchasable only) */}
      {accessMode === 'purchasable' && (
        <div>
          <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
            Price (ShelbyUSD) <span className="text-brand-red">*</span>
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
          <p className="text-[11px] text-zinc-600 mt-1">Viewers pay this once for lifetime access</p>
        </div>
      )}

      {uploadProgress && (
        <div className="p-5 bg-zinc-900 rounded-2xl border border-zinc-800">
          <UploadProgressDisplay progress={uploadProgress} />
        </div>
      )}

      <button
        type="submit"
        disabled={!file || !title || !address || isUploading || isProcessing}
        className={`w-full py-4 rounded-2xl font-black text-sm tracking-widest transition-all
          disabled:opacity-40 disabled:cursor-not-allowed
          ${videoType === 'short'
            ? 'bg-brand-purple hover:bg-brand-purple/90 text-white shadow-[0_0_30px_rgba(123,43,249,0.3)]'
            : 'bg-brand-red hover:bg-brand-red/90 text-white shadow-[0_0_30px_rgba(246,27,46,0.3)]'
          }`}
      >
        {!file ? (
          '📁 SELECT VIDEO FIRST'
        ) : !title ? (
          '📝 ADD TITLE'
        ) : !address ? (
          '🔗 CONNECT WALLET'
        ) : isProcessing ? (
          '⏳ PROCESSING...'
        ) : isUploading ? (
          'UPLOADING...'
        ) : videoType === 'short' ? (
          '📱 PUBLISH SHORT'
        ) : (
          '🎬 PUBLISH VIDEO'
        )}
      </button>
    </form>
  );
}