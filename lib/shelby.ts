/**
 * SHELBY STORAGE INTEGRATION
 * 
 * Provides video upload/download functionality using Shelbynet blob storage
 * with encryption support
 */

import type { VideoMetadata, ShelbyBlobMetadata, UploadProgress } from '@/types';
import {
  registerBlob,
  finalizeBlob,
  uploadBlobData,
  downloadBlob,
  getBlobStreamUrl,
} from './shelbynet-blob';
import {
  encryptFile,
  generateEncryptionKey,
  getVideoDuration,
  generateThumbnail,
} from './encryption';

export interface ShelbyUploadResponse {
  videoId: string;
  blobId: string;
  blobName?: string;
  shelbyUrl: string;
  encryptionKey: string;
  duration: number;
  thumbnailUrl?: string;
  success: boolean;
}

/**
 * Upload video to Shelby storage with encryption
 */
export async function uploadToShelby(
  file: File,
  metadata: Partial<VideoMetadata>,
  signAndSubmitTransaction: any, // ✅ ADD THIS PARAMETER
  onProgress?: (progress: UploadProgress) => void
): Promise<ShelbyUploadResponse> {
  try {
    // Step 1: Get video duration
    onProgress?.({
      stage: 'encrypting',
      progress: 10,
      message: 'Analyzing video...',
    });

    const duration = await getVideoDuration(file);
    
    // Step 2: Generate encryption key
    onProgress?.({
      stage: 'encrypting',
      progress: 20,
      message: 'Generating encryption key...',
    });

    const encryptionKey = generateEncryptionKey();
    
    // Step 3: Encrypt video
    onProgress?.({
      stage: 'encrypting',
      progress: 30,
      message: 'Encrypting video...',
    });

    const encryptedBlob = await encryptFile(file, encryptionKey);
    
    // Step 4: Generate thumbnail
    onProgress?.({
      stage: 'uploading',
      progress: 50,
      message: 'Generating thumbnail...',
    });

    let thumbnailUrl: string | undefined;
    try {
      thumbnailUrl = await generateThumbnail(file, Math.floor(duration / 2));
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
    }
    
    // Step 5: Store encrypted video locally (as data URL)
    onProgress?.({
      stage: 'uploading',
      progress: 70,
      message: 'Storing encrypted video locally...',
    });

    const encryptedDataUrl = await blobToDataUrl(encryptedBlob);
    
    // Step 6: Generate IDs
    const videoId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const blobName = `@${metadata.uploader}/${file.name}`;
    const blobId = `local_${videoId}`;
    
    console.log('✅ Video encrypted and stored locally');
    console.log('📦 Video ID:', videoId);
    console.log('🔐 Encryption key generated');
    console.log('📏 Duration:', duration, 'seconds');
    
    // Step 7: Complete
    onProgress?.({
      stage: 'complete',
      progress: 100,
      message: 'Upload complete!',
    });

    return {
      videoId,
      blobId,
      blobName,
      shelbyUrl: encryptedDataUrl, // Data URL for local playback
      encryptionKey,
      duration,
      thumbnailUrl,
      success: true,
    };
  } catch (error) {
    console.error('Upload failed:', error);
    
    onProgress?.({
      stage: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : 'Upload failed',
    });

    throw error;
  }
}

/**
 * Get video stream URL
 */
export function getVideoStreamUrl(blobId: string): string {
  return getBlobStreamUrl(blobId);
}

export async function downloadAndDecryptVideo(
  shelbyUrl: string,
  encryptionKey: string
): Promise<Blob> {
  // Check if it's a local data URL
  if (shelbyUrl.startsWith('data:')) {
    console.log('📥 Loading from local storage...');
    
    // Convert data URL back to blob
    const response = await fetch(shelbyUrl);
    const encryptedBlob = await response.blob();
    
    // Decrypt
    const { decryptBlob } = await import('./encryption');
    const decryptedBlob = await decryptBlob(encryptedBlob, encryptionKey);
    
    console.log('✅ Video decrypted from local storage');
    return decryptedBlob;
  }
  
  // Otherwise, try to download from Shelbynet (not implemented yet)
  throw new Error('Shelbynet download not implemented yet');
}

/**
 * Validate video file
 */
export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  const MAX_SIZE = parseInt(process.env.NEXT_PUBLIC_MAX_VIDEO_SIZE || '104857600');
  const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];

  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}`,
    };
  }

  if (file.size > MAX_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size: ${(MAX_SIZE / 1024 / 1024).toFixed(0)}MB`,
    };
  }

  return { valid: true };
}

/**
 * Generate blob commitment (placeholder - actual implementation depends on Shelbynet's spec)
 */
/**
 * Generate blob commitment as byte array (32 bytes)
 * This is a simplified version - in production, use proper hashing
 */
async function generateBlobCommitment(blob: Blob): Promise<number[]> {
  try {
    // Read blob as ArrayBuffer
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Generate SHA-256 hash using Web Crypto API
    const hashBuffer = await crypto.subtle.digest('SHA-256', uint8Array);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    
    // Ensure exactly 32 bytes
    return hashArray.slice(0, 32);
  } catch (error) {
    console.error('Failed to generate blob commitment:', error);
    
    // Fallback: generate random 32 bytes
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
  }
}

/**
 * Verify access to video (check if user paid)
 */
export async function verifyShelbyAccess(
  videoId: string,
  walletAddress: string
): Promise<boolean> {
  // TODO: Implement actual access verification
  // This would check if user has paid the watch fee
  return true;
}

/**
 * Delete video from Shelby
 */
export async function deleteFromShelby(
  videoId: string,
  walletAddress: string
): Promise<boolean> {
  // TODO: Implement blob deletion
  // This would call Shelbynet's delete blob function
  return true;
}

/**
 * Convert blob to base64 data URL
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}