'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import type { UploadProgress } from '@/types';
import { uploadWithProgress, validateVideoFile } from '@/lib/shelby';
import { storeVideoMetadataOnChain } from '@/lib/contract';
import { SHELBYUSD_TOKEN } from '@/lib/aptos';
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
  const [price, setPrice] = useState('0');
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
      setError('Please fill in all required fields and connect your wallet');
      return;
    }

    try {
      // Stage 1: Preparing
      setProgress({ percent: 10, stage: 'preparing', message: 'Preparing asset security...' });

      // Stage 2: Uploading to Shelby Storage
      const uploadResult = await uploadWithProgress(
        file,
        account.address,
        { 
          title: title.trim(), 
          description: description.trim(),
          uploader: account.address 
        },
        (p) => {
          // Map 0-100 to 10-80 range for smoother overall UI progress
          const mappedPercent = 10 + (p * 0.7);
          setProgress({ 
            percent: Math.round(mappedPercent), 
            stage: 'uploading', 
            message: `Securing file in storage... ${p}%` 
          });
        }
      );

      if (!uploadResult.success || !uploadResult.blobId) {
        throw new Error(uploadResult.error || 'Storage securing failed');
      }

      // Stage 3: Blockchain Registration (Triggering Wallet)
      setProgress({ percent: 85, stage: 'processing', message: 'Registering ownership on blockchain... Please check your wallet popup.' });

      // Safety check: ensure signAndSubmitTransaction is available
      if (!signAndSubmitTransaction) {
        throw new Error('Wallet not ready for transaction signing');
      }

      await storeVideoMetadataOnChain(
        account.address,
        signAndSubmitTransaction,
        {
          videoId: uploadResult.blobId,
          title: title.trim(),
          description: description.trim(),
          shelbyUrl: uploadResult.shelbyUrl || `shelby://${uploadResult.blobId}`,
          uploader: account.address,
          requiredToken: SHELBYUSD_TOKEN,
          price: Math.floor(parseFloat(price) * 100000000), // Convert to Octas
        }
      );

      // Stage 4: Complete
      setProgress({ percent: 100, stage: 'complete', message: 'Video successfully published!' });

      if (onSuccess) {
        setTimeout(onSuccess, 1500);
      } else {
        setTimeout(() => router.push(`/video/${uploadResult.blobId}`), 1500);
      }
    } catch (err) {
      console.error('Publishing error:', err);
      setError(err instanceof Error ? err.message : 'Publishing failed');
      setProgress(null);
    }
  };

  const resetForm = () => {
    setFile(null);
    setTitle('');
    setDescription('');
    setPrice('0');
    setProgress(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (progress) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-100">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-50 mb-4">
              {progress.stage === 'complete' ? (
                <CheckCircleIcon className="w-10 h-10 text-green-500" />
              ) : (
                <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
              )}
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {progress.stage === 'complete' ? 'Published!' : 'Publishing Video'}
            </h2>
            <p className="text-gray-600 font-medium">{progress.message}</p>
          </div>

          <div className="mb-4">
            <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden border border-gray-200">
              <div
                className="bg-primary-600 h-full transition-all duration-300 ease-out shadow-inner"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Progress
              </span>
              <span className="text-sm font-bold text-primary-700">
                {progress.percent}%
              </span>
            </div>
          </div>

          <p className="text-xs text-center text-gray-400 mt-6">
            Do not close this window until publishing is complete.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-8 border border-gray-100">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Upload New Video</h2>
          <div className="px-3 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-full border border-green-100 uppercase tracking-tighter">
            Secure Storage Enabled
          </div>
        </div>

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
            <div className="flex items-center justify-center gap-3 bg-gray-50 p-4 rounded-lg">
              <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600">
                <CheckCircleIcon className="w-8 h-8" />
              </div>
              <div className="text-left">
                <p className="font-bold text-gray-900 truncate max-w-[200px]">{file.name}</p>
                <p className="text-xs font-medium text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  resetForm();
                }}
                className="ml-auto p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
          ) : (
            <>
              <div className="w-20 h-20 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-4 text-primary-600">
                <CloudArrowUpIcon className="w-10 h-10" />
              </div>
              <p className="text-lg font-bold text-gray-800 mb-2">
                Click or drag to upload
              </p>
              <p className="text-sm text-gray-500 font-medium">
                MP4, WebM, MOV · Max 100MB
              </p>
            </>
          )}
        </div>

        {/* Title Input */}
        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="What is your video about?"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl 
              focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 transition-all outline-none"
            required
          />
        </div>

        {/* Description Input */}
        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Tell your viewers more about this video..."
            className="w-full px-4 py-3 border border-gray-200 rounded-xl 
              focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 transition-all outline-none resize-none"
          />
        </div>

        {/* Price Input */}
        <div className="mb-8">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            Viewing Price
          </label>
          <div className="relative">
            <input
              type="number"
              step="0.00000001"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full pl-4 pr-24 py-3 border border-gray-200 rounded-xl 
                focus:ring-4 focus:ring-primary-500/10 focus:border-primary-500 transition-all outline-none font-mono"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-100 rounded text-xs font-bold text-gray-600">
              ShelbyUSD
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2 uppercase font-bold tracking-widest">
            Enter 0 for free public access
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl 
            flex items-start gap-3 shadow-sm">
            <ExclamationCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-bold text-red-700">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-4">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-6 py-4 border border-gray-200 rounded-xl 
                font-bold text-gray-600 hover:bg-gray-50 transition-all"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!file || !title.trim() || !account}
            className="flex-1 px-6 py-4 bg-primary-600 hover:bg-primary-700 
              disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl 
              font-bold transition-all shadow-lg shadow-primary-500/20 active:scale-95"
          >
            Publish Now
          </button>
        </div>
      </form>
    </div>
  );
};

export default UploadForm;
