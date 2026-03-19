'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VideoCategory, UploadProgress, VideoMetadata } from '@/types';
import { uploadToShelby, validateVideoFile } from '@/lib/shelby';
import { useNotification } from '@/hooks/useNotification';
import { useWallet } from '@/hooks/useWallet';
import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import CategorySelector from './CategorySelector';
import TagInput from './TagInput';
import ExpirationPicker from './ExpirationPicker';
import UploadProgressDisplay from './UploadProgress';
import { CloudArrowUpIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { saveVideo } from '@/lib/video-service';

export default function UploadForm() {
  const router = useRouter();
  const { success, error } = useNotification();
  const { address, connected, user } = useWallet();
  const { signAndSubmitTransaction } = useAptosWallet();

  // Form state
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<VideoCategory>(VideoCategory.OTHER);
  const [tags, setTags] = useState<string[]>([]);
  const [availabilityDays, setAvailabilityDays] = useState(30);
  const [price, setPrice] = useState('10000000'); // 0.1 ShelbyUSD (8 decimals)

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

  // File selection handler
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

      // generateThumbnail now returns a base64 data URL (not a blob URL)
      const thumbnail = await generateThumbnail(selectedFile, Math.floor(duration / 2));
      setThumbnailPreview(thumbnail);
    } catch (err) {
      console.error('Failed to process video:', err);
    }
  };

  // Form submission
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

    if (category === VideoCategory.OTHER && tags.length === 0) {
      error('Please select a category or add tags');
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

      // BUG FIX: was saving `@${walletAddress}/${file.name}` — must use result.blobName
      // which is the actual name registered with Shelbynet. Using the wrong name breaks
      // the cache key in downloadAndDecryptVideo.
      const videoMetadata: VideoMetadata = {
        videoId: result.videoId,
        blobId: result.blobId,
        blobName: result.blobName, // ✅ use the actual registered blob name
        channelId: walletAddress,
        channelName: user?.username || walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4),
        title,
        description,
        category,
        tags,
        shelbyUrl: result.shelbyUrl,
        encryptionKey: result.encryptionKey,
        duration: result.duration,
        thumbnailUrl: result.thumbnailUrl, // now a base64 data URL — survives page reloads
        uploadTimestamp: Date.now(),
        expirationTimestamp: Date.now() + (availabilityDays * 24 * 60 * 60 * 1000),
        availabilityPeriod: availabilityDays,
        views: 0,
        likes: 0,
        dislikes: 0,
        commentCount: 0,
        isShort: result.duration < 60,
        uploader: walletAddress,
        timestamp: Date.now(),
        price: parseInt(price),
      };

      await saveVideo(videoMetadata);
      console.log('✅ Video saved to database:', videoMetadata);

      success('Video uploaded successfully!');

      // Reset form
      setFile(null);
      setTitle('');
      setDescription('');
      setCategory(VideoCategory.OTHER);
      setTags([]);
      setThumbnailPreview(null);
      setVideoDuration(0);

      setTimeout(() => {
        router.push('/gallery');
      }, 2000);

    } catch (err) {
      console.error('Upload failed:', err);
      error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const isShortVideo = videoDuration > 0 && videoDuration < 60;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* File Upload Area */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Video File *
        </label>

        {!file ? (
          <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-gray-700 border-dashed rounded-lg cursor-pointer bg-gray-800 hover:bg-gray-700 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <CloudArrowUpIcon className="w-16 h-16 text-gray-400 mb-4" />
              <p className="mb-2 text-sm text-gray-400">
                <span className="font-semibold">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-gray-500">
                MP4, WebM, or MOV (MAX. 100MB)
              </p>
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
          <div className="relative border-2 border-blue-600 rounded-lg p-4 bg-gray-800">
            {thumbnailPreview ? (
              <img
                src={thumbnailPreview}
                alt="Video thumbnail"
                className="w-full h-48 object-cover rounded-lg mb-4"
              />
            ) : (
              <div className="w-full h-48 bg-gray-700 rounded-lg mb-4 flex items-center justify-center">
                <VideoCameraIcon className="w-16 h-16 text-gray-500" />
              </div>
            )}

            <div className="space-y-2">
              <p className="text-white font-medium">{file.name}</p>
              <div className="flex gap-4 text-sm text-gray-400">
                <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                {videoDuration > 0 && (
                  <>
                    <span>•</span>
                    <span>{Math.floor(videoDuration / 60)}:{(videoDuration % 60).toString().padStart(2, '0')}</span>
                    {isShortVideo && (
                      <>
                        <span>•</span>
                        <span className="text-yellow-400 font-medium">Short Video</span>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {!isUploading && (
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setThumbnailPreview(null);
                  setVideoDuration(0);
                }}
                className="mt-4 text-sm text-blue-400 hover:text-blue-300"
              >
                Change file
              </button>
            )}
          </div>
        )}
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Title *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter video title..."
          maxLength={200}
          required
          disabled={isUploading}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
        />
        <p className="text-xs text-gray-400 mt-1">{title.length}/200 characters</p>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your video..."
          rows={4}
          maxLength={2000}
          disabled={isUploading}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
        />
        <p className="text-xs text-gray-400 mt-1">{description.length}/2000 characters</p>
      </div>

      {/* Category */}
      <CategorySelector
        value={category}
        onChange={setCategory}
      />

      {/* Tags */}
      <TagInput
        tags={tags}
        onChange={setTags}
        maxTags={10}
      />

      {/* Expiration */}
      <ExpirationPicker
        value={availabilityDays}
        onChange={setAvailabilityDays}
      />

      {/* Watch Fee */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-2">
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
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <span className="absolute right-4 top-3 text-gray-400">SHELBY_USD</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Viewers will pay this fee to watch your video
        </p>
      </div>

      {/* Upload Progress */}
      {uploadProgress && (
        <div className="p-6 bg-gray-800 rounded-lg border border-gray-700">
          <UploadProgressDisplay progress={uploadProgress} />
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!file || !title || !address || isUploading}
        className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
      >
        {isUploading ? 'Uploading...' : 'Upload Video'}
      </button>
    </form>
  );
}