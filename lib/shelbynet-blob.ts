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
 * Applies Clay erasure coding before hashing — the only way to match
 * what the Shelbynet storage API validates against.
 */
export async function computeBlobCommitments(data: ArrayBuffer): Promise<BlobCommitments> {
  const buffer = Buffer.from(data);
  const provider = await createDefaultErasureCodingProvider();
  return generateCommitments(provider, buffer);
}

/**
 * Register a blob on Shelbynet blockchain.
 * Step 1 of 3 in the upload flow.
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

    const response = await signAndSubmitTransaction({ data: payload });
    const blobId = `blob_${Date.now()}_${blobName}`;

    return { hash: response.hash, blobId };
  } catch (error) {
    // Never expose raw error objects — sanitise before throwing
    const msg = error instanceof Error ? error.message : 'Blob registration failed';
    throw new Error(msg);
  }
}

/**
 * Add blob acknowledgement on Shelbynet blockchain.
 * Step 2 of 3 — confirms the uploader owns the blob after registration.
 * Required before putBlob will accept the upload.
 */
export async function addBlobAcknowledgement(
  signAndSubmitTransaction: any,
  blobName: string,
  uploaderAddress: AccountAddress
): Promise<{ hash: string }> {
  try {
    const payload = ShelbyBlobClient.createAddBlobAcknowledgementPayload({
      account: uploaderAddress,
      blobName,
    });

    const response = await signAndSubmitTransaction({ data: payload });
    return { hash: response.hash };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Blob acknowledgement failed';
    throw new Error(msg);
  }
}

/**
 * Upload encrypted blob to Shelbynet storage.
 * Step 3 of 3 — only works after registerBlob + addBlobAcknowledgement.
 */
export async function uploadBlobToShelbynet(
  encryptedBlob: Blob,
  blobName: string,
  uploaderAddress: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  try {
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

    onProgress?.(100);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Blob upload failed';
    throw new Error(msg);
  }
}

/**
 * Get Shelbynet blob download URL.
 */
export function getBlobStreamUrl(blobName: string, accountAddress: string): string {
  return `https://api.testnet.shelby.xyz/shelby/v1/blobs/${accountAddress}/${encodeURIComponent(blobName)}`;
}

/**
 * Download blob from Shelbynet.
 */
export async function downloadBlob(blobName: string, uploaderAddress: string): Promise<Blob> {
  const url = getBlobStreamUrl(blobName, uploaderAddress);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  return response.blob();
}
