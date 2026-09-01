import { NextRequest, NextResponse } from 'next/server';
import { Ed25519PublicKey, type Account } from '@aptos-labs/ts-sdk';
import { hexToBytes } from '@/lib/shared-utils';
import { getPlatformAccount } from '@/lib/shelby-platform';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { STAGING_BUCKET } from '@/lib/upload-staging';

// ---------------------------------------------------------------------------
// Max staged file size
// ---------------------------------------------------------------------------

/**
 * Maximum upload file size in bytes (100 MB).
 * Also enforced at the middleware level via Content-Length header check.
 */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

// ---------------------------------------------------------------------------
// POST /api/uploads
//
// JSON body fields expected:
//   - stagingPath   : path of the encrypted file within the Supabase
//                      Storage staging bucket (see
//                      /api/uploads/staging-token) (string)
//   - walletAddress : 0x-prefixed Aptos address (string)
//   - publicKey     : hex Ed25519 public key (string)
//   - signature     : hex Ed25519 signature over the message below (string)
//   - signedMessage : the exact UTF-8 string that was signed (string)
//   - blobName      : the Shelby blob name to register (string)
//   - expirationDays: how many days the blob should be retained (number)
//
// The client must sign: "ShelbyFlix upload: <sha256-of-file-hex>"
// This ties the signature to the specific file being uploaded — prevents
// replay attacks where an old upload signature is re-used for a new file.
//
// NOTE: the file itself is no longer sent directly to this route. Vercel
// serverless functions have a hard 4.5MB request body limit enforced at
// the infrastructure level (cannot be raised via vercel.json or code —
// confirmed against Vercel's own docs), which every real video upload
// would exceed. The browser instead stages the encrypted blob to a
// private Supabase Storage bucket first (bypassing this limit entirely)
// and sends just a path reference here — a small JSON payload, well
// under the limit. This route downloads the actual bytes server-side via
// the authenticated Supabase admin client, which isn't subject to the
// same client-request body cap.
//
// (Previously staged via Vercel Blob's client-upload flow instead —
// switched away after hitting a confirmed, currently unresolved CORS bug
// on Vercel's own infrastructure; see community.vercel.com/t/46967.)
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return NextResponse.json({ error: 'Expected application/json' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const {
      stagingPath,
      walletAddress,
      publicKey,
      signature,
      // The exact bytes the wallet actually signed. Wallet-standard signMessage
      // (Petra, and every AIP-62-compliant wallet) wraps the requested
      // `message` in its own framing before signing (commonly including a
      // nonce and app info) — the wallet's own SDK call returns this exact
      // wrapped string as `fullMessage`. We verify the signature against
      // THAT, rather than assuming any particular wrapping format ourselves —
      // different wallets may construct it differently, and guessing at a
      // cryptographic wire format here would be the same mistake this app's
      // Shelby integration made repeatedly elsewhere in this codebase.
      signedMessage: fullMessage,
      blobName,
      expirationDays: expirationDaysRaw,
    } = body as Record<string, unknown>;

    // ── Validate required fields ─────────────────────────────────────────
    if (
      typeof stagingPath !== 'string' || !stagingPath ||
      typeof walletAddress !== 'string' || !walletAddress ||
      typeof publicKey !== 'string' || !publicKey ||
      typeof signature !== 'string' || !signature ||
      typeof fullMessage !== 'string' || !fullMessage
    ) {
      return NextResponse.json(
        { error: 'Missing required fields: stagingPath, walletAddress, publicKey, signature, signedMessage' },
        { status: 400 }
      );
    }
    // Same sanitisation as the staging-token route — alphanumeric,
    // underscore, hyphen, dot only. Prevents path traversal within the
    // staging bucket.
    if (!/^[\w.-]+$/.test(stagingPath)) {
      return NextResponse.json({ error: 'Invalid stagingPath' }, { status: 400 });
    }

    // ── Validate wallet address format ───────────────────────────────────
    if (!/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    // ── Fetch the staged file server-to-server ───────────────────────────
    // Not subject to the client-request body limit — this is an outbound
    // fetch initiated by our own server, not an inbound request body.
    // Uses the service-role admin client since the staging bucket is
    // private, not the public-URL pattern Vercel Blob used.
    let fileBuffer: ArrayBuffer;
    let contentLength: number;
    try {
      const admin = getSupabaseAdmin();
      const { data: stagedBlob, error: downloadError } = await admin.storage
        .from(STAGING_BUCKET)
        .download(stagingPath);

      if (downloadError || !stagedBlob) {
        console.error('Failed to download staged upload:', downloadError);
        return NextResponse.json({ error: 'Failed to fetch staged upload' }, { status: 502 });
      }
      fileBuffer = await stagedBlob.arrayBuffer();
      contentLength = fileBuffer.byteLength;
    } catch (err) {
      console.error('Failed to fetch staged blob:', err);
      return NextResponse.json({ error: 'Failed to fetch staged upload' }, { status: 502 });
    }

    // ── Validate file size ───────────────────────────────────────────────
    if (contentLength > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB` },
        { status: 413 }
      );
    }
    if (contentLength === 0) {
      return NextResponse.json({ error: 'Staged upload is empty' }, { status: 400 });
    }

    // Encrypted blobs (AES-256-GCM ciphertext, see lib/encryption.ts) are
    // pseudorandom bytes by construction — they will never match a video
    // magic-byte signature, that's the point of encryption, so no
    // magic-byte check applies here (unlike a hypothetical plaintext
    // upload path). The wallet signature verified below already ties this
    // exact request to a specific, pre-committed file hash, which is the
    // real integrity/auth guarantee here.

    // ── Verify the signed content is bound to THIS exact file ───────────
    // Client must have requested a signature over "ShelbyFlix upload: <hash>"
    // — we can't assume exact equality with fullMessage since the wallet's
    // own wrapping is opaque to us, so we check containment instead. This
    // still cryptographically binds the signature to this specific file:
    // the signature only validates against the exact fullMessage bytes
    // (checked below), and fullMessage must contain our expected content.
    const fileHash = await sha256Hex(fileBuffer);
    const expectedMessage = `ShelbyFlix upload: ${fileHash}`;

    if (!fullMessage.includes(expectedMessage)) {
      return NextResponse.json(
        { error: 'Signed message does not match file hash. Possible tampering.' },
        { status: 401 }
      );
    }

    // ── Verify Ed25519 signature against the exact bytes the wallet signed ─
    const messageBytes = new TextEncoder().encode(fullMessage);
    let signatureValid = false;
    try {
      const pubKey  = new Ed25519PublicKey(publicKey);
      const sigBytes = hexToBytes(signature.startsWith('0x') ? signature.slice(2) : signature);
      signatureValid = pubKey.verifySignature({ message: messageBytes, signature: sigBytes } as any);
    } catch (err) {
      console.error('Signature verification error:', err);
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
    }

    if (!signatureValid) {
      return NextResponse.json({ error: 'Invalid wallet signature' }, { status: 401 });
    }

    // ── Validate Shelby-specific fields ──────────────────────────────────
    if (typeof blobName !== 'string' || blobName.trim().length === 0) {
      return NextResponse.json({ error: 'Missing required field: blobName' }, { status: 400 });
    }

    const expirationDays = expirationDaysRaw != null ? Number(expirationDaysRaw) : 30;
    if (!Number.isFinite(expirationDays) || expirationDays <= 0 || expirationDays > 365) {
      return NextResponse.json(
        { error: 'expirationDays must be a positive number, at most 365' },
        { status: 400 },
      );
    }

    // ── Perform the upload using the platform account ───────────────────
    // The wallet signature already verified above proves the connected
    // creator authorized THIS specific file to be uploaded — the platform
    // account only handles Shelby's storage-layer bookkeeping from here.
    let platformAccount: Account;
    try {
      platformAccount = getPlatformAccount();
    } catch (err) {
      console.error('Platform account unavailable:', err);
      return NextResponse.json(
        { error: 'Shelby upload is not configured on this server' },
        { status: 503 },
      );
    }

    const { ShelbyNodeClient } = await import('@shelby-protocol/sdk/node');
    const { Network } = await import('@aptos-labs/ts-sdk');

    const networkName = (process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'SHELBYNET').toUpperCase();
    const network = networkName === 'TESTNET' ? Network.TESTNET : Network.SHELBYNET;

    const client = new ShelbyNodeClient({
      network,
      apiKey: process.env.SHELBY_API_KEY,
    });

    const expirationMicros = (Date.now() + expirationDays * 24 * 60 * 60 * 1000) * 1000;

    try {
      await client.upload({
        blobData: new Uint8Array(fileBuffer),
        signer: platformAccount,
        blobName,
        expirationMicros,
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`Shelby upload failed for blob "${blobName}":`, msg);
      await cleanupStagedBlob(stagingPath);

      if (/insufficient/i.test(msg) || /E_INSUFFICIENT_FUNDS/i.test(msg)) {
        return NextResponse.json(
          { error: 'Platform storage account has insufficient ShelbyUSD/gas. Contact support.' },
          { status: 503 },
        );
      }
      if (/already exists/i.test(msg) || /BlobAlreadyExists/i.test(msg)) {
        return NextResponse.json({ error: 'A blob with this name is already registered' }, { status: 409 });
      }

      return NextResponse.json({ error: `Shelby upload failed: ${msg}` }, { status: 502 });
    }

    // The staged Supabase Storage upload was only ever a bridge past the
    // function body limit — once Shelby has the bytes, it serves no
    // further purpose.
    await cleanupStagedBlob(stagingPath);

    // Verify the blob actually reached the committed (isWritten) state
    // before reporting success — a registered-but-uncommitted blob would
    // otherwise look successful here but be unreachable/"not found"
    // everywhere else (explorer, download, etc.).
    let isWritten = false;
    try {
      const metadata = await client.coordination.getFullObjectMetadata({
        account: platformAccount.accountAddress,
        name: blobName,
      });
      isWritten = metadata?.isWritten ?? false;
    } catch (err) {
      console.warn(`Post-upload metadata check failed for "${blobName}":`, err);
    }

    return NextResponse.json({
      success: true,
      blobName,
      owner: platformAccount.accountAddress.toString(),
      isWritten,
    });

  } catch (err) {
    console.error('Upload route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Best-effort deletion of a staged Supabase Storage upload. Never throws —
 * a failed cleanup shouldn't mask the real upload result. Unlike the old
 * Vercel Blob approach (which had a validUntil-based auto-expiry as a
 * backstop), this staging bucket has no automatic expiry configured, so a
 * failed cleanup here does leave the staged file behind — acceptable
 * since it's a small ciphertext blob in a private bucket, not a
 * correctness or security issue, but worth revisiting if stale staged
 * files ever need periodic sweeping.
 */
async function cleanupStagedBlob(stagingPath: string): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.storage.from(STAGING_BUCKET).remove([stagingPath]);
    if (error) {
      console.warn(`Failed to clean up staged upload at ${stagingPath}:`, error);
    }
  } catch (err) {
    console.warn(`Failed to clean up staged upload at ${stagingPath}:`, err);
  }
}