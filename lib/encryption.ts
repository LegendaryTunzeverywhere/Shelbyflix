/**
 * ENCRYPTION UTILITIES
 *
 * Uses the browser's native Web Crypto API (AES-256-GCM) for raw binary output.
 * CryptoJS was removed because CryptoJS.AES.encrypt() with a string key outputs a
 * Base64-encoded OpenSSL string blob, NOT raw binary data. This caused the Shelbynet
 * "Merkle Root does not match onchain registration" error because:
 *   1. The server computes SHA-256 over raw ciphertext bytes it receives.
 *   2. Our commitment was SHA-256 of Base64 text bytes — a completely different hash.
 *
 * Encrypted blob layout: [12-byte random IV | AES-GCM ciphertext + 16-byte auth tag]
 */

// ---------------------------------------------------------------------------
// KEY HELPERS
// ---------------------------------------------------------------------------

/**
 * Generate a random 256-bit encryption key returned as a hex string.
 */
export function generateEncryptionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Convert a hex string to a Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Import a raw 32-byte hex key as a Web Crypto CryptoKey. */
async function importAesKey(hex: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    hexToBytes(hex).slice(),
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

// ---------------------------------------------------------------------------
// ENCRYPT / DECRYPT
// ---------------------------------------------------------------------------

/**
 * Encrypt a file using AES-256-GCM.
 * Stores the original MIME type in the first bytes so decryption can restore it.
 *
 * Blob layout: [1 byte: mime length | N bytes: mime string | 12-byte IV | ciphertext]
 */
export async function encryptFile(file: File, key: string): Promise<Blob> {
  const fileData = await file.arrayBuffer();
  const cryptoKey = await importAesKey(key, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    fileData
  );

  // Encode MIME type so decryption can restore the correct type
  const mimeBytes = new TextEncoder().encode(file.type || 'video/mp4');
  const mimeLength = new Uint8Array([mimeBytes.length]);

  const combined = new Uint8Array(
    mimeLength.byteLength + mimeBytes.byteLength + iv.byteLength + ciphertext.byteLength
  );
  let offset = 0;
  combined.set(mimeLength, offset); offset += mimeLength.byteLength;
  combined.set(mimeBytes, offset);  offset += mimeBytes.byteLength;
  combined.set(iv, offset);         offset += iv.byteLength;
  combined.set(new Uint8Array(ciphertext), offset);

  return new Blob([combined], { type: 'application/octet-stream' });
}

/**
 * Decrypt a blob produced by encryptFile.
 * Reads the MIME type prefix, then decrypts AES-GCM and returns the correct video type.
 *
 * Also supports legacy blobs (no MIME prefix) — falls back to video/mp4.
 */
export async function decryptBlob(encryptedBlob: Blob, key: string): Promise<Blob> {
  const data = await encryptedBlob.arrayBuffer();
  const bytes = new Uint8Array(data);

  let mimeType = 'video/mp4';
  let offset = 0;

  // Detect new format: first byte is MIME length (must be < 50 to distinguish from old IV)
  const possibleMimeLength = bytes[0];
  if (possibleMimeLength > 0 && possibleMimeLength < 50) {
    offset = 1;
    const mimeBytes = bytes.slice(offset, offset + possibleMimeLength);
    const decoded = new TextDecoder().decode(mimeBytes);
    // Sanity check it looks like a MIME type
    if (decoded.startsWith('video/') || decoded.startsWith('application/')) {
      mimeType = decoded;
      offset += possibleMimeLength;
    } else {
      // Not the new format — reset to legacy mode
      offset = 0;
    }
  }

  const IV_LENGTH = 12;
  const iv = bytes.slice(offset, offset + IV_LENGTH);
  const ciphertext = bytes.slice(offset + IV_LENGTH);

  const cryptoKey = await importAesKey(key, ['decrypt']);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new Blob([plaintext], { type: mimeType });
}

/**
 * Get video duration from file
 */
export async function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(Math.floor(video.duration));
    };

    video.onerror = () => {
      reject(new Error('Failed to load video metadata'));
    };

    video.src = URL.createObjectURL(file);
  });
}

/**
 * Generate thumbnail from video.
 * BUG FIX: Was returning a temporary blob URL (URL.createObjectURL) which dies on
 * page reload. Now returns a base64 data URL that survives storage in Supabase.
 */
export async function generateThumbnail(file: File, timeInSeconds: number = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const objectUrl = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(timeInSeconds, video.duration - 0.1);
    };

    video.onseeked = () => {
      canvas.width = Math.min(video.videoWidth, 1280);
      canvas.height = Math.min(video.videoHeight, 720);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Return as base64 data URL — persists across page reloads
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(objectUrl);
      resolve(dataUrl);
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load video'));
    };

    video.src = objectUrl;
  });
}