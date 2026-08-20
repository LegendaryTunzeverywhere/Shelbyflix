import type { VideoMetadata, UploadProgress, AccessMode } from '@/types';
import {
  getBlobStreamUrl,
  ShelbyBlobClient,
} from './shelbynet-blob';
import { AccountAddress } from '@aptos-labs/ts-sdk';
import {
  encryptFile,
  decryptBlob,
  generateEncryptionKey,
  getVideoDuration,
  generateThumbnail,
} from './encryption';
import { serializeRegistrationInfoV2, serializeRegistrationInfoV2Vec, msToMicros } from './move-bcs';
import type { AccessPolicy, RegistrationInfoV2 } from './move-bcs';
import { ACCESS_CONTROL_MODULE } from './move-contract';
import { logChainWriteSuccess } from './move-logging';
import { getAptosClient } from './aptos-client';

export interface ShelbyUploadResponse {
  videoId: string;
  blobId: string;
  blobName: string;
  shelbyUrl: string;
  encryptionKey: string;
  duration: number;
  thumbnailUrl?: string;
  success: boolean;
  _chainTxHash?: string;
}

// ---------------------------------------------------------------------------
// Move-backed registration — register_blob_v2 (Req 8.1 - 8.8)
// ---------------------------------------------------------------------------

/**
 * Error categories for wallet/signing failures (Req 8.8).
 * These are surfaced to the UI so the creator knows what went wrong
 * without a chain broadcast having occurred.
 */
export type SigningFailureCategory =
  | 'user_rejection'
  | 'adapter_error'
  | 'missing_account';

/**
 * Structured error thrown when the wallet rejects or fails to sign.
 * The upload form catches this to keep form state intact (Req 8.8).
 */
export class WalletSigningError extends Error {
  public readonly category: SigningFailureCategory;
  constructor(category: SigningFailureCategory, message: string) {
    super(message);
    this.name = 'WalletSigningError';
    this.category = category;
  }
}

/**
 * Structured error thrown when the chain transaction aborts or times out.
 * Carries the abort code or timeout indicator + entry function name (Req 8.5).
 */
export class ChainTransactionError extends Error {
  public readonly entryFunction: string;
  public readonly abortCode?: string;
  public readonly isTimeout: boolean;
  constructor(opts: { entryFunction: string; abortCode?: string; isTimeout?: boolean; message: string }) {
    super(opts.message);
    this.name = 'ChainTransactionError';
    this.entryFunction = opts.entryFunction;
    this.abortCode = opts.abortCode;
    this.isTimeout = opts.isTimeout ?? false;
  }
}

/**
 * Structured error thrown when the Supabase write fails after a successful
 * chain commit (Req 8.6). Carries the chain tx hash so the creator can
 * retry the DB write only.
 */
export class PostCommitSupabaseError extends Error {
  public readonly txHash: string;
  public readonly videoId: string;
  constructor(opts: { txHash: string; videoId: string; message: string }) {
    super(opts.message);
    this.name = 'PostCommitSupabaseError';
    this.txHash = opts.txHash;
    this.videoId = opts.videoId;
  }
}

/**
 * Map the upload-form access mode selection to a Move `AccessPolicy` (Table 4a inverted).
 *
 * - Public → PayToDownload { price: 0 }
 * - Purchasable → PayToDownload { price: n } where n > 0
 * - Allowlist → Allowlist { addresses }
 * - TimeLock → TimeLock { locked_until } (ms → µs via msToMicros)
 */
export function mapFormToAccessPolicy(opts: {
  accessMode: AccessMode;
  price?: number;
  allowlist?: string[];
  unlockAt?: number;
}): AccessPolicy {
  switch (opts.accessMode) {
    case 'public':
      return { kind: 'PayToDownload', price: 0n };
    case 'purchasable':
      return { kind: 'PayToDownload', price: BigInt(opts.price!) };
    case 'allowlist': {
      // Deduplicate by canonical form and sort ascending
      const canonical = [...new Set(
        (opts.allowlist ?? []).map(a => {
          try {
            return AccountAddress.from(a).toStringLong();
          } catch {
            return a.toLowerCase();
          }
        })
      )].sort();
      return { kind: 'Allowlist', addresses: canonical };
    }
    case 'timelock':
      return { kind: 'TimeLock', locked_until: msToMicros(opts.unlockAt!) };
  }
}

/**
 * Validate access-mode selection before upload under the move flag.
 * Returns null if valid, or an object `{ field, message }` on failure.
 * (Req 8.2, 8.3, 8.4)
 */
export function validateAccessModeForMove(opts: {
  accessMode: AccessMode;
  price?: number;
  allowlist?: string[];
  unlockAt?: number;
  expirationTimestamp: number;
}): { field: string; message: string } | null {
  if (opts.accessMode === 'purchasable') {
    if (
      opts.price === undefined ||
      opts.price === null ||
      !Number.isSafeInteger(opts.price) ||
      opts.price <= 0
    ) {
      return {
        field: 'price',
        message: 'Purchasable videos require a positive integer price in SHELBYUSD base units.',
      };
    }
  }

  if (opts.accessMode === 'timelock') {
    if (opts.unlockAt === undefined || opts.unlockAt === null) {
      return { field: 'unlockAt', message: 'TimeLock requires an unlock time.' };
    }
    if (!Number.isFinite(opts.unlockAt) || !Number.isSafeInteger(opts.unlockAt)) {
      return { field: 'unlockAt', message: 'unlockAt must be a finite safe integer (epoch ms).' };
    }
    if (opts.unlockAt <= Date.now()) {
      return { field: 'unlockAt', message: 'unlockAt must be strictly in the future.' };
    }
    if (opts.unlockAt >= opts.expirationTimestamp) {
      return { field: 'unlockAt', message: 'unlockAt must be strictly before the video expiration.' };
    }
  }

  if (opts.accessMode === 'allowlist') {
    // Deduplicate by canonical form
    const deduped = [...new Set(
      (opts.allowlist ?? []).map(a => {
        try {
          return AccountAddress.from(a).toStringLong();
        } catch {
          return a.toLowerCase();
        }
      })
    )];
    if (deduped.length < 1) {
      return { field: 'allowlist', message: 'Allowlist must contain at least 1 address.' };
    }
    if (deduped.length > 100) {
      return { field: 'allowlist', message: 'Allowlist must not exceed 100 addresses.' };
    }
  }

  return null;
}

/**
 * Submit `register_blob_v2` on the Move access_control module.
 *
 * Called after a successful Shelby blob registration when
 * `NEXT_PUBLIC_ACCESS_BACKEND === "move"`.
 *
 * Returns the transaction hash on success.
 * Throws WalletSigningError, ChainTransactionError on failure.
 */
export async function submitRegisterBlobV2(opts: {
  videoId: string;
  blobName: string;
  accessPolicy: AccessPolicy;
  signAndSubmitTransaction: (payload: any) => Promise<any>;
  account: { address?: { toString: () => string } } | null | undefined;
}): Promise<{ txHash: string; version: number | string }> {
  const { videoId, blobName, accessPolicy, signAndSubmitTransaction, account } = opts;

  // Check account is connected (Req 8.8)
  if (!account?.address) {
    throw new WalletSigningError(
      'missing_account',
      'No wallet account connected. Please connect your wallet and try again.',
    );
  }

  // Build RegistrationInfoV2 (Req 8.1, 8.7)
  const regInfo: RegistrationInfoV2 = {
    blob_name: blobName,
    green_box_scheme: 0,
    green_box_bytes: new Uint8Array(0),
    access_policy: accessPolicy,
  };

  // Use serializeRegistrationInfoV2Vec to wrap in a single-element vector
  // because the module exposes `register_blobs_v2` (plural, vector input)
  // as the entry function, not `register_blob_v2` (singular).
  const bcsBytes = serializeRegistrationInfoV2Vec([regInfo]);

  // Emit the no-green-box info log (Req 8.7, 14.2)
  console.info(JSON.stringify({ event: 'register_blob_v2_no_green_box', videoId }));

  // Build the entry function payload — the deployed module exposes
  // `register_blobs_v2(owner, regv2_vec_serialized)` which accepts a single
  // BCS-encoded vector<RegistrationInfoV2> argument. Use that plural form so
  // the on-chain module can deserialize internally.
  const payload = {
    function: `${ACCESS_CONTROL_MODULE}register_blobs_v2` as `${string}::${string}::${string}`,
    typeArguments: [],
    // Pass only the serialized bytes vector — the module will decode the
    // vector<RegistrationInfoV2> and register each entry.
    functionArguments: [Array.from(bcsBytes)],
  };

  // Sign and submit (Req 8.8 — catch wallet rejections)
  let txHash: string;
  try {
    const response = await signAndSubmitTransaction({ data: payload });
    txHash = response.hash;
  } catch (err) {
    // Categorize the signing failure
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.toLowerCase().includes('user rejected') ||
      msg.toLowerCase().includes('user denied') ||
      msg.toLowerCase().includes('rejected by user') ||
      msg.toLowerCase().includes('cancelled')
    ) {
      throw new WalletSigningError('user_rejection', `Wallet signing rejected: ${msg}`);
    }
    throw new WalletSigningError('adapter_error', `Wallet adapter error: ${msg}`);
  }

  // Wait for transaction with 60-second timeout (Req 8.1)
  const aptos = getAptosClient();
  let txResult: any;
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Transaction commit timeout (60s)')), 60_000)
    );
    const waitPromise = aptos.waitForTransaction({
      transactionHash: txHash,
      options: { checkSuccess: false },
    });
    txResult = await Promise.race([waitPromise, timeoutPromise]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes('timeout') || msg.includes('60s');
    throw new ChainTransactionError({
      entryFunction: 'register_blob_v2',
      isTimeout,
      message: `register_blob_v2 failed: ${msg}`,
    });
  }

  // Check on-chain result (Req 8.5)
  if (txResult.success === false) {
    const vmStatus: string = txResult.vm_status ?? '';
    throw new ChainTransactionError({
      entryFunction: 'register_blob_v2',
      abortCode: vmStatus || 'unknown',
      isTimeout: false,
      message: `register_blob_v2 aborted on-chain: ${vmStatus || 'Unknown VM error'}`,
    });
  }

  // Success — emit structured log (Req 14.2)
  const version = txResult.version ?? 0;
  logChainWriteSuccess('register_blob_v2', { videoId, txHash, version });

  return { txHash, version };
}

/**
 * Upload video to Shelbynet (blockchain + storage)
 *
 * Flow:
 *  1. Encrypt the video
 *  2. Compute BlobCommitments via the official SDK (erasure coding + Merkle root)
 *  3. Register on-chain with the SDK-computed Merkle root (register_blob transaction)
 *  4. Upload via commit_object transaction with chunked blob data embedded
 */
export async function uploadToShelby(
  file: File,
  metadata: Partial<VideoMetadata>,
  uploaderAccount: AccountAddress | { toString: () => string },
  signAndSubmitTransaction: any,
  signMessage: (args: { message: string; nonce: string }) => Promise<any>,
  walletPublicKeyHex: string | undefined,
  onProgress?: (progress: UploadProgress) => void
): Promise<ShelbyUploadResponse> {
  try {
    const uploaderAddress = metadata.uploader!;
    // Normalise — Google keyless auth returns a plain object, wallet returns AccountAddress
    const resolvedAccount = uploaderAccount instanceof AccountAddress
      ? uploaderAccount
      : AccountAddress.fromString(uploaderAddress);

    // Step 1: Analyze video
    onProgress?.({ stage: 'encrypting', progress: 5, message: 'Analyzing video...' });

    const duration = await getVideoDuration(file);

    // Step 2: Generate encryption key
    onProgress?.({ stage: 'encrypting', progress: 10, message: 'Generating encryption key...' });

    const encryptionKey = generateEncryptionKey();

    // Step 3: Encrypt video
    onProgress?.({ stage: 'encrypting', progress: 20, message: 'Encrypting video...' });

    const encryptedBlob = await encryptFile(file, encryptionKey);
    const encryptedBuffer = await encryptedBlob.arrayBuffer();

    // Step 4: Generate thumbnail
    onProgress?.({ stage: 'encrypting', progress: 30, message: 'Generating thumbnail...' });

    let thumbnailUrl: string | undefined = metadata.thumbnailUrl;
    if (!thumbnailUrl) {
      try {
        thumbnailUrl = await generateThumbnail(file, Math.floor(duration / 2));
      } catch (error) {
        console.warn('Failed to generate thumbnail:', error);
      }
    }

    // Step 5: Generate IDs & names
    const videoId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const blobName = `${videoId}_${file.name}`;


    // Step 6: Upload to Shelby via the server-side platform account.
    //
    // Shelby's chunk-upload authentication requires a raw Ed25519 signature
    // over server-issued challenge bytes with no framing — wallet-standard
    // signMessage() always wraps input in a structured frame before signing
    // (a deliberate anti-blind-signing protection every browser wallet
    // implements), so no browser wallet can ever satisfy it. See
    // .env.example (SHELBY_PLATFORM_PRIVATE_KEY) for the full explanation.
    // Registration, chunk upload, and commit_object all now happen
    // server-side under a dedicated platform account — Shelbyflix pays
    // Shelby's storage fees. This does NOT affect content control: access
    // policy, pricing, and purchase proceeds are still entirely governed
    // by the creator's own wallet via access_control below.
    onProgress?.({ stage: 'uploading', progress: 35, message: 'Preparing upload...' });

    const fileHashHex = await sha256Hex(encryptedBuffer);
    const uploadAuthMessage = `ShelbyFlix upload: ${fileHashHex}`;
    const nonce = crypto.randomUUID();

    onProgress?.({ stage: 'uploading', progress: 38, message: 'Sign to authorize upload... (approve wallet)' });

    const signed = await signMessage({ message: uploadAuthMessage, nonce });

    // Diagnostic: log exactly what the wallet returned (minus secret material)
    // so a future failure here is immediately debuggable instead of guessed
    // at. This matters because different wallet providers — the Petra
    // browser extension vs. AptosConnect's Google/Apple social-login
    // wallets, which are Aptos Keyless accounts under the hood — may not
    // implement signMessage identically or return the same field set, even
    // though both go through the same useWallet() interface.
    console.log('🔏 signMessage() response shape:', {
      hasSignature: !!signed?.signature,
      hasFullMessage: !!signed?.fullMessage,
      hasPublicKey: !!signed?.publicKey,
      keys: signed ? Object.keys(signed) : null,
    });

    // signed.publicKey is only present on some wallet implementations.
    // walletPublicKeyHex (passed in from the connected account's own
    // account.publicKey, NOT derivable from uploaderAccount/resolvedAccount
    // — those are AccountAddress values by this point and never carry a
    // public key) is the reliable fallback.
    const walletPublicKey = signed?.publicKey ?? walletPublicKeyHex;

    if (!signed?.signature || !signed?.fullMessage || !walletPublicKey) {
      const missing = [
        !signed?.signature && 'signature',
        !signed?.fullMessage && 'fullMessage',
        !walletPublicKey && 'publicKey',
      ].filter(Boolean).join(', ');
      throw new Error(
        `Wallet did not return a usable signature for upload authorization ` +
        `(missing: ${missing}). This can happen with some social-login/` +
        `Keyless-based wallet connections that don't fully support message ` +
        `signing — try connecting with the Petra browser extension instead.`,
      );
    }

    onProgress?.({ stage: 'uploading', progress: 42, message: 'Uploading to Shelby storage...' });

    // Vercel serverless functions have a hard 4.5MB request body limit,
    // enforced at the infrastructure level (cannot be raised via
    // vercel.json or code). Encrypted video files routinely exceed that,
    // so the encrypted blob is staged directly to Vercel Blob storage from
    // the browser first — this upload goes straight to blob storage, not
    // through any of our own serverless functions, so it isn't subject to
    // that limit. /api/uploads then works with just the resulting URL.
    const { upload } = await import('@vercel/blob/client');
    const staged = await upload(blobName, encryptedBlob, {
      access: 'public',
      handleUploadUrl: '/api/uploads/blob-token',
      contentType: 'application/octet-stream',
      onUploadProgress: ({ percentage }) => {
        onProgress?.({
          stage: 'uploading',
          progress: 42 + percentage * 0.13, // 42% → 55%
          message: `Staging upload... ${Math.round(percentage)}%`,
        });
      },
    });

    onProgress?.({ stage: 'uploading', progress: 55, message: 'Registering on Shelby...' });

    const uploadResponse = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blobUrl: staged.url,
        walletAddress: uploaderAddress,
        publicKey: String(walletPublicKey),
        signature: String(signed.signature),
        signedMessage: String(signed.fullMessage),
        blobName,
        expirationDays: metadata.availabilityPeriod || 30,
      }),
    });
    const uploadResult = await uploadResponse.json().catch(() => ({}));

    if (!uploadResponse.ok || !uploadResult?.success) {
      throw new Error(uploadResult?.error || `Shelby upload failed (${uploadResponse.status})`);
    }

    if (uploadResult.isWritten === false) {
      console.warn(
        `Blob "${blobName}" uploaded but not yet showing as committed (isWritten: false). ` +
        `It should resolve shortly, but may briefly show "not found" in the explorer.`,
      );
    }

    onProgress?.({ stage: 'uploading', progress: 60, message: 'Upload complete, finalizing...' });

    const blobId = blobName;

    // Step 7b: Move-flag — register access policy on the access_control module.
    // Runs AFTER the Shelby-layer upload now (order reversed from the old
    // flow, since upload no longer needs blob metadata from a prior
    // client-side registration step). Only for non-public modes (allowlist,
    // timelock, purchasable) since public videos don't need access gating.
    if (
      process.env.NEXT_PUBLIC_ACCESS_BACKEND === 'move' &&
      metadata.accessMode &&
      metadata.accessMode !== 'public'
    ) {
      onProgress?.({
        stage: 'uploading',
        progress: 45,
        message: 'Registering access policy on-chain... (approve wallet)',
      });

      const accessPolicy = mapFormToAccessPolicy({
        accessMode: metadata.accessMode!,
        price: metadata.price,
        allowlist: (metadata as any).allowlist,
        unlockAt: (metadata as any).unlockAt,
      });

      const chainResult = await submitRegisterBlobV2({
        videoId,
        blobName,
        accessPolicy,
        signAndSubmitTransaction,
        account: resolvedAccount ? { address: { toString: () => resolvedAccount.toStringLong() } } : null,
      });

      // Store the chain tx hash for downstream use
      (metadata as any)._chainTxHash = chainResult.txHash;
    }

    // Step 9: Generate Shelbynet URL
    const shelbyUrl = getBlobStreamUrl(blobName, uploaderAddress);

    // Step 10: Complete
    onProgress?.({ stage: 'complete', progress: 100, message: 'Upload complete!' });


    return {
      videoId,
      blobId,
      blobName,
      shelbyUrl,
      encryptionKey,
      duration,
      thumbnailUrl,
      success: true,
      _chainTxHash: (metadata as any)._chainTxHash,
    };
  } catch (error) {

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
    return cached;
  }

  // Deduplicate in-flight requests for the same blob
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!;
  }

  const promise = (async () => {

    const response = await fetch(shelbyUrl, { signal });
    if (!response.ok) {
      // Throw detailed error for 404 so VideoPlayer can detect it
      if (response.status === 404) {
        throw new Error(`Download failed: 404`);
      }
      // Generic error for other status codes
      throw new Error(`Download failed: ${response.status}`);
    }

    const encryptedBlob = await response.blob();

    const decryptedBlob = await decryptBlob(encryptedBlob, encryptionKey);

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
  }

  videoCache.set(key, blob);
}

export function clearVideoCache(): void {
  videoCache.clear();
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
  const cacheKey = `video_${blobName}`;
  if (videoCache.has(cacheKey)) {
    videoCache.delete(cacheKey);
  }

  if (!signAndSubmitTransaction) {
    throw new Error('No signer available to delete Shelby blob');
  }

  if (!blobName) {
    throw new Error('Missing blob name for Shelby deletion');
  }

  const payload = ShelbyBlobClient.createDeleteObjectPayload({ blobName });

  let txHash: string;
  try {
    const response = await signAndSubmitTransaction({ data: payload });
    txHash = response.hash;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.toLowerCase().includes('user rejected') ||
      message.toLowerCase().includes('user denied') ||
      message.toLowerCase().includes('rejected by user') ||
      message.toLowerCase().includes('cancelled')
    ) {
      throw new Error('Shelby deletion cancelled by user');
    }
    throw new Error(`Shelby deletion failed: ${message}`);
  }

  const aptos = getAptosClient();
  let txResult: any;
  try {
    txResult = await aptos.waitForTransaction({
      transactionHash: txHash,
      options: { checkSuccess: false },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Shelby deletion commit failed: ${message}`);
  }

  if (txResult.success === false) {
    const vmStatus: string = txResult.vm_status ?? '';
    throw new Error(`Shelby deletion aborted on-chain: ${vmStatus || 'Unknown VM error'}`);
  }

  logChainWriteSuccess('delete_blob', {
    videoId,
    txHash,
    version: txResult.version ?? 0,
  });

  return true;
}

/**
 * Validate video file
 */
/**
 * SHA-256 hash of a buffer, as lowercase hex — matches sha256Hex() in
 * app/api/uploads/route.ts exactly, since the client-signed message must
 * hash-match what the server independently recomputes from the received
 * bytes.
 */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  const MAX_SIZE = parseInt(process.env.NEXT_PUBLIC_MAX_VIDEO_SIZE || '104857600');
  const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];

  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    // Some browsers/OS don't set MIME type on drag-and-drop; fall back to extension check
    const ext = file.name.split('.').pop()?.toLowerCase();
    const ALLOWED_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi'];
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      return {
        valid: false,
        error: `Invalid file type. Allowed: MP4, WebM, MOV, AVI`,
      };
    }
  }

  if (file.size > MAX_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size: ${(MAX_SIZE / 1024 / 1024).toFixed(0)}MB`,
    };
  }

  return { valid: true };
}
