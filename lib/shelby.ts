/**
 * SHELBY STORAGE INTEGRATION
 * 
 * This module re-exports functions from the comprehensive Shelby SDK
 * Provides backwards compatibility while using the new implementation
 */

import type { VideoStorageProvider, ShelbyUploadResponse, VideoMetadata } from '@/types';
import {
  uploadVideoToShelby,
  uploadWithProgress,
  getVideoStreamUrl,
  downloadVideoBlob,
  deleteVideoBlob,
  getBlobMetadata,
  listUserBlobs,
  validateVideoFile as sdkValidateVideoFile,
  verifyBlobAccess,
  generateThumbnail as sdkGenerateThumbnail,
} from './shelby-sdk';

// Re-export all functions
export {
  uploadVideoToShelby,
  uploadWithProgress,
  getVideoStreamUrl,
  downloadVideoBlob,
  deleteVideoBlob,
  getBlobMetadata,
  listUserBlobs,
  verifyBlobAccess,
};

/**
 * Upload video to Shelby storage (backwards compatible wrapper)
 */
export async function uploadToShelby(
  file: File,
  metadata: Partial<VideoMetadata>
): Promise<ShelbyUploadResponse> {
  // Extract wallet address from metadata or use default
  const walletAddress = metadata.uploader || '';
  
  return uploadVideoToShelby(file, walletAddress, metadata);
}

/**
 * Verify access to video on Shelby
 */
export async function verifyShelbyAccess(
  videoId: string,
  walletAddress: string
): Promise<boolean> {
  return verifyBlobAccess(videoId, walletAddress);
}

/**
 * Delete video from Shelby
 */
export async function deleteFromShelby(videoId: string, walletAddress: string): Promise<boolean> {
  return deleteVideoBlob(videoId, walletAddress);
}

/**
 * Generate video thumbnail
 */
export async function generateThumbnail(file: File): Promise<string> {
  return sdkGenerateThumbnail(file);
}

/**
 * Validate video file
 */
export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  return sdkValidateVideoFile(file);
}

// ============================================================================
// STORAGE PROVIDER IMPLEMENTATION
// ============================================================================

/**
 * Shelby Storage Provider (implements VideoStorageProvider interface)
 * This allows easy swapping with other storage providers (IPFS, Arweave, etc.)
 */
export const shelbyStorage: VideoStorageProvider = {
  upload: uploadToShelby,
  retrieve: getVideoStreamUrl,
  checkAccess: verifyShelbyAccess,
  getStreamUrl: getVideoStreamUrl,
};

export default shelbyStorage;

