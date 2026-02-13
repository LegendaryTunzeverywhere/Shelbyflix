/**
 * ============================================================================
 * SHELBY SDK INTEGRATION
 * ============================================================================
 * 
 * Official Documentation: https://docs.shelby.xyz
 * 
 * This module provides complete integration with Shelby Protocol:
 * - Upload videos to decentralized storage
 * - Stream videos with sub-second loading
 * - Delete videos (blob management)
 * - Token-gated access control
 * 
 * Shelby Network Configuration:
 * - Network: shelbynet
 * - Node URL: https://api.shelbynet.shelby.xyz/v1
 * - Faucet: https://faucet.shelbynet.shelby.xyz
 * - Indexer: https://api.shelbynet.shelby.xyz/v1/graphql
 */

import type { VideoMetadata } from '@/types';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SHELBY_API_BASE = process.env.NEXT_PUBLIC_SHELBY_API_URL || 
  'https://api.shelbynet.shelby.xyz/v1';

const SHELBY_API_KEY = process.env.NEXT_PUBLIC_SHELBY_API_KEY || 
  process.env.SHELBY_API_KEY || '';

// Blob storage endpoints (from Shelby docs)
const ENDPOINTS = {
  upload: `${SHELBY_API_BASE}/blob/upload`,
  download: `${SHELBY_API_BASE}/blob/download`,
  delete: `${SHELBY_API_BASE}/blob/delete`,
  metadata: `${SHELBY_API_BASE}/blob/metadata`,
  list: `${SHELBY_API_BASE}/blob/list`,
};

// ============================================================================
// INTERFACES
// ============================================================================

export interface ShelbyUploadResponse {
  success: boolean;
  blobId?: string;
  shelbyUrl?: string;
  transactionHash?: string;
  error?: string;
}

export interface ShelbyBlobMetadata {
  blobId: string;
  size: number;
  contentType: string;
  uploadedAt: number;
  uploader: string;
  customMetadata?: Record<string, any>;
}

export interface ShelbyDownloadResponse {
  success: boolean;
  url?: string;
  blob?: Blob;
  error?: string;
}

// ============================================================================
// UPLOAD FUNCTIONS
// ============================================================================

/**
 * Upload a video file to Shelby decentralized storage
 * 
 * @param file - Video file to upload
 * @param walletAddress - Uploader's wallet address
 * @param metadata - Optional custom metadata
 * @returns Upload response with blob ID and URL
 * 
 * @example
 * ```typescript
 * const response = await uploadVideoToShelby(videoFile, walletAddress, {
 *   title: "My Video",
 *   description: "A cool video"
 * });
 * if (response.success) {
 *   console.log("Blob ID:", response.blobId);
 *   console.log("URL:", response.shelbyUrl);
 * }
 * ```
 */
export async function uploadVideoToShelby(
  file: File,
  walletAddress: string,
  metadata?: Partial<VideoMetadata>
): Promise<ShelbyUploadResponse> {
  try {
    console.log('📤 Uploading to Shelby...', {
      fileName: file.name,
      fileSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      uploader: walletAddress,
    });

    // Prepare form data
    const formData = new FormData();
    formData.append('file', file);
    formData.append('uploader', walletAddress);
    
    // Add custom metadata
    if (metadata) {
      formData.append('metadata', JSON.stringify({
        title: metadata.title,
        description: metadata.description,
        contentType: file.type,
        uploadTimestamp: Date.now(),
      }));
    }

    // Upload to Shelby
    const response = await fetch(ENDPOINTS.upload, {
      method: 'POST',
      headers: {
        // Note: Do NOT set Content-Type header - browser will set it with boundary for FormData
        ...(SHELBY_API_KEY && { 'Authorization': `Bearer ${SHELBY_API_KEY}` }),
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    console.log('✅ Upload successful:', data);

    return {
      success: true,
      blobId: data.blobId || data.id || data.blob_id,
      shelbyUrl: data.url || `shelby://${data.blobId}`,
      transactionHash: data.transactionHash || data.txHash,
    };

  } catch (error) {
    console.error('❌ Shelby upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    };
  }
}

/**
 * Upload with progress tracking
 * 
 * @param file - Video file
 * @param walletAddress - Uploader's wallet address  
 * @param metadata - Optional metadata
 * @param onProgress - Progress callback (0-100)
 * @returns Upload response
 */
export async function uploadWithProgress(
  file: File,
  walletAddress: string,
  metadata: Partial<VideoMetadata> | undefined,
  onProgress: (progress: number) => void
): Promise<ShelbyUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        onProgress(Math.round(percentComplete));
      }
    });

    // Handle completion
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve({
            success: true,
            blobId: data.blobId || data.id,
            shelbyUrl: data.url || `shelby://${data.blobId}`,
            transactionHash: data.transactionHash,
          });
        } catch (error) {
          reject(new Error('Failed to parse response'));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    });

    // Handle errors
    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload cancelled'));
    });

    // Prepare form data
    const formData = new FormData();
    formData.append('file', file);
    formData.append('uploader', walletAddress);
    if (metadata) {
      formData.append('metadata', JSON.stringify(metadata));
    }

    // Start upload
    xhr.open('POST', ENDPOINTS.upload);
    if (SHELBY_API_KEY) {
      xhr.setRequestHeader('Authorization', `Bearer ${SHELBY_API_KEY}`);
    }
    xhr.send(formData);
  });
}

// ============================================================================
// DOWNLOAD FUNCTIONS
// ============================================================================

/**
 * Get streaming URL for a video blob
 * 
 * @param blobId - Blob ID from upload
 * @param walletAddress - Requesting user's wallet address (for access control)
 * @returns Streaming URL
 * 
 * @example
 * ```typescript
 * const streamUrl = await getVideoStreamUrl("blob_123", walletAddress);
 * // Use with <video> tag or React Player
 * <video src={streamUrl} />
 * ```
 */
export async function getVideoStreamUrl(
  blobId: string,
  walletAddress: string
): Promise<string> {
  try {
    console.log('🎥 Getting stream URL...', { blobId, walletAddress });

    // Request download URL from Shelby
    const response = await fetch(`${ENDPOINTS.download}/${blobId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(SHELBY_API_KEY && { 'Authorization': `Bearer ${SHELBY_API_KEY}` }),
        'X-Wallet-Address': walletAddress,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get stream URL: ${response.statusText}`);
    }

    const data = await response.json();

    // Shelby returns a signed URL with access token
    const streamUrl = data.url || data.downloadUrl || data.streamUrl;

    console.log('✅ Stream URL obtained');

    return streamUrl;

  } catch (error) {
    console.error('❌ Error getting stream URL:', error);
    throw error;
  }
}

/**
 * Download video blob as file
 * 
 * @param blobId - Blob ID
 * @param walletAddress - Requesting user's wallet
 * @returns Blob data
 */
export async function downloadVideoBlob(
  blobId: string,
  walletAddress: string
): Promise<ShelbyDownloadResponse> {
  try {
    const streamUrl = await getVideoStreamUrl(blobId, walletAddress);

    // Fetch the actual blob data
    const response = await fetch(streamUrl);

    if (!response.ok) {
      throw new Error('Download failed');
    }

    const blob = await response.blob();

    return {
      success: true,
      blob,
      url: streamUrl,
    };

  } catch (error) {
    console.error('❌ Download error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Download failed',
    };
  }
}

// ============================================================================
// DELETE FUNCTIONS
// ============================================================================

/**
 * Delete a video blob from Shelby storage
 * 
 * @param blobId - Blob ID to delete
 * @param walletAddress - Owner's wallet address (must be uploader)
 * @returns Success status
 * 
 * @example
 * ```typescript
 * const deleted = await deleteVideoBlob("blob_123", walletAddress);
 * if (deleted) {
 *   console.log("Video deleted successfully");
 * }
 * ```
 */
export async function deleteVideoBlob(
  blobId: string,
  walletAddress: string
): Promise<boolean> {
  try {
    console.log('🗑️ Deleting blob...', { blobId, uploader: walletAddress });

    const response = await fetch(`${ENDPOINTS.delete}/${blobId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(SHELBY_API_KEY && { 'Authorization': `Bearer ${SHELBY_API_KEY}` }),
        'X-Wallet-Address': walletAddress,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Delete failed: ${response.statusText} - ${errorText}`);
    }

    console.log('✅ Blob deleted successfully');

    return true;

  } catch (error) {
    console.error('❌ Delete error:', error);
    return false;
  }
}

// ============================================================================
// METADATA FUNCTIONS
// ============================================================================

/**
 * Get metadata for a blob
 * 
 * @param blobId - Blob ID
 * @returns Blob metadata
 */
export async function getBlobMetadata(
  blobId: string
): Promise<ShelbyBlobMetadata | null> {
  try {
    const response = await fetch(`${ENDPOINTS.metadata}/${blobId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(SHELBY_API_KEY && { 'Authorization': `Bearer ${SHELBY_API_KEY}` }),
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch metadata');
    }

    const data = await response.json();

    return {
      blobId: data.blobId || data.id,
      size: data.size,
      contentType: data.contentType || data.mimeType,
      uploadedAt: data.uploadedAt || data.timestamp,
      uploader: data.uploader || data.owner,
      customMetadata: data.metadata,
    };

  } catch (error) {
    console.error('Error fetching blob metadata:', error);
    return null;
  }
}

/**
 * List all blobs for a wallet address
 * 
 * @param walletAddress - Wallet address
 * @returns Array of blob IDs
 */
export async function listUserBlobs(
  walletAddress: string
): Promise<string[]> {
  try {
    const response = await fetch(`${ENDPOINTS.list}?uploader=${walletAddress}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(SHELBY_API_KEY && { 'Authorization': `Bearer ${SHELBY_API_KEY}` }),
      },
    });

    if (!response.ok) {
      throw new Error('Failed to list blobs');
    }

    const data = await response.json();

    return data.blobs || data.blobIds || [];

  } catch (error) {
    console.error('Error listing blobs:', error);
    return [];
  }
}

// ============================================================================
// VALIDATION & UTILITIES
// ============================================================================

/**
 * Validate video file before upload
 */
export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  const MAX_SIZE = 500 * 1024 * 1024; // 500MB for Shelby
  const ALLOWED_TYPES = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-matroska', // MKV
    'video/avi',
  ];

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Supported: MP4, WebM, MOV, MKV, AVI',
    };
  }

  if (file.size > MAX_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${MAX_SIZE / 1024 / 1024}MB`,
    };
  }

  return { valid: true };
}

/**
 * Verify access to a blob (check token ownership)
 */
export async function verifyBlobAccess(
  blobId: string,
  walletAddress: string
): Promise<boolean> {
  try {
    // In production, Shelby would verify token ownership server-side
    // For now, we rely on the checkTokenOwnership function in aptos.ts
    
    // Attempt to get stream URL - if successful, user has access
    const url = await getVideoStreamUrl(blobId, walletAddress);
    return !!url;

  } catch (error) {
    console.error('Access verification failed:', error);
    return false;
  }
}

/**
 * Generate video thumbnail from blob
 */
export async function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Canvas context not available'));
      return;
    }

    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      video.currentTime = Math.min(1, video.duration / 2); // Middle of video
    };

    video.onseeked = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
      URL.revokeObjectURL(video.src);
      resolve(thumbnail);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video'));
    };

    video.src = URL.createObjectURL(file);
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Upload
  uploadVideoToShelby,
  uploadWithProgress,
  
  // Download
  getVideoStreamUrl,
  downloadVideoBlob,
  
  // Delete
  deleteVideoBlob,
  
  // Metadata
  getBlobMetadata,
  listUserBlobs,
  
  // Utilities
  validateVideoFile,
  verifyBlobAccess,
  generateThumbnail,
};
