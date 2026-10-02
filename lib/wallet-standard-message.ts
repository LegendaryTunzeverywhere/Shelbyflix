export function resolveWalletInteractionMessage(
  fullMessage: string,
  signedContent: string,
  expectedMessage: string,
  nonce: string,
): string | null {
  if (
    !signedContent.includes(expectedMessage) ||
    !signedContent.includes(nonce) ||
    !fullMessage.includes(signedContent)
  ) {
    return null;
  }
  return fullMessage;
}
