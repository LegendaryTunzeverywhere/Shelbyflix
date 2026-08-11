import type { VideoMetadata, UploadProgress } from '@/types';
import {
  registerBlob,
  uploadBlobToShelbynet,
  getBlobStreamUrl,
  computeBlobCommitments,
} from './shelbynet-blob';
import { AccountAddress, type InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';
import {
  encryptFile,
  decryptBlob,
  generateEncryptionKey,
  getVideoDuration,
  generateThumbnail,
} from './encryption';

export interface ShelbyUploadResponse {
  videoId: string;
  blobId: string;
  blobName: string;
  shelbyUrl: string;
  encryptionKey: string;
  duration: number;
  thumbnailUrl?: string;
  success: boolean;
}

/**
 * Upload video to Shelbynet (blockchain + storage)
 *
 * Flow:
 *  1. Encrypt the video
 *  2. Compute BlobCommitments via the official SDK (erasure coding + Merkle root)
 *  3. Register on-chain with the SDK-computed Merkle root (register_blob transaction)
 *  4. Upload via commit_object transaction with chunked blob data embedded
 */
export async function uploadToShelby(
  file: File,
  metadata: Partial<VideoMetadata>,
  uploaderAccount: AccountAddress | { toString: () => string },
  signAndSubmitTransaction: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>,
  onProgress?: (progress: UploadProgress) => void
): Promise<ShelbyUploadResponse> {
  try {
    const uploaderAddress = metadata.uploader!;
    // Normalise — Google keyless auth returns a plain object, wallet returns AccountAddress
    const resolvedAccount = uploaderAccount instanceof AccountAddress
      ? uploaderAccount
      : AccountAddress.fromString(uploaderAddress);

    // Step 1: Analyze video
    onProgress?.({ stage: 'encrypting', progress: 5, message: 'Analyzing video...' });

    const duration = await getVideoDuration(file);

    // Step 2: Generate encryption key
    onProgress?.({ stage: 'encrypting', progress: 10, message: 'Generating encryption key...' });

    const encryptionKey = generateEncryptionKey();

    // Step 3: Encrypt video
    onProgress?.({ stage: 'encrypting', progress: 20, message: 'Encrypting video...' });

    const encryptedBlob = await encryptFile(file, encryptionKey);

    // Step 4: Generate thumbnail
    onProgress?.({ stage: 'encrypting', progress: 30, message: 'Generating thumbnail...' });

    let thumbnailUrl: string | undefined;
    try {
      thumbnailUrl = await generateThumbnail(file, Math.floor(duration / 2));
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
    }

    // Step 5: Generate IDs & names
    const videoId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const blobName = `${videoId}_${file.name}`;

    // Step 6: Compute blob commitments via official SDK
    // This applies Clay erasure coding before hashing — the only way to get a
    // Merkle root that matches what the Shelbynet storage API will compute.
    onProgress?.({ stage: 'uploading', progress: 35, message: 'Computing blob commitments...' });

    const encryptedBuffer = await encryptedBlob.arrayBuffer();
    const commitments = await computeBlobCommitments(encryptedBuffer);

    // Step 7: Register blob on Shelbynet blockchain
    onProgress?.({
      stage: 'uploading',
      progress: 40,
      message: 'Registering on Shelbynet... (approve wallet)',
    });

    const { hash: _registerHash, blobId } = await registerBlob(
      signAndSubmitTransaction,
      blobName,
      commitments,
      resolvedAccount,
      metadata.availabilityPeriod || 30
    );

    // Step 8: Upload encrypted video to Shelbynet storage using commit_object
    onProgress?.({ stage: 'uploading', progress: 50, message: 'Uploading to Shelbynet storage...' });

    await uploadBlobToShelbynet(
      signAndSubmitTransaction,
      encryptedBlob,
      blobName,
      blobId,
      uploaderAddress,
      (uploadProgress) => {
        onProgress?.({
          stage: 'uploading',
          progress: 50 + uploadProgress * 0.45, // 50% → 95%
          message: `Uploading to Shelbynet... ${uploadProgress}%`,
        });
      }
    );

    // Step 9: Generate Shelbynet URL
    const shelbyUrl = getBlobStreamUrl(blobName, uploaderAddress);

    // Step 10: Complete
    onProgress?.({ stage: 'complete', progress: 100, message: 'Upload complete!' });

    return {
      videoId,
      blobId,
      blobName,
      shelbyUrl,
      encryptionKey,
      duration,
      thumbnailUrl,
      success: true,
    };
  } catch (error) {
    console.error('❌ Upload failed:', error);

    onProgress?.({
      stage: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : 'Upload failed',
    });

    throw error;
  }
}

/**
 * Download and decrypt video from Shelbynet
 */
export async function downloadAndDecryptVideo(
  shelbyUrl: string,
  encryptionKey: string,
  blobName: string,
  signal?: AbortSignal
): Promise<Blob> {
  const cacheKey = `video_${blobName}`;

  // Check cache first — this short-circuits the double-invoke
  const cached = getCachedVideo(cacheKey);
  if (cached) {
    return cached;
  }

  // Deduplicate in-flight requests for the same blob
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!;
  }

  const promise = (async () => {
    const response = await fetch(shelbyUrl, { signal });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const encryptedBlob = await response.blob();

    const decryptedBlob = await decryptBlob(encryptedBlob, encryptionKey);

    cacheVideo(cacheKey, decryptedBlob);
    return decryptedBlob;
  })();

  inFlightRequests.set(cacheKey, promise);
  promise.finally(() => inFlightRequests.delete(cacheKey));

  return promise;
}

const inFlightRequests = new Map<string, Promise<Blob>>();

// Video caching
const videoCache = new Map<string, Blob>();
const MAX_CACHE_SIZE = 5;

function getCachedVideo(key: string): Blob | null {
  return videoCache.get(key) || null;
}

function cacheVideo(key: string, blob: Blob): void {
  if (videoCache.size >= MAX_CACHE_SIZE) {
    const firstKey = videoCache.keys().next().value;
    videoCache.delete(firstKey!);
  }

  videoCache.set(key, blob);
}

export function clearVideoCache(): void {
  videoCache.clear();
}

/**
 * Delete video (Shelbynet blobs expire automatically)
 */
export async function deleteFromShelby(
  videoId: string,
  shelbyUrl: string,
  blobName: string,
  _signAndSubmitTransaction?: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>
): Promise<boolean> {
  try {
    const cacheKey = `video_${blobName}`;
    if (videoCache.has(cacheKey)) {
      videoCache.delete(cacheKey);
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to delete:', error);
    return false;
  }
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

export function formatAddress(address: string | null | undefined): string {
  if (!address) return '';
  if (address.length <= 10) return address; // If address is too short, return as is
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

export function sanitizeUrl(url: string): string {
  // Basic sanitization: check if it's a data URL or starts with http(s)://
  if (url.startsWith("data:")) {
    return url;
  }
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return url;
    }
  } catch (error) {
    // Invalid URL, return empty string or a placeholder
  }
  return "";
}