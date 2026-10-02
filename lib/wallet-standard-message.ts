export function resolveWalletInteractionMessage(
  fullMessage: string,
  expectedMessage: string,
  nonce: string,
): string | null {
  const normalizedFullMessage = fullMessage.replace(/\r\n?/g, '\n');
  const normalizedExpectedMessage = expectedMessage.replace(/\r\n?/g, '\n');
  if (
    !normalizedExpectedMessage.includes(nonce) ||
    !normalizedFullMessage.includes(normalizedExpectedMessage) ||
    !normalizedFullMessage.includes(nonce)
  ) {
    return null;
  }
  return fullMessage;
}
