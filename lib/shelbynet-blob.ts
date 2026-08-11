import {
  type BlobCommitments,
  createDefaultErasureCodingProvider,
  generateCommitments,
  ShelbyBlobClient,
  ShelbyClient,
  expectedTotalChunksets,
} from '@shelby-protocol/sdk/browser';
import { Aptos, AptosConfig, Network, AccountAddress, type InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';

export function getShelbyApiKey(): string {
  const isBrowser = typeof window !== 'undefined';

  if (isBrowser) {
    const publicKey = process.env.NEXT_PUBLIC_SHELBY_API_KEY?.trim();
    if (publicKey) {
      return publicKey;
    }
  }

  const serverKey = process.env.SHELBY_API_KEY?.trim();
  if (serverKey) {
    return serverKey;
  }

  const legacyKey = process.env.NEXT_PUBLIC_SHELBY_API_KEY?.trim();
  if (legacyKey) {
    return legacyKey;
  }

  throw new Error(
    'Missing Shelby API key. Set SHELBY_API_KEY for server-side use, or NEXT_PUBLIC_SHELBY_API_KEY for browser-based uploads such as the website upload flow.'
  );
}

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
        merkleRootBytes.push(parseInt(hex.substr(i, 2), 16));
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

/**
 * Upload encrypted blob to Shelbynet storage.
 * Only call this AFTER registerBlob has confirmed successfully on-chain.
 *
 * ── 408 / "complete multipart upload" handling ──────────────────────────────
 * Shelby's API gateway has a 300s upstream timeout on the `/complete` step of
 * a multipart upload. When the internal storage service (erasure coding +
 * chunk distribution) takes longer than that, the gateway returns 408 even
 * though the bytes we uploaded are already sitting on their servers. In that
 * case the finalization usually completes on Shelby's side within a minute
 * or two after the timeout — we just never got the acknowledgement.
 *
 * To avoid losing otherwise-good uploads to this race, on 408 we poll the
 * blob's public URL with HEAD requests for up to `FINALIZATION_POLL_MS`.
 * If it starts returning 200 the upload is real and we return success.
 * If the poll budget runs out without the blob becoming available, we
 * surface a clear error so the caller can retry.
 */

const FINALIZATION_POLL_MS = 180_000; // 3 minutes — well beyond typical lag
const FINALIZATION_POLL_INTERVAL_MS = 5_000;

export async function uploadBlobToShelbynet(
  encryptedBlob: Blob,
  blobName: string,
  uploaderAddress: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const networkName = (process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'SHELBYNET').toUpperCase();
  
  // Try TESTNET first - the SDK might map SHELBYNET to testnet internally
  const network = Network.TESTNET;
  
  console.log(`🔧 Using network: ${network}, API key present: ${!!getShelbyApiKey()}`);
  
  const shelbyClient = new ShelbyClient({
    network,
    apiKey: getShelbyApiKey(),
  });

  const blobData = new Uint8Array(await encryptedBlob.arrayBuffer());

  try {
    console.log(`📤 Starting upload: ${blobName} (${blobData.length} bytes) for account ${uploaderAddress}`);
    
    await shelbyClient.rpc.putBlob({
      account: uploaderAddress,
      blobName,
      blobData,
    });

    onProgress?.(100);
    console.log(`✅ Upload succeeded for ${blobName}`);
    return;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Blob upload failed';

    // Shelby's upstream timed out on /complete. The bytes are very likely
    // already stored — poll the public URL to confirm before declaring
    // failure. Treats any 408 / "Request Timed Out" / "Upstream took longer"
    // as the same upstream-finalization-lag case.
    const isUpstreamTimeout =
      /\b408\b/.test(msg) ||
      /Request Timed Out/i.test(msg) ||
      /Upstream took longer/i.test(msg) ||
      /complete multipart upload/i.test(msg);

    if (!isUpstreamTimeout) {
      throw new Error(`Failed to start multipart upload!`);
    }

    console.warn(
      `⏳ Shelby upstream timed out on /complete for ${blobName}. ` +
      `Polling ${getBlobStreamUrl(blobName, uploaderAddress)} for up to ` +
      `${Math.round(FINALIZATION_POLL_MS / 1000)}s to see if it finalises…`
    );
    onProgress?.(95);

    const became = await pollBlobAvailable(
      blobName,
      uploaderAddress,
      FINALIZATION_POLL_MS,
      FINALIZATION_POLL_INTERVAL_MS,
      (elapsedMs, budgetMs) => {
        // Nudge progress between 95–99% while polling so the UI doesn't
        // look frozen. Never reach 100% until we actually confirm.
        const frac = Math.min(1, elapsedMs / budgetMs);
        onProgress?.(95 + Math.floor(frac * 4));
      }
    );

    if (became) {
      console.log(`✅ ${blobName} finalised on Shelbynet despite upstream 408`);
      onProgress?.(100);
      return;
    }

    throw new Error(
      `Shelbynet finalisation stalled. The blob was uploaded but never became ` +
      `available within ${Math.round(FINALIZATION_POLL_MS / 1000)}s. This is ` +
      `usually a temporary Shelby-side issue — try re-uploading in a few minutes.`
    );
  }
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