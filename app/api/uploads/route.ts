import { NextRequest, NextResponse } from 'next/server';
import { Ed25519PublicKey } from '@aptos-labs/ts-sdk';
import { hexToBytes } from '@/lib/shared-utils';

// ---------------------------------------------------------------------------
// Allowed MIME types and max file size
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',  // .mov
  'video/x-msvideo', // .avi
]);

/**
 * Maximum upload file size in bytes (100 MB).
 * Also enforced at the middleware level via Content-Length header check.
 */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

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
    const signedMessage = formData.get('signedMessage') as string | null;

    // ── Validate required fields ─────────────────────────────────────────
    if (!file || !walletAddress || !publicKey || !signature || !signedMessage) {
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
        { error: `Unsupported file type: ${file.type}. Allowed: mp4, webm, mov, avi` },
        { status: 415 }
      );
    }

    // Magic-byte check (first 12 bytes) to prevent MIME spoofing
    const fileBuffer = await file.arrayBuffer();
    const header = new Uint8Array(fileBuffer.slice(0, 12));
    if (!isVideoMagicBytes(header)) {
      return NextResponse.json(
        { error: 'File content does not match a recognised video format' },
        { status: 415 }
      );
    }

    // ── Verify the signed message format ─────────────────────────────────
    // Client must sign "ShelbyFlix upload: <sha256-of-file-hex>"
    const fileHash = await sha256Hex(fileBuffer);
    const expectedMessage = `ShelbyFlix upload: ${fileHash}`;

    if (signedMessage !== expectedMessage) {
      return NextResponse.json(
        { error: 'Signed message does not match file hash. Possible tampering.' },
        { status: 401 }
      );
    }

    // ── Verify Ed25519 signature ──────────────────────────────────────────
    const messageBytes = new TextEncoder().encode(signedMessage);
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

    // ── Upload not yet implemented server-side ──────────────────────────
    // Uploads are currently handled client-side via `lib/utils.ts` → `uploadToShelby()`.
    // The client uploads directly to the Shelbynet CDN after wallet-signing the file hash.
    // This server-side endpoint will be activated once Shelbynet server-side integration
    // is complete. Until then, return 501 to avoid misleading clients.
    return NextResponse.json(
      { error: 'Upload endpoint not yet implemented. Use client-side Shelbynet upload.' },
      { status: 501 }
    );

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