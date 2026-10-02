export function resolveWalletInteractionMessages(
  fullMessage: string,
  expectedMessage: string,
  nonce: string,
): string[] {
  const normalizedExpectedMessage = expectedMessage.replace(/\r\n?/g, '\n');
  if (!normalizedExpectedMessage.includes(nonce)) return [];

  const normalizedFullMessage = fullMessage.replace(/\r\n?/g, '\n');
  if (normalizedFullMessage.includes(normalizedExpectedMessage)) {
    return [fullMessage, expectedMessage];
  }

  return [expectedMessage];
}
