import {
  type BlobCommitments,
  createDefaultErasureCodingProvider,
  generateCommitments,
  ShelbyBlobClient,
  ShelbyRPCClient,
  getAptosTransactionExplorerUrl,
  getShelbyBlobExplorerUrl,
} from '@shelby-protocol/sdk/browser';
import { Aptos, AptosConfig, Network, AccountAddress, type InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';

// Use the Shelbynet node for submitting and confirming blob transactions.
// Falls back to shelbynet-1 mainnet if the env var is not set.
const shelbynetAptos = new Aptos(new AptosConfig({
  network: Network.CUSTOM,
  fullnode: process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL ?? 'https://api.shelbynet.shelby.xyz/v1',
  indexer: process.env.NEXT_PUBLIC_SHELBYNET_INDEXER_URL ?? 'https://api.shelbynet.shelby.xyz/v1/graphql',
}));

/**
 * Generate commitments for a blob using the official Shelby SDK.
 * Applies Clay erasure coding before hashing — the only way to match
 * what the Shelbynet storage API validates against.
 */
export async function computeBlobCommitments(data: ArrayBuffer): Promise<BlobCommitments> {
  const buffer = new Uint8Array(data);
  const provider = await createDefaultErasureCodingProvider();
  return generateCommitments(provider, buffer);
}

export { ShelbyBlobClient, ShelbyRPCClient };

/**
 * Register a blob on Shelbynet blockchain.
 * Waits for the transaction to be confirmed on-chain and throws a clear error
 * if the Move VM aborts (e.g. E_INSUFFICIENT_FUNDS).
 * 
 * ⚠️ CRITICAL: The UID must be generated BEFORE calling register_blob and must
 * be the same UID used later in commit_object. Using Date.now() ensures uniqueness.
 */
export async function registerBlob(
  signAndSubmitTransaction: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>,
  blobName: string,
  commitments: BlobCommitments,
  uploaderAddress: AccountAddress,
  expirationDays: number,
  blobUid?: number // Optional: if not provided, we'll generate one
): Promise<{ hash: string; blobId: string; blobUid: number }> {
  const primaryContractAddress   = process.env.NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS;
  const fallbackContractAddress  = process.env.NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS_FALLBACK;

  // Generate UID for this blob if not provided
  // This MUST be used in both register_blob and commit_object
  const uid = blobUid ?? Date.now();
  console.log(`🔢 Generated/Using UID for blob registration: ${uid}`);

  const attemptRegistration = async (contractAddress?: string) => {
    const expirationMicros = (Date.now() + expirationDays * 24 * 60 * 60 * 1000) * 1000;

    const merkleRoot = commitments.blob_merkle_root;
    if (typeof merkleRoot !== 'string') {
      throw new Error('Invalid merkle root format: expected a hex string');
    }

    // ---------------------------------------------------------------------
    // FIX: this previously hand-built a raw 10-argument payload with fields
    // that don't exist in the real register_blob function — 'shelbynet-1'
    // as a "location name", null as a "sponsor", plus made-up "oracle base
    // rate" / "premium bps" / "payment tier ID" arguments. Turns out the
    // *concept* of a location argument was real (see selectedLocation
    // below) — it was just built against a stale SDK version with the
    // wrong shape. Upgraded @shelby-protocol/sdk from ^0.2.4 to ^0.4.1,
    // which added: (a) selectedLocation/locationHint arguments (both
    // optional — left unset here rather than guessing at valid values),
    // and (b) a required trailing `encryption` argument as of the
    // contract's encryption upgrade (SDK's internal reference: "#1739").
    // Omitting `encryption` defaults to "Unencrypted" on-chain — but our
    // blobs ARE encrypted (client-side AES-256-GCM, see lib/encryption.ts),
    // so every blob registered so far has been mismarked. The SDK exposes
    // exactly two valid values: "Unencrypted" | "AES_GCM_V1" — ours maps
    // directly to AES_GCM_V1. This mismatch (content encrypted, but
    // declared Unencrypted on-chain) is the most likely explanation for
    // blobs showing "not found" in the explorer after an apparently
    // successful upload — the storage/indexing layer may reject or
    // mis-handle blobs whose declared encryption doesn't match their
    // actual content.
    // ---------------------------------------------------------------------
    const payload = ShelbyBlobClient.createRegisterBlobPayload({
      deployer: contractAddress ? AccountAddress.fromString(contractAddress) : undefined,
      account: uploaderAddress,
      blobName,
      blobMerkleRoot: merkleRoot,
      blobSize: commitments.raw_data_size,
      expirationMicros,
      numChunksets: commitments.chunkset_commitments.length,
      encoding: 0,
      encryption: 'AES_GCM_V1',
    });

    console.log('Registering blob with contract:', contractAddress || '(SDK default: SHELBY_DEPLOYER)');
    console.log(
      '📦 Payload function arguments:',
      JSON.stringify(
        payload.functionArguments?.map((arg) => (arg instanceof Uint8Array ? Array.from(arg) : arg)),
        null,
        2,
      ),
    );

    // Submit the transaction
    const response = await signAndSubmitTransaction({ data: payload });
    const txHash: unknown = (response as { hash?: unknown })?.hash;
    if (typeof txHash !== 'string' || txHash.length === 0) {
      throw new Error('Wallet returned no transaction hash for registerBlob');
    }

    console.log(`📝 Registration transaction submitted: ${txHash}`);
    console.log(`🔗 Aptos explorer: ${getAptosTransactionExplorerUrl('shelbynet', txHash)}`);
    console.log(`🔗 Or view at: https://explorer.shelby.xyz/txn/${txHash}`);

    // ── CRITICAL: Wait for the transaction to be confirmed on-chain ──────────
    // Without this, a Move abort (e.g. E_INSUFFICIENT_FUNDS) is invisible —
    // we'd get a hash back and immediately try to upload, which fails because
    // the blob was never registered.
    let txResult: { success?: boolean; vm_status?: string } | unknown;
    try {
      console.log(`⏳ Waiting for transaction confirmation...`);
      txResult = await shelbynetAptos.waitForTransaction({
        transactionHash: txHash,
        options: { checkSuccess: false }, // we check manually below for a better error message
      });
    } catch (waitError) {
      // waitForTransaction itself can throw if the tx is dropped or times out
      throw new Error(
        `Blob registration transaction did not confirm: ${waitError instanceof Error ? waitError.message : String(waitError)}`
      );
    }

    // Check the on-chain result — a Move abort still produces a tx entry with success=false
    const txRes = txResult as { success?: boolean; vm_status?: string };
    console.log(`📊 Transaction result:`, { success: txRes.success, vm_status: txRes.vm_status });
    
    if (txRes.success === false) {
      const vmStatus: string = txRes.vm_status ?? '';

      // Parse the human-readable abort reason from the VM status string
      if (vmStatus.includes('E_INSUFFICIENT_FUNDS') || vmStatus.includes('0x2')) {
        const fileSizeMB = (commitments.raw_data_size / 1024 / 1024).toFixed(2);
        const networkName = process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'SHELBYNET';
        const faucetUrl = networkName === 'TESTNET' 
          ? 'https://faucet.testnet.shelby.xyz'
          : 'https://faucet.shelbynet.shelby.xyz';
        throw new Error(
          `Insufficient ShelbyUSD balance to register this blob (${fileSizeMB} MB). ` +
          `Please get more ShelbyUSD from the faucet at ${faucetUrl}, ` +
          `then try again.`
        );
      }

      // Generic abort — surface the VM status so the developer can diagnose
      throw new Error(
        `Blob registration failed on-chain: ${vmStatus || 'Unknown VM error'}`
      );
    }

    const blobId = `blob_${uid}_${blobName}`;
    console.log(`✅ Blob registered successfully on-chain`);
    console.log(`📝 Blob ID: ${blobId}`);
    console.log(`🔗 Transaction: ${txHash}`);
    console.log(`🔗 Blob explorer: ${getShelbyBlobExplorerUrl('shelbynet', uploaderAddress.toString(), blobName)}`);
    
    // Verify the blob exists on-chain before returning
    console.log(`🔍 Verifying blob registration on-chain...`);
    try {
      const blobClient = new ShelbyBlobClient({
        network: Network.SHELBYNET,
        aptos: {
          network: Network.CUSTOM,
          fullnode: process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL ?? 'https://api.shelbynet.shelby.xyz/v1',
        },
      });
      
      const metadata = await blobClient.getFullObjectMetadata({
        account: uploaderAddress,
        name: blobName,
      });
      
      if (metadata) {
        console.log(`✅ Blob metadata found on-chain:`, {
          owner: metadata.owner.toString(),
          size: metadata.size,
          encoding: metadata.encoding,
          encryption: metadata.encryption,
          isWritten: metadata.isWritten,
        });
        if (!metadata.isWritten) {
          console.warn(
            `⚠️  Blob is registered but NOT YET COMMITTED (isWritten: false). ` +
            `This blob will not resolve by name (e.g. in the explorer) until ` +
            `commit_object is called with the storage-provider acks from the ` +
            `chunkset upload. See TODO in uploadToShelby() for the missing step.`,
          );
        }
      } else {
        console.warn(`⚠️  Blob metadata not found on-chain yet (may need time to propagate)`);
      }
    } catch (verifyError) {
      console.warn(`⚠️  Could not verify blob on-chain:`, verifyError instanceof Error ? verifyError.message : String(verifyError));
    }
    
    return { hash: txHash, blobId, blobUid: uid };
  };

  try {
    console.log(`📝 Registering blob with primary contract: ${primaryContractAddress}`);
    return await attemptRegistration(primaryContractAddress);
  } catch (primaryError) {
    // Don't retry on insufficient funds — retrying won't help
    const msg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    if (msg.includes('Insufficient ShelbyUSD') || msg.includes('E_INSUFFICIENT_FUNDS')) {
      throw primaryError;
    }

    console.warn('⚠️  Primary contract failed:', primaryError);

    if (fallbackContractAddress) {
      try {
        console.log(`📝 Retrying with fallback contract: ${fallbackContractAddress}`);
        return await attemptRegistration(fallbackContractAddress);
      } catch (fallbackError) {
        const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(fallbackMsg);
      }
    }

    throw new Error(msg);
  }
}

/**
 * Upload encrypted blob to Shelbynet storage after registration.
 * 
 * After the blob is successfully registered on-chain, upload the actual data
 * to Shelbynet's storage API using a simple PUT request.
 */
export async function uploadBlobToShelbynet(
  signAndSubmitTransaction: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>,
  encryptedBlob: Blob,
  blobName: string,
  blobUid: number,
  uploaderAddress: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  console.log(`📤 Starting Shelbynet blob upload via storage API`);
  console.log(`📦 Blob name: ${blobName}`);
  console.log(`👤 Uploader address: ${uploaderAddress}`);
  console.log(`📊 Blob size: ${encryptedBlob.size} bytes`);

  // Convert blob to Uint8Array
  const blobData = new Uint8Array(await encryptedBlob.arrayBuffer());
  console.log(`📦 Converted to Uint8Array: ${blobData.length} bytes`);

  // Construct the upload URL - use the shelby/v1/blobs endpoint
  const uploadUrl = `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${uploaderAddress}/${encodeURIComponent(blobName)}`;
  console.log(`📤 Upload URL: ${uploadUrl}`);

  onProgress?.(60);

  try {
    console.log(`📤 Uploading blob data (${blobData.length} bytes) via PUT...`);
    
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: blobData,
    });

    console.log(`📡 Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`❌ Upload failed response:`, errorText);
      
      throw new Error(`Storage upload failed (${response.status}): ${errorText}`);
    }

    const responseText = await response.text().catch(() => '');
    console.log(`✅ Blob uploaded successfully to Shelbynet storage`);
    if (responseText) {
      console.log(`📝 Response:`, responseText);
    }
    onProgress?.(100);
  } catch (error) {
    console.error(`❌ Storage upload error:`, error);
    throw new Error(
      `Failed to upload blob to storage: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get Shelbynet blob download URL.
 * Uses the shelbynet-1 API endpoint.
 */
export function getBlobStreamUrl(blobName: string, accountAddress: string): string {
  const apiBase = process.env.NEXT_PUBLIC_SHELBYNET_API_BASE ?? 'https://api.shelbynet.shelby.xyz';
  return `${apiBase}/shelby/v1/blobs/${accountAddress}/${encodeURIComponent(blobName)}`;
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
