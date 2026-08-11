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
 */
export async function registerBlob(
  signAndSubmitTransaction: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>,
  blobName: string,
  commitments: BlobCommitments,
  uploaderAddress: AccountAddress,
  expirationDays: number
): Promise<{ hash: string; blobId: string }> {
  const contractAddress = process.env.NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS || 
    '0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a';

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
    function: `${contractAddress}::blob_metadata::register_blob` as `${string}::${string}::${string}`,
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

  console.log('📝 Registering blob with contract:', contractAddress);
  console.log('📦 Payload function arguments:', JSON.stringify(payload.functionArguments, null, 2));

  // Submit the transaction
  const response = await signAndSubmitTransaction({ data: payload });
  const txHash: unknown = (response as { hash?: unknown })?.hash;
  if (typeof txHash !== 'string' || txHash.length === 0) {
    throw new Error('Wallet returned no transaction hash for registerBlob');
  }

  console.log(`⏳ Waiting for registration transaction: ${txHash}`);

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

  console.log(`✅ Blob registered successfully! Transaction: ${txHash}`);

  const blobId = `blob_${Date.now()}_${blobName}`;
  return { hash: txHash, blobId };
}

/**
 * Upload encrypted blob to Shelbynet by committing it on-chain.
 * 
 * After registerBlob completes, we need to submit the actual blob data
 * via a commit_object transaction. This uploads the data to storage providers
 * who watch the chain for new blobs.
 * 
 * For large files, we split into smaller chunks to fit within transaction limits.
 * Each chunk batch is submitted as a separate commit_object transaction.
 */
export async function uploadBlobToShelbynet(
  signAndSubmitTransaction: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>,
  encryptedBlob: Blob,
  blobName: string,
  blobId: string,
  uploaderAddress: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  console.log(`📤 Starting Shelbynet blob upload via commit_object`);
  console.log(`📦 Blob name: ${blobName}`);
  console.log(`📊 Blob size: ${encryptedBlob.size} bytes`);
  console.log(`🆔 Blob ID: ${blobId}`);

  // Convert blob to byte array
  const blobData = new Uint8Array(await encryptedBlob.arrayBuffer());
  console.log(`📦 Converted to Uint8Array: ${blobData.length} bytes`);

  // Extract timestamp from blobId for the uid
  const blobUidMatch = blobId.match(/^blob_(\d+)_/);
  if (!blobUidMatch) {
    throw new Error(`Invalid blobId format: ${blobId}`);
  }
  const blobUid = parseInt(blobUidMatch[1], 10);
  console.log(`🔢 Blob UID: ${blobUid}`);

  const contractAddress = process.env.NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS || 
    '0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a';

  // For small files (< 50KB), send in one transaction
  // For larger files, we'd need multiple transactions or off-chain storage
  const MAX_INLINE_SIZE = 50 * 1024; // 50KB
  
  if (blobData.length > MAX_INLINE_SIZE) {
    // Large file - needs different approach
    console.warn(`⚠️ File is ${(blobData.length / 1024).toFixed(2)}KB, larger than ${MAX_INLINE_SIZE / 1024}KB inline limit`);
    throw new Error(
      `File is too large (${(blobData.length / 1024 / 1024).toFixed(2)} MB) for inline commit_object upload. ` +
      `Shelbynet currently requires files to be uploaded via storage providers after registration. ` +
      `The blob has been registered on-chain, but the actual data upload mechanism is not yet implemented. ` +
      `Please check Shelby documentation for the correct upload flow for files larger than 50KB.`
    );
  }

  // Small file - send inline
  console.log(`✅ File is small enough (${(blobData.length / 1024).toFixed(2)}KB), sending inline`);
  
  const payload: InputGenerateTransactionPayloadData = {
    function: `${contractAddress}::blob_metadata::commit_object` as `${string}::${string}::${string}`,
    typeArguments: [],
    functionArguments: [
      blobUid,              // u64 - blob creation timestamp
      blobName,             // String - blob name
      true,                 // bool - overwrite flag
      null,                 // Option<String> - etag (None)
      65535,                // u32 - ack_bits (all bits set for single chunk)
      [Array.from(blobData)], // vector<vector<u8>> - chunks (single chunk with all data)
    ],
  };

  console.log(`📤 Submitting commit_object transaction...`);
  console.log(`   - UID: ${blobUid}`);
  console.log(`   - Name: ${blobName}`);
  console.log(`   - Chunks: 1`);
  console.log(`   - Total size: ${blobData.length} bytes`);
  
  onProgress?.(20);

  try {
    const response = await signAndSubmitTransaction({ data: payload });
    const txHash: unknown = (response as { hash?: unknown })?.hash;

    if (typeof txHash !== 'string' || txHash.length === 0) {
      throw new Error('Wallet returned no transaction hash for commit_object');
    }

    console.log(`⏳ Waiting for commit_object transaction: ${txHash}`);
    onProgress?.(50);

    // Wait for transaction confirmation
    let txResult: { success?: boolean; vm_status?: string } | unknown;
    try {
      txResult = await shelbynetAptos.waitForTransaction({
        transactionHash: txHash,
        options: { checkSuccess: false },
      });
    } catch (waitError) {
      throw new Error(
        `Commit transaction did not confirm: ${waitError instanceof Error ? waitError.message : String(waitError)}`
      );
    }

    onProgress?.(90);

    // Check transaction result
    const txRes = txResult as { success?: boolean; vm_status?: string };
    if (txRes.success === false) {
      const vmStatus: string = txRes.vm_status ?? '';
      console.error(`❌ Commit transaction failed:`, vmStatus);
      throw new Error(`Blob commit failed on-chain: ${vmStatus || 'Unknown VM error'}`);
    }

    console.log(`✅ Blob committed successfully! Transaction: ${txHash}`);
    onProgress?.(100);

  } catch (error) {
    console.error(`❌ Commit_object error:`, error);
    throw error;
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
