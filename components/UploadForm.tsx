'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VideoCategory, VideoType, UploadProgress, VideoMetadata, AccessMode } from '@/types';
import { uploadToShelby, validateVideoFile, validateAccessModeForMove, WalletSigningError, ChainTransactionError } from '@/lib/shelby';
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

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

export default function UploadForm() {
  const router = useRouter();
  const { success, error } = useNotification();
  const { address, connected, user, signAndSubmitTransaction, signMessage, account } = useWallet();

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
  const [thumbnailSource, setThumbnailSource] = useState<'auto' | 'manual'>('auto');
  const [thumbnailTime, setThumbnailTime] = useState<number>(0);
  const [selectedPreset, setSelectedPreset] = useState<'start' | 'mid' | 'end' | null>(null);
  const [presetThumbnails, setPresetThumbnails] = useState<{
    start?: string;
    mid?: string;
    end?: string;
  }>({});
  const [isThumbnailGenerating, setIsThumbnailGenerating] = useState(false);
  const thumbnailUploadRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [pendingChainTxHash, setPendingChainTxHash] = useState<string | null>(null);
  const [pendingVideoMetadata, setPendingVideoMetadata] = useState<VideoMetadata | null>(null);

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
      const mid = Math.floor(duration / 2);
      setThumbnailTime(mid);
      setThumbnailSource('auto');
      setSelectedPreset('mid');
      setIsThumbnailGenerating(true);
      
      // Auto-detect short videos (< 60 seconds)
      if (duration < 60) {
        setVideoType('short');
        success('📱 Detected short video (vertical recommended)');
      }
      
      const [startThumbnail, midThumbnail, endThumbnail] = await Promise.all([
        generateThumbnail(selectedFile, 0),
        generateThumbnail(selectedFile, mid),
        generateThumbnail(selectedFile, Math.max(duration - 1, 0)),
      ]);
      setPresetThumbnails({
        start: startThumbnail,
        mid: midThumbnail,
        end: endThumbnail,
      });
      setThumbnailPreview(midThumbnail);
    } catch (err) {
      console.error('Failed to process video:', err);
      error(err instanceof Error ? err.message : 'Failed to process video');
    } finally {
      setIsProcessing(false);
      setIsThumbnailGenerating(false);
    }
  };

  const generateThumbnailForTime = async (timeSeconds: number, preset?: 'start' | 'mid' | 'end') => {
    if (!file || videoDuration <= 0) return;
    setIsThumbnailGenerating(true);
    try {
      const { generateThumbnail } = await import('@/lib/encryption');
      const safeTime = Math.min(timeSeconds, Math.max(videoDuration - 0.1, 0));
      const thumbnail = await generateThumbnail(file, safeTime);
      setThumbnailPreview(thumbnail);
      setThumbnailSource('auto');
      if (preset) {
        setSelectedPreset(preset);
      } else {
        setSelectedPreset(null);
      }
    } catch (err) {
      console.error('Failed to generate thumbnail:', err);
      error(err instanceof Error ? err.message : 'Failed to generate thumbnail');
    } finally {
      setIsThumbnailGenerating(false);
    }
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setThumbnailPreview(reader.result as string);
      setThumbnailSource('manual');
      setSelectedPreset(null);
      setPresetThumbnails({});
    };
    reader.readAsDataURL(file);
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

    // Move-flag pre-upload validation (Req 8.2, 8.3, 8.4)
    const isMoveBackend = process.env.NEXT_PUBLIC_ACCESS_BACKEND === 'move';
    if (isMoveBackend) {
      const moveValidation = validateAccessModeForMove({
        accessMode,
        price: priceVal.price,
        allowlist,
        unlockAt,
        expirationTimestamp,
      });
      if (moveValidation) {
        setValidationErrors({ [moveValidation.field]: moveValidation.message });
        error(moveValidation.message);
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
          accessMode,
          allowlist: accessMode === 'allowlist' ? allowlist : undefined,
          unlockAt: accessMode === 'timelock' ? unlockAt : undefined,
          thumbnailUrl: thumbnailPreview || undefined,
        } as any,
        address,
        signAndSubmitTransaction,
        signMessage,
        account?.publicKey?.toString(),
        setUploadProgress
      );

      // --- Move-flag: chain registration only for non-public modes ---
      // Public videos don't need on-chain access policy registration.
      // Non-public modes are handled inside uploadToShelby (before blob upload).
      let chainTxHash: string | undefined;
      if (isMoveBackend && accessMode !== 'public') {
        // Non-public: chain tx was already submitted inside uploadToShelby
        chainTxHash = (result as any)._chainTxHash;
      }

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
        // Only persist a price for Purchasable; other modes store 0 so the
        // DB never has stale price values from abandoned mode selections.
        price: accessMode === 'purchasable' ? priceVal.price : 0,
        // Access mode selection wired from form state (Req 1.6). Non-applicable
        // fields are narrowed here so we never persist stale values from a
        // mode the creator abandoned before submit.
        accessMode,
        allowlist: accessMode === 'allowlist' ? allowlist : [],
        unlockAt: accessMode === 'timelock' ? unlockAt : undefined,
      };

      // Supabase write — if this fails after a successful chain commit,
      // surface a targeted error and allow DB-only retry (Req 8.6).
      try {
        await saveVideo(videoMetadata);
      } catch (dbErr) {
        if (isMoveBackend && chainTxHash) {
          // Chain commit succeeded but DB write failed (Req 8.6)
          setPendingChainTxHash(chainTxHash);
          setPendingVideoMetadata(videoMetadata);
          const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
          error(
            `Chain registration succeeded (tx: ${chainTxHash.slice(0, 10)}...) but failed to save the videos row. ` +
            `Error: ${dbMsg}. You can retry the database write without re-submitting the chain transaction.`
          );
          return;
        }
        throw dbErr;
      }

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
      setPendingChainTxHash(null);
      setPendingVideoMetadata(null);

      setTimeout(() => {
        router.push(isShort ? '/shorts' : '/gallery');
      }, 2000);

    } catch (err) {
      console.error('Upload failed:', err);

      // Move-flag specific error handling (Req 8.5, 8.8)
      if (err instanceof WalletSigningError) {
        // Wallet rejection / adapter error / missing account (Req 8.8)
        // No broadcast, no Supabase write, keep form state
        error(`Signing failed (${err.category}): ${err.message}`);
        return;
      }

      if (err instanceof ChainTransactionError) {
        // Chain abort or commit timeout (Req 8.5)
        const indicator = err.isTimeout ? 'timeout' : `abort code: ${err.abortCode}`;
        error(
          `Chain transaction failed [${err.entryFunction}]: ${indicator}. ` +
          `No access fields were persisted. You can retry from the current form state.`
        );
        return;
      }

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

  // Retry Supabase write only — for the post-commit DB failure case (Req 8.6)
  const handleRetrySupabaseWrite = async () => {
    if (!pendingVideoMetadata) return;
    setIsUploading(true);
    try {
      await saveVideo(pendingVideoMetadata);
      success('Video saved successfully!');
      setPendingChainTxHash(null);
      setPendingVideoMetadata(null);

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

      const isShort = pendingVideoMetadata.videoType === 'short';
      setTimeout(() => {
        router.push(isShort ? '/shorts' : '/gallery');
      }, 2000);
    } catch (dbErr) {
      const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      error(`Retry failed: ${dbMsg}. The chain registration (tx: ${pendingChainTxHash?.slice(0, 10)}...) is still valid.`);
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

      {file && (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-zinc-400">
                Thumbnail
              </p>
              <p className="text-[11px] text-zinc-500 mt-2 max-w-2xl">
                Choose a quick preview frame or upload your own thumbnail image.
              </p>
            </div>
            <button
              type="button"
              onClick={() => thumbnailUploadRef.current?.click()}
              disabled={isUploading || isProcessing}
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-brand-red hover:bg-brand-red/90 text-xs font-black uppercase tracking-wider text-white transition-colors disabled:opacity-50"
            >
              Upload image
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] items-center">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-widest text-zinc-500">
                <span>Quick choose</span>
                <span className="text-zinc-400">{formatTime(thumbnailTime)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['start', 'mid', 'end'] as const).map((slot) => {
                  const labels = { start: 'Start', mid: 'Middle', end: 'End' } as const;
                  const times = {
                    start: 0,
                    mid: Math.floor(videoDuration / 2),
                    end: Math.max(videoDuration - 1, 0),
                  } as const;
                  const thumb = presetThumbnails[slot];
                  const active = selectedPreset === slot && thumbnailSource !== 'manual';

                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => {
                        setThumbnailSource('auto');
                        setThumbnailTime(times[slot]);
                        setSelectedPreset(slot);
                        void generateThumbnailForTime(times[slot], slot);
                      }}
                      disabled={isUploading || isProcessing || videoDuration === 0}
                      className={`rounded-2xl overflow-hidden border-2 transition-all duration-200
                        ${active ? 'border-brand-red shadow-[0_0_20px_rgba(246,27,46,0.25)]' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'}
                        ${isUploading || isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className="h-24 bg-zinc-950 flex items-center justify-center overflow-hidden">
                        {thumb ? (
                          <img src={thumb} alt={`${labels[slot]} thumbnail`} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-[10px] text-zinc-500 uppercase tracking-[0.22em] px-2 text-center">
                            {labels[slot]}
                          </div>
                        )}
                      </div>
                      <div className={`px-2 py-2 text-[10px] font-black uppercase tracking-widest text-center
                        ${active ? 'text-white bg-brand-red' : 'text-zinc-300 bg-zinc-900'}`}>
                        {labels[slot]}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="w-full sm:w-40 rounded-2xl border border-zinc-800 overflow-hidden bg-zinc-900 h-24">
              {thumbnailPreview ? (
                <img
                  src={thumbnailPreview}
                  alt="Thumbnail preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-3 text-zinc-500 text-xs text-center">
                  Thumbnail preview will appear here.
                </div>
              )}
            </div>
          </div>

          <p className="mt-3 text-[11px] text-zinc-500">
            {thumbnailSource === 'manual'
              ? 'Custom thumbnail selected.'
              : isThumbnailGenerating
                ? 'Generating frame preview…'
                : selectedPreset
                  ? `${selectedPreset.charAt(0).toUpperCase() + selectedPreset.slice(1)} frame selected.`
                  : `Frame at ${formatTime(thumbnailTime)} selected.`}
          </p>

          <input
            ref={thumbnailUploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleThumbnailUpload}
          />
        </div>
      )}

      {/* DB-only retry affordance (Req 8.6) */}
      {pendingChainTxHash && pendingVideoMetadata && (
        <div className="p-5 bg-yellow-900/20 rounded-2xl border border-yellow-700/50">
          <p className="text-sm text-yellow-300 font-bold mb-2">⚠️ Chain registration succeeded but database write failed</p>
          <p className="text-xs text-yellow-400/80 mb-3">
            Transaction: {pendingChainTxHash.slice(0, 16)}... — The on-chain registration is already confirmed.
            Click below to retry saving the video record to the database only.
          </p>
          <button
            type="button"
            onClick={handleRetrySupabaseWrite}
            disabled={isUploading}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-black font-bold text-xs rounded-xl transition-colors disabled:opacity-50"
          >
            {isUploading ? 'Retrying...' : 'Retry Database Write'}
          </button>
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