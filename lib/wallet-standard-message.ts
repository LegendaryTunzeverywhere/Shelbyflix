function utf8ToHex(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Does the wallet's signed frame carry `needle`?
 *
 * Wallets embed the requested text in one of two forms:
 *
 *   - literally — `message: ShelbyFlix session: <nonce>` — which is what the
 *     wallet-standard framing spec describes and what Petra (the browser
 *     extension) produces; or
 *   - hex-encoded — `message: 0x5368656c…` — because the wallet decoded the
 *     request's raw bytes with `Hex.fromHexInput(bytes).toString()` before
 *     framing. Aptos Connect's hosted prompt (web.petra.app, the backend for
 *     "Continue with Google"/"Continue with Apple") does exactly this: its
 *     prompt UI shows the decoded plaintext while the frame it signs carries
 *     the hex form of the same bytes, so a plaintext-only containment check
 *     rejects a signature that does in fact cover the requested content.
 *
 * Either form binds the signed bytes to `needle`: the frame is what the
 * signature covers, and hex-encoding a UTF-8 string is injective, so a frame
 * containing `0x<hex(needle)>` commits to exactly `needle`.
 */
export function walletFullMessageIncludes(fullMessage: string, needle: string): boolean {
  if (!needle) return false;
  const normalizedFullMessage = fullMessage.replace(/\r\n?/g, '\n');
  if (normalizedFullMessage.includes(needle)) return true;

  const needleHex = utf8ToHex(needle);
  // The frame's hex digits are compared case-insensitively (a wallet may
  // upper-case its hex) but the needle's hex is not: it encodes exact bytes,
  // and 'S' (0x53) is not 's' (0x73).
  const lowerCasedFullMessage = normalizedFullMessage.toLowerCase();
  return lowerCasedFullMessage.includes(`0x${needleHex}`)
    || lowerCasedFullMessage.includes(needleHex);
}

export function resolveWalletInteractionMessages(
  fullMessage: string,
  expectedMessage: string,
  nonce: string,
): string[] {
  const normalizedExpectedMessage = expectedMessage.replace(/\r\n?/g, '\n');
  if (!normalizedExpectedMessage.includes(nonce)) return [];

  return fullMessage ? [fullMessage] : [];
}

export function walletFullMessageBindsAction(
  fullMessage: string,
  expectedMessage: string,
  nonce: string,
): boolean {
  const normalizedExpectedMessage = expectedMessage.replace(/\r\n?/g, '\n');
  return normalizedExpectedMessage.includes(nonce)
    && walletFullMessageIncludes(fullMessage, normalizedExpectedMessage);
}
