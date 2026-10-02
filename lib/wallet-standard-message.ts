export interface WalletStandardMessageFields {
  prefix?: unknown;
  address?: unknown;
  application?: unknown;
  chainId?: unknown;
  message: string;
  nonce: string;
}

export function resolveWalletInteractionMessage(
  fullMessage: string,
  signedContent: string,
  expectedMessage: string,
  nonce: string,
  fields?: Omit<WalletStandardMessageFields, 'message' | 'nonce'>,
): string | null {
  if (!signedContent.includes(expectedMessage)) return null;
  if (fullMessage.includes(expectedMessage)) return fullMessage;
  if (!fields) return null;
  return buildWalletStandardMessage({ ...fields, message: signedContent, nonce });
}

export function buildWalletStandardMessage({
  prefix = 'APTOS',
  address,
  application,
  chainId,
  message,
  nonce,
}: WalletStandardMessageFields): string | null {
  if (prefix !== 'APTOS') return null;

  let fullMessage = 'APTOS';
  if (typeof address === 'string' && address) fullMessage += `\naddress: ${address}`;
  if (typeof application === 'string' && application) fullMessage += `\napplication: ${application}`;
  if (typeof chainId === 'number' && chainId) fullMessage += `\nchainId: ${chainId}`;
  return `${fullMessage}\nmessage: ${message}\nnonce: ${nonce}`;
}
