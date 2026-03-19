import type { VideoMetadata, UploadProgress } from '@/types';
import {
  registerBlob,
  uploadBlobToShelbynet,
  getBlobStreamUrl,
  computeBlobCommitments,
} from './shelbynet-blob';
import { AccountAddress } from '@aptos-labs/ts-sdk';
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
 *  3. Register on-chain with the SDK-computed Merkle root
 *  4. Upload via shelbyClient.rpc.putBlob — RPC validates against on-chain root
 */
export async function uploadToShelby(
  file: File,
  metadata: Partial<VideoMetadata>,
  uploaderAccount: AccountAddress,
  signAndSubmitTransaction: any,
  onProgress?: (progress: UploadProgress) => void
): Promise<ShelbyUploadResponse> {
  try {
    const uploaderAddress = metadata.uploader!;

    // Step 1: Analyze video
    onProgress?.({ stage: 'encrypting', progress: 5, message: 'Analyzing video...' });

    const duration = await getVideoDuration(file);
    console.log('📹 Video duration:', duration, 'seconds');

    // Step 2: Generate encryption key
    onProgress?.({ stage: 'encrypting', progress: 10, message: 'Generating encryption key...' });

    const encryptionKey = generateEncryptionKey();
    console.log('🔐 Encryption key generated');

    // Step 3: Encrypt video
    onProgress?.({ stage: 'encrypting', progress: 20, message: 'Encrypting video...' });

    const encryptedBlob = await encryptFile(file, encryptionKey);
    console.log('🔒 Video encrypted:', encryptedBlob.size, 'bytes');

    // Step 4: Generate thumbnail
    onProgress?.({ stage: 'encrypting', progress: 30, message: 'Generating thumbnail...' });

    let thumbnailUrl: string | undefined;
    try {
      thumbnailUrl = await generateThumbnail(file, Math.floor(duration / 2));
      console.log('🖼️ Thumbnail generated (data URL)');
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
    }

    // Step 5: Generate IDs & names
    const videoId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const blobName = `${videoId}_${file.name}`;

    console.log('📦 Video ID:', videoId);
    console.log('📝 Blob name:', blobName);

    // Step 6: Compute blob commitments via official SDK
    // This applies Clay erasure coding before hashing — the only way to get a
    // Merkle root that matches what the Shelbynet storage API will compute.
    onProgress?.({ stage: 'uploading', progress: 35, message: 'Computing blob commitments...' });

    const encryptedBuffer = await encryptedBlob.arrayBuffer();
    const commitments = await computeBlobCommitments(encryptedBuffer);
    console.log('🔏 Blob commitments generated (SDK erasure coding + Merkle root)');

    // Step 7: Register blob on Shelbynet blockchain
    onProgress?.({
      stage: 'uploading',
      progress: 40,
      message: 'Registering on Shelbynet... (approve wallet)',
    });

    console.log('📝 Registering blob on Shelbynet blockchain...');
    const { hash: registerHash, blobId } = await registerBlob(
      signAndSubmitTransaction,
      blobName,
      commitments,
      uploaderAccount,
      metadata.availabilityPeriod || 30
    );

    console.log('✅ Blob registered on blockchain');
    console.log('   Transaction:', registerHash);
    console.log('   Blob ID:', blobId);

    // Step 8: Upload encrypted video to Shelbynet storage
    // The SDK's putBlob validates the upload against the on-chain Merkle root.
    onProgress?.({ stage: 'uploading', progress: 50, message: 'Uploading to Shelbynet storage...' });

    console.log('📤 Uploading encrypted video to Shelbynet...');
    await uploadBlobToShelbynet(
      encryptedBlob,
      blobName,
      uploaderAddress,
      (uploadProgress) => {
        onProgress?.({
          stage: 'uploading',
          progress: 50 + uploadProgress * 0.45, // 50% → 95%
          message: `Uploading to Shelbynet... ${uploadProgress}%`,
        });
      }
    );

    console.log('✅ Video uploaded to Shelbynet storage');

    // Step 9: Generate Shelbynet URL
    const shelbyUrl = getBlobStreamUrl(blobName, uploaderAddress);
    console.log('🌐 Shelbynet URL:', shelbyUrl);

    // Step 10: Complete
    onProgress?.({ stage: 'complete', progress: 100, message: 'Upload complete!' });

    console.log('✅ Upload complete!');
    console.log('📊 Summary:');
    console.log('   - Video ID:', videoId);
    console.log('   - Blob ID:', blobId);
    console.log('   - Register Tx:', registerHash);
    console.log('   - Shelbynet URL:', shelbyUrl);

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
    console.log('✅ Using cached video');
    return cached;
  }

  // Deduplicate in-flight requests for the same blob
  if (inFlightRequests.has(cacheKey)) {
    console.log('⏳ Waiting for in-flight download...');
    return inFlightRequests.get(cacheKey)!;
  }

  const promise = (async () => {
    console.log('📥 Downloading from Shelbynet...');
    console.log('   URL:', shelbyUrl);

    const response = await fetch(shelbyUrl, { signal });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const encryptedBlob = await response.blob();
    console.log('📦 Downloaded encrypted video:', encryptedBlob.size, 'bytes');

    console.log('🔓 Decrypting video...');
    const decryptedBlob = await decryptBlob(encryptedBlob, encryptionKey);
    console.log('✅ Video decrypted:', decryptedBlob.size, 'bytes');

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
    console.log("🗑️ Removed oldest cached video");
  }

  videoCache.set(key, blob);
  console.log(`💾 Cached video (${videoCache.size}/${MAX_CACHE_SIZE})`);
}

export function clearVideoCache(): void {
  videoCache.clear();
  console.log("🗑️ Video cache cleared");
}

/**
 * Delete video (Shelbynet blobs expire automatically)
 */
export async function deleteFromShelby(
  videoId: string,
  shelbyUrl: string,
  blobName: string,
  signAndSubmitTransaction: any
): Promise<boolean> {
  try {
    console.log('🗑️ Deleting video...');

    const cacheKey = `video_${blobName}`;
    if (videoCache.has(cacheKey)) {
      videoCache.delete(cacheKey);
      console.log('✅ Removed from cache');
    }

    console.log('ℹ️ Shelbynet blob will expire automatically based on availability period');

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

