'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import type { UploadFormData, UploadProgress } from '@/types';
import { uploadToShelby, validateVideoFile } from '@/lib/shelby';
import { storeVideoMetadataOnChain } from '@/lib/contract';
import { SHELBY_FAUCET_TOKEN } from '@/lib/aptos';
import { 
  CloudArrowUpIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon 
} from '@heroicons/react/24/outline';

interface UploadFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

const UploadForm: React.FC<UploadFormProps> = ({ onSuccess, onCancel }) => {
  const router = useRouter();
  const { account, signAndSubmitTransaction } = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      validateAndSetFile(droppedFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      validateAndSetFile(selectedFile);
    }
  };

  const validateAndSetFile = (file: File) => {
    const validation = validateVideoFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid file');
      return;
    }
    setFile(file);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !title.trim() || !account) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      // Stage 1: Preparing
      setProgress({ percent: 10, stage: 'preparing', message: 'Preparing upload...' });
      await new Promise(resolve => setTimeout(resolve, 500));

      // Stage 2: Uploading to Shelby
      setProgress({ percent: 30, stage: 'uploading', message: 'Uploading to Shelby storage...' });
      
      const uploadResult = await uploadToShelby(file, {
        title,
        description,
        uploader: account.address,
      });

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'Upload failed');
      }

      // Stage 3: Storing metadata on-chain
      setProgress({ percent: 70, stage: 'processing', message: 'Storing metadata on blockchain...' });

      const txHash = await storeVideoMetadataOnChain(
        account.address,
        signAndSubmitTransaction,
        {
          videoId: uploadResult.videoId,
          title: title.trim(),
          description: description.trim(),
          shelbyUrl: uploadResult.shelbyUrl,
          uploader: account.address,
          requiredToken: SHELBY_FAUCET_TOKEN,
        }
      );

      // Stage 4: Complete
      setProgress({ percent: 100, stage: 'complete', message: 'Upload complete!' });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Success
      if (onSuccess) {
        onSuccess();
      } else {
        router.push(`/video/${uploadResult.videoId}`);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress({ percent: 0, stage: 'error', message: 'Upload failed' });
    }
  };

  const resetForm = () => {
    setFile(null);
    setTitle('');
    setDescription('');
    setProgress(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Show progress during upload
  if (progress && progress.stage !== 'error') {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {progress.stage === 'complete' ? 'Upload Complete!' : 'Uploading...'}
            </h2>
            <p className="text-gray-600">{progress.message}</p>
          </div>

          <div className="mb-8">
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-primary-600 h-full transition-all duration-500 ease-out"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-sm text-gray-500 mt-2 text-center">
              {progress.percent}%
            </p>
          </div>

          {progress.stage === 'complete' && (
            <div className="flex justify-center">
              <CheckCircleIcon className="w-16 h-16 text-green-500" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Upload New Video</h2>

        {/* File Upload Area */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer 
            transition-all duration-200 mb-6
            ${isDragging 
              ? 'border-primary-500 bg-primary-50' 
              : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
            }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            onChange={handleFileSelect}
            className="hidden"
          />

          {file ? (
            <div className="flex items-center justify-center gap-3">
              <CheckCircleIcon className="w-8 h-8 text-green-500" />
              <div className="text-left">
                <p className="font-medium text-gray-900">{file.name}</p>
                <p className="text-sm text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  resetForm();
                }}
                className="ml-auto text-gray-400 hover:text-red-500"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
          ) : (
            <>
              <CloudArrowUpIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-700 mb-2">
                Drop your video here or click to browse
              </p>
              <p className="text-sm text-gray-500">
                Supported formats: MP4, WebM, MOV · Max size: 100MB
              </p>
            </>
          )}
        </div>

        {/* Title Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="Enter video title"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg 
              focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          />
          <p className="text-xs text-gray-500 mt-1">{title.length}/100 characters</p>
        </div>

        {/* Description Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="Enter video description (optional)"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg 
              focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            {description.length}/500 characters
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg 
            flex items-start gap-3">
            <ExclamationCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-4">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-6 py-3 border border-gray-300 rounded-lg 
                font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!file || !title.trim()}
            className="flex-1 px-6 py-3 bg-primary-600 hover:bg-primary-700 
              disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg 
              font-medium transition-colors"
          >
            Upload Video
          </button>
        </div>
      </form>
    </div>
  );
};

export default UploadForm;
