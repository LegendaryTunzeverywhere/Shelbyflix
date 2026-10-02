export function resolveWalletInteractionMessage(
  fullMessage: string,
  expectedMessage: string,
  nonce: string,
): string | null {
  if (
    !expectedMessage.includes(nonce) ||
    !fullMessage.includes(expectedMessage) ||
    !fullMessage.includes(nonce)
  ) {
    return null;
  }
  return fullMessage;
}
