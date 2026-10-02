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
  const normalizedFullMessage = fullMessage.replace(/\r\n?/g, '\n');
  const normalizedExpectedMessage = expectedMessage.replace(/\r\n?/g, '\n');
  return normalizedExpectedMessage.includes(nonce)
    && normalizedFullMessage.includes(normalizedExpectedMessage);
}
