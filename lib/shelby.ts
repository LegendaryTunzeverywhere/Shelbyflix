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
    const blobCommitment = generateBlobCommitment(encryptedBlob);
    
    // Step 6: Register blob on-chain
    onProgress?.({
      stage: 'registering',
      progress: 50,
      message: 'Registering blob on Shelbynet...',
    });

    const expirationDays = metadata.availabilityPeriod || 30;
    
    // Note: This requires wallet signature
    const { hash, blobId } = await registerBlob(
      (window as any).aptos?.signAndSubmitTransaction,
      blobName,
      blobCommitment,
      encryptedBlob.size,
      expirationDays
    );
    
    // Step 7: Upload encrypted blob data
    onProgress?.({
      stage: 'uploading',
      progress: 70,
      message: 'Uploading encrypted video...',
    });

    await uploadBlobData(encryptedBlob, blobName);
    
    // Step 8: Finalize blob upload
    onProgress?.({
      stage: 'finalizing',
      progress: 90,
      message: 'Finalizing upload...',
    });

    await finalizeBlob(
      (window as any).aptos?.signAndSubmitTransaction,
      blobName
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
function generateBlobCommitment(blob: Blob): string {
  // TODO: Implement actual blob commitment generation per Shelbynet spec
  // For now, return a placeholder hash
  return Array.from({ length: 32 }, () => 
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
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