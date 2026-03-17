import { Aptos, InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';
import { aptos } from './aptos';
import type { ShelbyBlobMetadata } from '../types';

// Shelbynet blob contract address
const BLOB_CONTRACT = '0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a';

/**
 * Register a blob on Shelbynet
 */
export async function registerBlob(
  signAndSubmitTransaction: any,
  blobName: string,
  blobCommitment: number[], // ✅ CHANGED FROM string TO number[]
  blobSize: number,
  expirationDays: number
): Promise<{ hash: string; blobId: string }> {
  try {
    const expirationMicros = Date.now() * 1000 + (expirationDays * 24 * 60 * 60 * 1000 * 1000);
    
    const payload: InputGenerateTransactionPayloadData = {
      function: `${BLOB_CONTRACT}::blob_metadata::register_multiple_blobs` as `${string}::${string}::${string}`,
      typeArguments: [],
      functionArguments: [
        [blobName],
        expirationMicros.toString(),
        [blobCommitment],
        ['1'], // ✅ chunk_counts: 1 chunk (no splitting)
        [blobSize.toString()],
        '0',
        '0',
      ],
    };

    const response = await signAndSubmitTransaction({
      data: payload,
    });

    // Generate blob ID (simplified - in production use actual blob ID from events)
    const blobId = `blob_${Date.now()}_${blobName}`;

    return {
      hash: response.hash,
      blobId,
    };
  } catch (error) {
    console.error('Failed to register blob:', error);
    throw error;
  }
}

/**
 * Finalize blob upload
 */
export async function finalizeBlob(
  signAndSubmitTransaction: any,
  blobName: string,
  chunksetIndex: number,
  chunkIndex: number,
  dataHashes: number[][]
): Promise<string> {
  try {
    console.log(`📝 Finalizing blob: ${blobName}`);
    console.log(`   Chunkset: ${chunksetIndex}, Chunk: ${chunkIndex}`);
    console.log(`   Hashes: ${dataHashes.length} chunks`);
    
    const payload: InputGenerateTransactionPayloadData = {
      function: `${BLOB_CONTRACT}::blob_metadata::add_blob_acknowledgements` as `${string}::${string}::${string}`,
      typeArguments: [],
      functionArguments: [
        blobName,                    // blob_name: String
        chunksetIndex.toString(),    // chunkset_index: u32
        chunkIndex.toString(),       // chunk_index: u64
        dataHashes,                  // data_hashes: vector<vector<u8>>
      ],
    };

    console.log('📤 Submitting acknowledgement transaction...');

    const response = await signAndSubmitTransaction({
      data: payload,
    });

    console.log(`✅ Acknowledgement submitted: ${response.hash}`);

    return response.hash;
  } catch (error) {
    console.error('Failed to finalize blob:', error);
    throw error;
  }
}

/**
 * Upload encrypted blob to Shelbynet storage (single request)
 */
export async function uploadBlobData(
  encryptedBlob: Blob,
  blobName: string,
  uploaderAddress: string,
  onProgress?: (progress: number) => void
): Promise<{ chunkHashes: number[][] }> {
  try {
    console.log(`Uploading ${blobName} (${encryptedBlob.size} bytes)...`);
    
    // Generate hash for the entire blob
    const blobArrayBuffer = await encryptedBlob.arrayBuffer();
    const blobHash = await generateChunkHash(blobArrayBuffer);
    
    // Encode blob name for URL
    const encodedBlobName = encodeURIComponent(blobName);
    
    // Ensure address has 0x prefix
    const formattedAddress = uploaderAddress.startsWith('0x') 
      ? uploaderAddress 
      : `0x${uploaderAddress}`;
    
    console.log(`📤 Uploading entire blob in single request...`);
    
    const response = await fetch(
      `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${encodedBlobName}?account=${formattedAddress}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: encryptedBlob,
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Upload failed:`, response.status, errorText);
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }
    
    console.log(`✅ Blob uploaded successfully`);
    onProgress?.(100);
    
    // Return single hash in array format
    return { chunkHashes: [blobHash] };
    
  } catch (error) {
    console.error('Failed to upload blob data:', error);
    throw error;
  }
}
/**
 * Generate SHA-256 hash for a chunk
 */
async function generateChunkHash(chunkData: ArrayBuffer): Promise<number[]> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', chunkData);
  return Array.from(new Uint8Array(hashBuffer));
}

/**
 * Get blob URL for streaming
 */
export function getBlobStreamUrl(blobId: string): string {
  // TODO: Use actual Shelbynet streaming endpoint
  return `https://api.shelbynet.shelby.xyz/blob/${blobId}`;
}

/**
 * Download blob from Shelbynet with range support
 */
export async function downloadBlob(
  blobName: string,
  uploaderAddress: string
): Promise<Blob> {
  try {
    const BASE_URL = 'https://api.shelbynet.shelby.xyz/shelby/v1/blobs';
    const url = `${BASE_URL}/${blobName}`;
    
    console.log(`📥 Downloading blob: ${blobName}`);
    
    // First, get the total size
    const headResponse = await fetch(url, {
      method: 'HEAD',
    });
    
    if (!headResponse.ok) {
      throw new Error(`Failed to get blob info: ${headResponse.statusText}`);
    }
    
    const totalSize = parseInt(headResponse.headers.get('Content-Length') || '0');
    console.log(`📦 Total size: ${totalSize} bytes`);
    
    // Download in chunks (1MB at a time)
    const CHUNK_SIZE = 1024 * 1024;
    const chunks: Uint8Array[] = [];
    
    for (let start = 0; start < totalSize; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE - 1, totalSize - 1);
      
      console.log(`📥 Downloading bytes ${start}-${end}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Range': `bytes=${start}-${end}`,
        },
      });
      
      if (!response.ok && response.status !== 206) {
        throw new Error(`Download failed: ${response.statusText}`);
      }
      
      const chunkData = await response.arrayBuffer();
      chunks.push(new Uint8Array(chunkData));
    }
    
    // Combine all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    console.log('✅ Download complete');
    
    return new Blob([combined]);
  } catch (error) {
    console.error('Failed to download blob:', error);
    throw error;
  }
}