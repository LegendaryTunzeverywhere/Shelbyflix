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
  const primaryContractAddress   = process.env.NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS;
  const fallbackContractAddress  = process.env.NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS_FALLBACK;

  const attemptRegistration = async (contractAddress?: string): Promise<{ hash: string; blobId: string }> => {
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

    const blobId = `blob_${Date.now()}_${blobName}`;
    return { hash: txHash, blobId };
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

// Chunk size must balance:
// 1. Transaction size limits (Aptos max ~64KB for arguments)
// 2. Efficient encoding (smaller = more overhead)
// We'll use 8KB chunks and send max 4 chunks per transaction = ~32KB payload
const CHUNK_SIZE = 8 * 1024; // 8KB per chunk
const MAX_CHUNKS_PER_BATCH = 4; // Max 4 chunks per transaction (~32KB)

const FINALIZATION_POLL_MS = 180_000; // 3 minutes
const FINALIZATION_POLL_INTERVAL_MS = 5_000;

/**
 * Upload encrypted blob to Shelbynet storage using commit_object transaction(s).
 * 
 * For large files, this sends multiple commit_object transactions, each with a
 * batch of chunks. The ack_bits field tracks which chunks have been committed.
 * 
 * Only call this AFTER registerBlob has confirmed successfully on-chain.
 */
export async function uploadBlobToShelbynet(
  signAndSubmitTransaction: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>,
  encryptedBlob: Blob,
  blobName: string,
  blobId: string,
  uploaderAddress: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  console.log(`📤 Upload to Shelbynet: ${blobName}`);
  console.log(`📊 Blob size: ${encryptedBlob.size} bytes`);
  console.log(`🆔 Blob ID: ${blobId}`);
  
  // Convert blob to byte array
  const blobData = new Uint8Array(await encryptedBlob.arrayBuffer());
  
  // Chunk the blob data
  const allChunks: number[][] = [];
  for (let offset = 0; offset < blobData.length; offset += CHUNK_SIZE) {
    const chunkEnd = Math.min(offset + CHUNK_SIZE, blobData.length);
    const chunk = Array.from(blobData.slice(offset, chunkEnd));
    allChunks.push(chunk);
  }
  
  console.log(`📦 Split blob into ${allChunks.length} chunks of ${CHUNK_SIZE} bytes each`);
  
  // Extract blob_uid from blobId
  const blobUidMatch = blobId.match(/^blob_(\d+)_/);
  const blobUid = blobUidMatch ? parseInt(blobUidMatch[1], 10) : Date.now();
  
  const primaryContractAddress = process.env.NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS;
  const contractAddress = primaryContractAddress || '0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a';

  // If file is small enough, send all chunks in one transaction
  if (allChunks.length <= MAX_CHUNKS_PER_BATCH) {
    console.log(`✅ File is small enough (${allChunks.length} chunks), sending in single transaction`);
    
    const ackBits = (1 << allChunks.length) - 1; // All bits set
    
    await sendCommitObjectTransaction(
      signAndSubmitTransaction,
      contractAddress,
      blobUid,
      blobName,
      ackBits,
      allChunks
    );
    
    onProgress?.(100);
    console.log(`✅ Blob committed successfully: ${blobName}`);
    return;
  }
  
  // For large files, we need multiple transactions
  console.log(`⚠️  File too large for single transaction. Need ${Math.ceil(allChunks.length / MAX_CHUNKS_PER_BATCH)} transactions`);
  
  // Send chunks in batches
  let chunksSentSoFar = 0;
  for (let batchStart = 0; batchStart < allChunks.length; batchStart += MAX_CHUNKS_PER_BATCH) {
    const batchEnd = Math.min(batchStart + MAX_CHUNKS_PER_BATCH, allChunks.length);
    const batchChunks = allChunks.slice(batchStart, batchEnd);
    
    // Calculate ack_bits for this batch
    // Bit positions: batch chunk 0 = bit (batchStart), etc.
    let ackBits = 0;
    for (let i = 0; i < batchChunks.length; i++) {
      const bitPosition = batchStart + i;
      if (bitPosition < 32) { // Only set bits within u32 range
        ackBits |= (1 << bitPosition);
      }
    }
    
    console.log(`📤 Batch ${Math.floor(batchStart / MAX_CHUNKS_PER_BATCH) + 1}: chunks ${batchStart}-${batchEnd - 1}, ack_bits: ${ackBits}`);
    
    await sendCommitObjectTransaction(
      signAndSubmitTransaction,
      contractAddress,
      blobUid,
      blobName,
      ackBits,
      batchChunks,
      batchStart > 0 // overwrite = true for subsequent batches
    );
    
    chunksSentSoFar += batchChunks.length;
    const progressPercent = 50 + Math.floor((chunksSentSoFar / allChunks.length) * 50);
    onProgress?.(progressPercent);
  }
  
  onProgress?.(100);
  console.log(`✅ Blob committed successfully in ${Math.ceil(allChunks.length / MAX_CHUNKS_PER_BATCH)} transactions: ${blobName}`);
}

/**
 * Helper function to send a single commit_object transaction
 */
async function sendCommitObjectTransaction(
  signAndSubmitTransaction: (payload: { data: InputGenerateTransactionPayloadData }) => Promise<{ hash?: string }>,
  contractAddress: string,
  blobUid: number,
  blobName: string,
  ackBits: number,
  chunks: number[][],
  overwrite: boolean = true
): Promise<void> {
  const payload: InputGenerateTransactionPayloadData = {
    function: `${contractAddress}::blob_metadata::commit_object` as `${string}::${string}::${string}`,
    typeArguments: [],
    functionArguments: [
      blobUid,
      blobName,
      overwrite,
      null,           // etag
      ackBits,
      chunks,
    ],
  };

  console.log(`📤 Submitting commit_object with ${chunks.length} chunks, ack_bits: ${ackBits}...`);
  
  const response = await signAndSubmitTransaction({ data: payload });
  const txHash: unknown = (response as { hash?: unknown })?.hash;
  
  if (typeof txHash !== 'string' || txHash.length === 0) {
    throw new Error('Wallet returned no transaction hash for commit_object');
  }

  console.log(`⏳ Waiting for transaction: ${txHash}`);
  
  // Wait for confirmation
  let txResult: { success?: boolean; vm_status?: string } | unknown;
  try {
    txResult = await shelbynetAptos.waitForTransaction({
      transactionHash: txHash,
      options: { checkSuccess: false },
    });
  } catch (waitError) {
    throw new Error(
      `Transaction did not confirm: ${waitError instanceof Error ? waitError.message : String(waitError)}`
    );
  }

  // Check result
  const txRes = txResult as { success?: boolean; vm_status?: string };
  if (txRes.success === false) {
    const vmStatus: string = txRes.vm_status ?? '';
    throw new Error(`Transaction failed on-chain: ${vmStatus || 'Unknown VM error'}`);
  }

  console.log(`✅ Transaction confirmed: ${txHash}`);
}

/**
 * Poll the blob's public URL until it returns 200, or the budget expires.
 * Uses HEAD to avoid pulling the full body on every attempt. Returns true
 * if the blob became available, false if we ran out of time.
 */
async function pollBlobAvailable(
  blobName: string,
  uploaderAddress: string,
  budgetMs: number,
  intervalMs: number,
  onTick?: (elapsedMs: number, budgetMs: number) => void
): Promise<boolean> {
  const url = getBlobStreamUrl(blobName, uploaderAddress);
  const started = Date.now();

  while (Date.now() - started < budgetMs) {
    try {
      // HEAD first — cheap, avoids downloading the body. Some CDNs return
      // 405 for HEAD though, so we fall back to GET on that specific status.
      let res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (res.status === 405) {
        res = await fetch(url, { method: 'GET', cache: 'no-store' });
      }
      if (res.ok) return true;
      // 404 is the expected "not ready yet" state; anything else is a
      // real error (auth, bad URL, etc.) and retrying won't help.
      if (res.status !== 404) {
        console.warn(`pollBlobAvailable: unexpected status ${res.status} from ${url}`);
        return false;
      }
    } catch (err) {
      // Network blip — swallow and keep polling.
      console.warn('pollBlobAvailable: transient fetch error, continuing', err);
    }

    onTick?.(Date.now() - started, budgetMs);
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return false;
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
