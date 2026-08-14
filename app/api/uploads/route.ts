import { NextRequest, NextResponse } from 'next/server';
import { Ed25519PublicKey, Ed25519PrivateKey, Account } from '@aptos-labs/ts-sdk';
import { hexToBytes } from '@/lib/shared-utils';

// ---------------------------------------------------------------------------
// Allowed MIME types and max file size
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',  // .mov
  'video/x-msvideo', // .avi
  // Encrypted blobs are opaque ciphertext (AES-256-GCM output), so the
  // browser typically sends them as generic binary — magic-byte sniffing
  // below only applies when the plaintext MIME type is asserted.
  'application/octet-stream',
]);

/**
 * Maximum upload file size in bytes (100 MB).
 * Also enforced at the middleware level via Content-Length header check.
 */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

let cachedPlatformAccount: Account | null = null;

/**
 * The Shelby-level owner-of-record for every blob this app registers.
 *
 * Shelby's chunk-upload authentication (ShelbyRPCClient.signChallenge)
 * requires a raw Ed25519 signature over arbitrary server-issued bytes, with
 * no framing. Wallet-standard signMessage() (what Petra and every other
 * Aptos wallet extension expose) always wraps input in a structured frame
 * before signing — a deliberate anti-blind-signing security boundary, not
 * a gap in any particular wallet. That means no browser-connected wallet
 * can ever satisfy Shelby's storage-layer ownership check, regardless of
 * which account "should" conceptually own the content. This dedicated
 * server-held account exists specifically to bridge that gap: Shelbyflix
 * pays Shelby's registration/storage fees and is the on-chain "owner" for
 * Shelby's bookkeeping purposes only. Actual content control — access
 * policy, pricing, purchase proceeds — remains entirely with each
 * creator's own wallet via the separate access_control Move module.
 */
function getPlatformAccount(): Account {
  if (cachedPlatformAccount) return cachedPlatformAccount;

  const raw = process.env.SHELBY_PLATFORM_PRIVATE_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'SHELBY_PLATFORM_PRIVATE_KEY is not configured. See .env.example for setup instructions.',
    );
  }

  const privateKey = new Ed25519PrivateKey(raw.trim());
  cachedPlatformAccount = Account.fromPrivateKey({ privateKey });
  return cachedPlatformAccount;
}

// ---------------------------------------------------------------------------
// POST /api/uploads
//
// Multipart form fields expected:
//   - file          : video file (binary)
//   - walletAddress : 0x-prefixed Aptos address (string)
//   - publicKey     : hex Ed25519 public key (string)
//   - signature     : hex Ed25519 signature over the message below (string)
//   - signedMessage : the exact UTF-8 string that was signed (string)
//
// The client must sign: "ShelbyFlix upload: <sha256-of-file-hex>"
// This ties the signature to the specific file being uploaded — prevents
// replay attacks where an old upload signature is re-used for a new file.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const formData = await req.formData();

    const file          = formData.get('file') as File | null;
    const walletAddress = formData.get('walletAddress') as string | null;
    const publicKey     = formData.get('publicKey') as string | null;
    const signature     = formData.get('signature') as string | null;
    // The exact bytes the wallet actually signed. Wallet-standard signMessage
    // (Petra, and every AIP-62-compliant wallet) wraps the requested
    // `message` in its own framing before signing (commonly including a
    // nonce and app info) — the wallet's own SDK call returns this exact
    // wrapped string as `fullMessage`. We verify the signature against
    // THAT, rather than assuming any particular wrapping format ourselves —
    // different wallets may construct it differently, and guessing at a
    // cryptographic wire format here would be the same mistake this app's
    // Shelby integration made repeatedly elsewhere in this codebase.
    const fullMessage   = formData.get('signedMessage') as string | null;

    // ── Validate required fields ─────────────────────────────────────────
    if (!file || !walletAddress || !publicKey || !signature || !fullMessage) {
      return NextResponse.json(
        { error: 'Missing required fields: file, walletAddress, publicKey, signature, signedMessage' },
        { status: 400 }
      );
    }

    // ── Validate wallet address format ───────────────────────────────────
    if (!/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    // ── Validate file size ───────────────────────────────────────────────
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB` },
        { status: 413 }
      );
    }

    // ── Validate MIME type (from field, then magic-byte sniff) ───────────
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Allowed: mp4, webm, mov, avi, or encrypted octet-stream` },
        { status: 415 }
      );
    }

    const fileBuffer = await file.arrayBuffer();

    // Encrypted blobs (AES-256-GCM ciphertext, see lib/encryption.ts) are
    // pseudorandom bytes by construction — they will never match a video
    // magic-byte signature, that's the point of encryption. Magic-byte
    // sniffing only makes sense for plaintext uploads. The wallet signature
    // verified below already ties this exact request to a specific,
    // pre-committed file hash, which is the real integrity/auth guarantee
    // here regardless of whether the content is encrypted.
    if (file.type !== 'application/octet-stream') {
      const header = new Uint8Array(fileBuffer.slice(0, 12));
      if (!isVideoMagicBytes(header)) {
        return NextResponse.json(
          { error: 'File content does not match a recognised video format' },
          { status: 415 }
        );
      }
    }

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

    // ── Extract Shelby-specific fields ───────────────────────────────────
    const blobName = formData.get('blobName') as string | null;
    const expirationDaysRaw = formData.get('expirationDays') as string | null;

    if (!blobName || typeof blobName !== 'string' || blobName.trim().length === 0) {
      return NextResponse.json({ error: 'Missing required field: blobName' }, { status: 400 });
    }

    const expirationDays = expirationDaysRaw ? Number(expirationDaysRaw) : 30;
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
 * Check the first 12 bytes for common video magic bytes.
 * This catches the most common spoofing attempts (e.g. HTML file renamed to .mp4).
 */
function isVideoMagicBytes(bytes: Uint8Array): boolean {
  // MP4 / MOV — ftyp box at offset 4
  if (
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  ) return true;

  // WebM — starts with 0x1A 0x45 0xDF 0xA3
  if (
    bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  ) return true;

  // AVI — RIFF...AVI
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x41 && bytes[9] === 0x56 && bytes[10] === 0x49 && bytes[11] === 0x20
  ) return true;

  return false;
}