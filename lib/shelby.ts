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
    
    // Step 4: Generate thumbnail (optional)
    onProgress?.({
      stage: 'uploading',
      progress: 40,
      message: 'Generating thumbnail...',
    });

    let thumbnailUrl: string | undefined;
    try {
      thumbnailUrl = await generateThumbnail(file, Math.floor(duration / 2));
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
    }
    
    // Step 5: Generate blob name and commitment
    const videoId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const blobName = `@${metadata.uploader}/${file.name}`;
    const blobCommitment = await generateBlobCommitment(encryptedBlob); // ✅ ADD await
    
    // Step 6: Register blob on-chain
    onProgress?.({
      stage: 'registering',
      progress: 50,
      message: 'Registering blob on Shelbynet...',
    });

    const expirationDays = metadata.availabilityPeriod || 30;
    
    // Note: This requires wallet signature
    const { hash, blobId } = await registerBlob(
      signAndSubmitTransaction, // ✅ CORRECT
      blobName,
      blobCommitment,
      encryptedBlob.size,
      expirationDays
    );
    
    // Step 7: Upload encrypted blob data with progress
    onProgress?.({
      stage: 'uploading',
      progress: 70,
      message: 'Uploading encrypted video to Shelbynet...',
    });

    await uploadBlobData(encryptedBlob, blobName, metadata.uploader!);
    
    // Step 8: Finalize blob upload
    onProgress?.({
      stage: 'finalizing',
      progress: 90,
      message: 'Finalizing upload...',
    });

    // Finalize with proper parameters
    await finalizeBlob(
      signAndSubmitTransaction,
      blobName,
      0, // chunkset_index (single chunk)
      [0], // chunk_indices (first chunk)
      [] // data_hashes (empty for now)
    );
    
    // Step 9: Complete
    onProgress?.({
      stage: 'complete',
      progress: 100,
      message: 'Upload complete!',
    });

    return {
      videoId,
      blobId,
      shelbyUrl: getBlobStreamUrl(blobId),
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

/**
 * Download and decrypt video
 */
export async function downloadAndDecryptVideo(
  blobId: string,
  encryptionKey: string
): Promise<Blob> {
  const encryptedBlob = await downloadBlob(blobId);
  
  // Import decryption here to avoid circular dependency
  const { decryptBlob } = await import('./encryption');
  return decryptBlob(encryptedBlob, encryptionKey);
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