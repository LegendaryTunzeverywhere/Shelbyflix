import { csrfFetch } from '@/lib/csrf-client';

export type WalletAction = 'comment' | 'comment-delete' | 'comment-like' | 'engagement' | 'subscription' | 'subscription-status';

type SignMessage = (args: { message: string; nonce: string }) => Promise<{
  signature?: unknown;
  fullMessage?: unknown;
  publicKey?: unknown;
}>;

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function postWalletInteraction<T>(
  walletAddress: string,
  publicKey: unknown,
  signMessage: SignMessage,
  action: WalletAction,
  payload: Record<string, unknown>,
): Promise<T> {
  const challengeResponse = await fetch(
    `/api/auth/challenge?walletAddress=${encodeURIComponent(walletAddress)}`,
    { cache: 'no-store' },
  );
  const challenge = await challengeResponse.json();
  if (!challengeResponse.ok || typeof challenge.nonce !== 'string') {
    throw new Error(challenge.error || 'Could not authorize this wallet action');
  }

  const message = `ShelbyFlix ${action}: ${challenge.nonce}\n${stableStringify(payload)}`;
  const signed = await signMessage({ message, nonce: challenge.nonce });
  const key = signed.publicKey ?? publicKey;
  if (!signed.signature || !signed.fullMessage || !key) {
    throw new Error('Wallet did not provide a complete signature for this action');
  }

  const response = await csrfFetch('/api/interactions', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress,
      publicKey: String(key),
      signature: String(signed.signature),
      signedMessage: String(signed.fullMessage),
      nonce: challenge.nonce,
      action,
      payload,
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Wallet action failed');
  }
  return result as T;
}
