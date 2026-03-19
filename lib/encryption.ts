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
 *
 * Returns a raw binary Blob: [12-byte IV | ciphertext + 16-byte GCM auth tag].
 * There is NO Base64 layer — the bytes written to storage are pure ciphertext,
 * so SHA-256(blob) on the client matches SHA-256(received bytes) on the server.
 */
export async function encryptFile(file: File, key: string): Promise<Blob> {
  const fileData = await file.arrayBuffer();
  const cryptoKey = await importAesKey(key, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    fileData
  );

  // Prepend IV so decryption can recover it without out-of-band storage.
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  return new Blob([combined], { type: 'application/octet-stream' });
}

/**
 * Decrypt a blob produced by encryptFile.
 * Reads the 12-byte IV prefix, then decrypts and verifies the GCM auth tag.
 */
export async function decryptBlob(encryptedBlob: Blob, key: string): Promise<Blob> {
  const data = await encryptedBlob.arrayBuffer();
  const bytes = new Uint8Array(data);

  const IV_LENGTH = 12;
  const iv = bytes.slice(0, IV_LENGTH);
  const ciphertext = bytes.slice(IV_LENGTH);

  const cryptoKey = await importAesKey(key, ['decrypt']);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new Blob([plaintext], { type: 'video/mp4' });
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
 * Generate thumbnail from video
 */
export async function generateThumbnail(file: File, timeInSeconds: number = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    
    video.onloadedmetadata = () => {
      video.currentTime = timeInSeconds;
    };
    
    video.onseeked = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const thumbnailUrl = URL.createObjectURL(blob);
          resolve(thumbnailUrl);
        } else {
          reject(new Error('Failed to generate thumbnail'));
        }
      }, 'image/jpeg', 0.8);
      
      window.URL.revokeObjectURL(video.src);
    };
    
    video.onerror = () => reject(new Error('Failed to load video'));
    video.src = URL.createObjectURL(file);
  });
}