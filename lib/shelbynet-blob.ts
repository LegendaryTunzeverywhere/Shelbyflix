import {
  type BlobCommitments,
  createDefaultErasureCodingProvider,
  generateCommitments,
  ShelbyBlobClient,
  ShelbyClient,
  expectedTotalChunksets,
} from '@shelby-protocol/sdk/browser';
import { Network, AccountAddress } from '@aptos-labs/ts-sdk';

/**
 * Generate commitments for a blob using the official Shelby SDK.
 *
 * This is the ONLY correct way to compute the Merkle root — the SDK
 * internally applies Clay erasure coding before hashing, which is what
 * the Shelbynet storage API validates against. Any manual SHA-256 chunking
 * will produce a different root and cause a 400 error on upload.
 */
export async function computeBlobCommitments(data: ArrayBuffer): Promise<BlobCommitments> {
  const buffer = Buffer.from(data);
  const provider = await createDefaultErasureCodingProvider();
  const commitments = await generateCommitments(provider, buffer);
  return commitments;
}

/**
 * Register a blob on Shelbynet blockchain using the official SDK payload builder.
 *
 * Uses ShelbyBlobClient.createRegisterBlobPayload() to ensure correct field
 * mapping (blob_merkle_root, numChunksets, etc.)
 */
export async function registerBlob(
  signAndSubmitTransaction: any,
  blobName: string,
  commitments: BlobCommitments,
  uploaderAddress: AccountAddress,
  expirationDays: number
): Promise<{ hash: string; blobId: string }> {
  try {
    const expirationMicros = (Date.now() + expirationDays * 24 * 60 * 60 * 1000) * 1000;

    const payload = ShelbyBlobClient.createRegisterBlobPayload({
      account: uploaderAddress,
      blobName,
      blobMerkleRoot: commitments.blob_merkle_root,
      encoding: 0,
      numChunksets: expectedTotalChunksets(commitments.raw_data_size),
      expirationMicros,
      blobSize: commitments.raw_data_size,
    });

    console.log('📝 Registering blob on blockchain...');

    const response = await signAndSubmitTransaction({ data: payload });

    const blobId = `blob_${Date.now()}_${blobName}`;
    console.log('✅ Blob registered successfully');

    return { hash: response.hash, blobId };
  } catch (error) {
    console.error('❌ Failed to register blob:', error);
    throw error;
  }
}

/**
 * Upload encrypted blob to Shelbynet storage using the official SDK RPC client.
 *
 * shelbyClient.rpc.putBlob() handles Content-Length and all header requirements.
 * The RPC validates the upload against the on-chain Merkle root before accepting.
 */
export async function uploadBlobToShelbynet(
  encryptedBlob: Blob,
  blobName: string,
  uploaderAddress: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  try {
    console.log(`📤 Uploading ${blobName} (${encryptedBlob.size} bytes) to Shelbynet...`);

    const shelbyClient = new ShelbyClient({
      network: Network.TESTNET,
      apiKey: process.env.NEXT_PUBLIC_SHELBY_API_KEY ?? '',
    });

    const blobData = new Uint8Array(await encryptedBlob.arrayBuffer());

    await shelbyClient.rpc.putBlob({
      account: uploaderAddress,
      blobName,
      blobData,
    });

    console.log(`✅ Blob uploaded to Shelbynet storage successfully`);
    onProgress?.(100);
  } catch (error) {
    console.error('❌ Failed to upload blob to Shelbynet:', error);
    throw error;
  }
}

/**
 * Get Shelbynet blob download URL
 */
export function getBlobStreamUrl(blobName: string, accountAddress: string): string {
  const encodedBlobName = encodeURIComponent(blobName);
  // ✅ testnet domain — matches Shelby explorer
  return `https://api.testnet.shelby.xyz/shelby/v1/blobs/${accountAddress}/${encodedBlobName}`;
}


/**
 * Download blob from Shelbynet
 */
export async function downloadBlob(
  blobName: string,
  uploaderAddress: string
): Promise<Blob> {
  try {
    const url = getBlobStreamUrl(blobName, uploaderAddress);

    console.log('📥 Downloading from Shelbynet:', url);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    console.log('✅ Downloaded:', blob.size, 'bytes');

    return blob;
  } catch (error) {
    console.error('❌ Download failed:', error);
    throw error;
  }
}