/**
 * lib/video-key-box.ts  (SERVER-ONLY)
 *
 * Encrypts per-video AES keys *at rest* so the Supabase `videos` table never
 * holds a raw decryption key. The raw keys are sealed here with a
 * platform-level key-encryption key (KEK) from `VIDEO_KEY_KEK` before
 * insertion, and opened only inside the single key-egress route
 * (GET /api/videos/:id/decryption-key).
 *
 * Format: `enc:v1:` + base64url(iv[12] | authTag[16] | ciphertext)
 * Rows written before this feature (or when no KEK is configured) carry no
 * prefix and are passed through untouched, so existing videos keep playing.
 *
 * Threat model: this protects against a leaked Supabase *anon* or *service*
 * key / database dump exposing decryption keys — an attacker still needs
 * `VIDEO_KEY_KEK` (kept only in server env) to recover them. It does NOT
 * protect against a full server compromise, which can read both.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** True when the stored value is a sealed key (vs a legacy plaintext key). */
export function isSealedKey(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

let warnedMissingKek = false;

/** Resolve the 32-byte KEK from env; null when not configured. */
function getKek(): Buffer | null {
  const raw = process.env.VIDEO_KEY_KEK;
  if (!raw || raw.trim().length === 0) {
    if (!warnedMissingKek && process.env.NODE_ENV === 'production') {
      warnedMissingKek = true;
      console.warn(
        '[video-key-box] VIDEO_KEY_KEK is not set — encryption keys are stored in plaintext. ' +
          'Set it to a random 64-char hex string to seal keys at rest.',
      );
    }
    return null;
  }
  const trimmed = raw.trim();
  // 64 hex chars = a ready-made 256-bit key; anything else is a passphrase
  // we deterministically stretch with SHA-256 (single-recipient, server-side).
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  return createHash('sha256').update(trimmed, 'utf8').digest();
}

/**
 * Seal a raw AES key for storage. Returns the input unchanged when no KEK is
 * configured (keeps dev setups working without new env), so callers never
 * need to branch on configuration.
 */
export function sealVideoKey(plainKey: string): string {
  const kek = getKek();
  if (!kek) return plainKey;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const ciphertext = Buffer.concat([cipher.update(plainKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

/**
 * Open a stored key back to its raw AES form. Legacy plaintext rows (no
 * prefix) pass through. Sealed rows WITHOUT a configured KEK fail closed —
 * returning the ciphertext blob as if it were the key would only produce a
 * confusing "unable to decrypt" playback error later, so we throw with an
 * actionable message instead.
 */
export function openVideoKey(stored: string): string {
  if (!isSealedKey(stored)) return stored;

  const kek = getKek();
  if (!kek) {
    throw new Error(
      'VIDEO_KEY_KEK is not configured but a sealed key was found; cannot open it.',
    );
  }

  const payload = Buffer.from(stored.slice(PREFIX.length), 'base64url');
  if (payload.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Sealed key payload is truncated or malformed.');
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);

  // Cipher setup AND auth all inside the try: if the runtime can't create
  // the GCM decipher (unexpected payload shape, OpenSSL quirk) the caller
  // still gets the clean "cannot open" error rather than a raw stack frame
  // pointing at these lines.
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Wrong KEK (rotated/changed) or tampered ciphertext — GCM auth failed.
    throw new Error('Failed to open sealed video key: KEK mismatch or corrupted value.');
  }
}
