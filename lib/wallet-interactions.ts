import { csrfFetch } from '@/lib/csrf-client';
import { serializeWalletValue } from '@/lib/wallet-serialization';
import { WALLET_SESSION_PURPOSE } from '@/lib/wallet-session-constants';

export type WalletAction = 'comment' | 'comment-delete' | 'comment-like' | 'engagement' | 'session' | 'subscription' | 'subscription-status';

type SignMessage = (args: { message: string; nonce: string }) => Promise<{
  signature?: unknown;
  fullMessage?: unknown;
  message?: unknown;
  publicKey?: unknown;
}>;
type SignatureRequiredHandler = () => void | Promise<void>;

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
  onSignatureRequired?: SignatureRequiredHandler,
): Promise<T> {
  const interaction = (auth?: {
    publicKey: string;
    signature: string;
    signedMessage: string;
    signedContent: string;
    nonce: string;
  }) =>
    csrfFetch('/api/interactions', {
      method: 'POST',
      body: JSON.stringify({
        walletAddress,
        action,
        payload,
        ...auth,
      }),
    });

  const existingSessionResponse = await interaction();
  const existingSessionResult = await existingSessionResponse.json();
  if (existingSessionResult.code !== 'wallet_signature_required') {
    if (existingSessionResponse.ok) return existingSessionResult as T;
    throw new Error(existingSessionResult.error || 'Wallet action failed');
  }

  const challengeResponse = await fetch(
    `/api/auth/challenge?walletAddress=${encodeURIComponent(walletAddress)}`,
    { cache: 'no-store' },
  );
  const challenge = await challengeResponse.json();
  if (!challengeResponse.ok || typeof challenge.nonce !== 'string') {
    throw new Error(challenge.error || 'Could not authorize this wallet action');
  }

  const message = `ShelbyFlix ${action}: ${challenge.nonce}\n${stableStringify(payload)}`;
  await onSignatureRequired?.();
  const signed = await signMessage({ message, nonce: challenge.nonce });
  const key = signed.publicKey ?? publicKey;
  if (!signed.signature || !signed.fullMessage || !key) {
    throw new Error('Wallet did not provide a complete signature for this action');
  }

  const response = await interaction({
    publicKey: serializeWalletValue(key, 'publicKey'),
    signature: serializeWalletValue(signed.signature, 'signature'),
    signedMessage: serializeWalletValue(signed.fullMessage, 'utf8'),
    signedContent: serializeWalletValue(signed.message ?? message, 'utf8'),
    nonce: challenge.nonce,
  });
  const result = await response.json();
  if (!response.ok) {
    if (
      ['wallet_signature_invalid', 'wallet_message_unbound'].includes(result.code) &&
      result.diagnostics &&
      typeof result.diagnostics === 'object'
    ) {
      const checks = result.diagnostics as {
        actionIncluded?: boolean;
        payloadIncluded?: boolean;
        nonceIncluded?: boolean;
        verifierScheme?: string;
        verifierReason?: string;
        verifierDetail?: string;
      };
      throw new Error(
        `${result.code === 'wallet_message_unbound' ? 'Wallet did not bind your authorization message' : 'Wallet signature verification failed'} ` +
        `(${checks.verifierScheme ?? 'unknown'}: ${checks.verifierReason ?? 'unknown'}; ` +
        `full message includes action: ${checks.actionIncluded ? 'yes' : 'no'}, ` +
        `payload: ${checks.payloadIncluded ? 'yes' : 'no'}, challenge: ${checks.nonceIncluded ? 'yes' : 'no'}` +
        `${checks.verifierDetail ? `; ${checks.verifierDetail}` : ''}).`,
      );
    }
    throw new Error(result.error || 'Wallet action failed');
  }
  return result as T;
}

export async function authorizeWalletSession(
  walletAddress: string,
  publicKey: unknown,
  signMessage: SignMessage,
  onSignatureRequired?: SignatureRequiredHandler,
): Promise<void> {
  await postWalletInteraction<{ authorized: true }>(
    walletAddress,
    publicKey,
    signMessage,
    'session',
    { purpose: WALLET_SESSION_PURPOSE },
    onSignatureRequired,
  );
}
