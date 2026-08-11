import {
  type BlobCommitments,
  createDefaultErasureCodingProvider,
  generateCommitments,
  ShelbyBlobClient,
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

export { ShelbyBlobClient };

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

    // Convert merkle root from hex string to byte array (32 bytes)
    let merkleRootBytes: number[];
    const merkleRoot = commitments.blob_merkle_root;
    
    if (typeof merkleRoot === 'string') {
      // Remove 0x prefix if present
      const hex = merkleRoot.startsWith('0x') 
        ? merkleRoot.slice(2) 
        : merkleRoot;
      
      // Convert hex string to byte array
      merkleRootBytes = [];
      for (let i = 0; i < hex.length; i += 2) {
        merkleRootBytes.push(parseInt(hex.substring(i, i + 2), 16));
      }
      
      if (merkleRootBytes.length !== 32) {
        throw new Error(`Invalid merkle root length: ${merkleRootBytes.length} bytes (expected 32)`);
      }
    } else if (ArrayBuffer.isView(merkleRoot) || Array.isArray(merkleRoot)) {
      // Handle Uint8Array or regular array
      merkleRootBytes = Array.from(merkleRoot as ArrayLike<number>);
      if (merkleRootBytes.length !== 32) {
        throw new Error(`Invalid merkle root length: ${merkleRootBytes.length} bytes (expected 32)`);
      }
    } else {
      throw new Error('Invalid merkle root format: expected string or byte array');
    }

    // Create payload for register_blob (singular - matches successful transactions)
    const payload: InputGenerateTransactionPayloadData = {
      function: `${contractAddress || '0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a'}::blob_metadata::register_blob` as `${string}::${string}::${string}`,
      typeArguments: [],
      functionArguments: [
        blobName,                          // arg 0: String - blob name (not array)
        'shelbynet-1',                     // arg 1: Option<String> - location name (SDK wraps in Some)
        null,                              // arg 2: Option<String> - sponsor (None)
        expirationMicros,                  // arg 3: u64 - expiration micros
        merkleRootBytes,                   // arg 4: vector<u8> - merkle root (32 bytes, not nested array)
        1,                                 // arg 5: u32 - encoding
        commitments.raw_data_size,         // arg 6: u64 - blob size
        0,                                 // arg 7: u8 - oracle base rate
        0,                                 // arg 8: u8 - premium bps
        0,                                 // arg 9: u8 - payment tier ID
      ],
    };

    console.log('Registering blob with primary contract:', contractAddress || '0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a');
    console.log('📦 Payload function arguments:', JSON.stringify(payload.functionArguments, null, 2));

    // Submit the transaction
    const response = await signAndSubmitTransaction({ data: payload });
    const txHash: unknown = (response as { hash?: unknown })?.hash;
    if (typeof txHash !== 'string' || txHash.length === 0) {
      throw new Error('Wallet returned no transaction hash for registerBlob');
    }

    // ── CRITICAL: Wait for the transaction to be confirmed on-chain ──────────
    // Without this, a Move abort (e.g. E_INSUFFICIENT_FUNDS) is invisible —
    // we'd get a hash back and immediately try to upload, which fails because
    // the blob was never registered.
    let txResult: { success?: boolean; vm_status?: string } | unknown;
    try {
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
 * After registerBlob completes on-chain, we upload the actual blob data
 * to Shelbynet's storage providers via the RPC API (not via blockchain transactions).
 * 
 * This uses the official Shelby SDK's RPC client to upload blob data.
 */
export async function uploadBlobToShelbynet(
  signAndSubmitTransaction: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>,
  encryptedBlob: Blob,
  blobName: string,
  blobUid: number,
  uploaderAddress: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  console.log(`📤 Starting Shelbynet blob upload via RPC storage API`);
  console.log(`📦 Blob name: ${blobName}`);
  console.log(`👤 Uploader address: ${uploaderAddress}`);
  console.log(`📊 Blob size: ${encryptedBlob.size} bytes`);

  // Convert blob to byte array
  const blobData = new Uint8Array(await encryptedBlob.arrayBuffer());
  console.log(`📦 Converted to Uint8Array: ${blobData.length} bytes`);

  // Use the Shelby SDK's RPC client to upload
  // After register_blob completes, storage providers watch the chain and are ready to accept the upload
  const rpcBaseUrl = process.env.NEXT_PUBLIC_SHELBYNET_API_BASE ?? 'https://api.shelbynet.shelby.xyz';
  const uploadUrl = `${rpcBaseUrl}/shelby/v1/blobs/${uploaderAddress}/${encodeURIComponent(blobName)}`;

  console.log(`📤 Upload URL: ${uploadUrl}`);
  
  // Storage providers need time to index the registration from the blockchain
  // We'll wait and then check if the blob is registered before uploading
  console.log(`⏳ Waiting for storage providers to index the registration...`);
  
  const maxRetries = 10;
  const retryDelay = 3000; // 3 seconds between retries
  let registered = false;
  
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    
    console.log(`🔍 Attempt ${i + 1}/${maxRetries}: Checking if blob is registered...`);
    
    try {
      // Check if the blob metadata exists via GET
      const checkResponse = await fetch(uploadUrl, { method: 'HEAD' });
      
      if (checkResponse.status === 200 || checkResponse.status === 204) {
        console.log(`✅ Blob is registered and ready for upload`);
        registered = true;
        break;
      } else if (checkResponse.status === 404) {
        console.log(`⏳ Blob not yet indexed (404), waiting...`);
      } else {
        console.log(`⚠️  Unexpected status: ${checkResponse.status}, retrying...`);
      }
    } catch (error) {
      console.log(`⚠️  Check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!registered) {
    throw new Error(
      `Blob registration did not propagate to storage providers after ${maxRetries * retryDelay / 1000} seconds. ` +
      `The blockchain transaction succeeded, but storage providers haven't indexed it yet. Please try again in a minute.`
    );
  }

  onProgress?.(60);

  try {
    console.log(`📤 Sending PUT request with ${blobData.length} bytes...`);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(blobData.length),
      },
      body: blobData,
    });

    console.log(`📡 Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`❌ Upload failed response:`, errorText);
      throw new Error(`Storage upload failed (${response.status}): ${errorText}`);
    }

    const responseText = await response.text();
    console.log(`✅ Blob uploaded successfully to Shelbynet storage`);
    console.log(`📝 Response:`, responseText || '(empty response)');
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
