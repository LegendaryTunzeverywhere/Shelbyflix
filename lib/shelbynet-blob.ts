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
 * Upload encrypted blob to Shelbynet by committing it on-chain.
 * 
 * After registerBlob completes, we need to submit the actual blob data
 * via a commit_object transaction. This uploads the data to storage providers
 * who watch the chain for new blobs.
 * 
 * For large files, we split into smaller chunks to fit within transaction limits.
 * Each chunk batch is submitted as a separate commit_object transaction.
 * 
 * CRITICAL: commit_object must use the SAME UID that was passed to register_blob.
 * This UID links the blob data to the registered blob metadata on-chain.
 */
export async function uploadBlobToShelbynet(
  signAndSubmitTransaction: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>,
  encryptedBlob: Blob,
  blobName: string,
  blobUid: number, // The UID from registerBlob - MUST match!
  uploaderAddress: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  console.log(`📤 Starting Shelbynet blob upload via commit_object`);
  console.log(`📦 Blob name: ${blobName}`);
  console.log(`👤 Uploader address: ${uploaderAddress}`);
  console.log(`📊 Blob size: ${encryptedBlob.size} bytes`);
  console.log(`🔢 Blob UID (from registerBlob): ${blobUid}`);

  // Convert blob to byte array
  const blobData = new Uint8Array(await encryptedBlob.arrayBuffer());
  console.log(`📦 Converted to Uint8Array: ${blobData.length} bytes`);

  const contractAddress = process.env.NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS || 
    '0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a';

  // Split blob into 4KB chunks (Shelbynet standard chunk size)
  const CHUNK_SIZE = 4096; // 4KB per chunk
  const chunks: number[][] = [];
  
  for (let i = 0; i < blobData.length; i += CHUNK_SIZE) {
    const chunk = blobData.slice(i, i + CHUNK_SIZE);
    chunks.push(Array.from(chunk));
  }
  
  console.log(`📦 Split into ${chunks.length} chunks of ${CHUNK_SIZE} bytes each`);

  // Aptos transaction size limit is ~64KB for the entire transaction payload.
  // Each chunk is 4KB, but the transaction includes overhead (function name, args, etc).
  // Testing shows we can safely fit 8 chunks (~32KB of data) per transaction.
  // This leaves enough room for transaction metadata while staying under the 64KB limit.
  const CHUNKS_PER_TRANSACTION = 8;
  const numTransactions = Math.ceil(chunks.length / CHUNKS_PER_TRANSACTION);

  if (numTransactions > 1) {
    const estimatedGas = (numTransactions * 0.012).toFixed(3);
    const estimatedMinutes = Math.ceil(numTransactions * 0.5); // ~30s per tx
    
    console.log(`📤 Large file detected, will send ${numTransactions} transactions`);
    console.log(`   - Total chunks: ${chunks.length}`);
    console.log(`   - Chunks per TX: ${CHUNKS_PER_TRANSACTION}`);
    console.log(`   ⚠️  IMPORTANT: You must approve ALL ${numTransactions} transactions for the upload to complete!`);
    console.log(`   - Estimated cost: ~${estimatedGas} APT in gas fees`);
    console.log(`   - Estimated time: ~${estimatedMinutes} minutes (including wallet approvals)`);
    console.log(`   - If you cancel mid-way, the blob will be incomplete and not accessible`);
    console.log(`   📝 The blob will only be accessible after ALL transactions are confirmed`);
  }

  // Submit chunks in batches
  for (let txIndex = 0; txIndex < numTransactions; txIndex++) {
    const startChunkIndex = txIndex * CHUNKS_PER_TRANSACTION;
    const endChunkIndex = Math.min(startChunkIndex + CHUNKS_PER_TRANSACTION, chunks.length);
    const batchChunks = chunks.slice(startChunkIndex, endChunkIndex);
    
    // Calculate ack_bits: which chunks we're sending in this transaction
    // For the first transaction (txIndex=0), ack_bits=0
    // For subsequent transactions, set the bits for the chunks we're acknowledging
    const ackBits = txIndex === 0 ? 0 : startChunkIndex;
    
    console.log(`📤 Transaction ${txIndex + 1}/${numTransactions}:`);
    console.log(`   - Chunks: ${startChunkIndex} to ${endChunkIndex - 1} (${batchChunks.length} chunks)`);
    console.log(`   - ack_bits: ${ackBits} (binary: ${ackBits.toString(2).padStart(16, '0')})`);
    
    const payload: InputGenerateTransactionPayloadData = {
      function: `${contractAddress}::blob_metadata::commit_object` as `${string}::${string}::${string}`,
      typeArguments: [],
      functionArguments: [
        blobUid,              // u64 - blob creation timestamp (MUST match register_blob UID!)
        blobName,             // String - blob name (same as register_blob, NOT full path)
        false,                // bool - overwrite flag (false to append chunks)
        null,                 // Option<String> - etag (None)
        ackBits,              // u32 - ack_bits (which chunks to acknowledge)
        batchChunks,          // vector<vector<u8>> - chunks to upload
      ],
    };

    console.log(`   📤 Submitting commit_object with:`);
    console.log(`      - UID: ${blobUid}`);
    console.log(`      - Blob Name: ${blobName}`);
    console.log(`      - Overwrite: false`);
    console.log(`      - Ack bits: ${ackBits}`);
    console.log(`      - Chunks: ${batchChunks.length}`);
    console.log(`      - Total bytes: ${batchChunks.reduce((sum, chunk) => sum + chunk.length, 0)}`);
    
    const progressStart = 20 + (txIndex / numTransactions) * 70;
    const progressEnd = 20 + ((txIndex + 1) / numTransactions) * 70;
    onProgress?.(progressStart);

    try {
      const response = await signAndSubmitTransaction({ data: payload });
      const txHash: unknown = (response as { hash?: unknown })?.hash;

      if (typeof txHash !== 'string' || txHash.length === 0) {
        throw new Error(`Wallet returned no transaction hash for commit_object (batch ${txIndex + 1}/${numTransactions})`);
      }

      console.log(`   ⏳ Waiting for transaction: ${txHash}`);

      // Wait for transaction confirmation
      let txResult: { success?: boolean; vm_status?: string } | unknown;
      try {
        txResult = await shelbynetAptos.waitForTransaction({
          transactionHash: txHash,
          options: { checkSuccess: false },
        });
      } catch (waitError) {
        throw new Error(
          `Commit transaction ${txIndex + 1}/${numTransactions} did not confirm: ${waitError instanceof Error ? waitError.message : String(waitError)}`
        );
      }

      // Check transaction result
      const txRes = txResult as { success?: boolean; vm_status?: string };
      if (txRes.success === false) {
        const vmStatus: string = txRes.vm_status ?? '';
        console.error(`   ❌ Transaction ${txIndex + 1}/${numTransactions} failed:`, vmStatus);
        throw new Error(`Blob commit transaction ${txIndex + 1}/${numTransactions} failed on-chain: ${vmStatus || 'Unknown VM error'}`);
      }

      console.log(`   ✅ Transaction ${txIndex + 1}/${numTransactions} confirmed: ${txHash}`);
      onProgress?.(progressEnd);

    } catch (error) {
      console.error(`❌ Commit_object error (batch ${txIndex + 1}/${numTransactions}):`, error);
      throw new Error(
        `Failed to upload chunk batch ${txIndex + 1}/${numTransactions}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log(`✅ All ${numTransactions} transactions completed! Blob upload finished.`);
  onProgress?.(100);
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
