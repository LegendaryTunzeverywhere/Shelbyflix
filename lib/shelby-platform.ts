import { Ed25519PrivateKey, Account } from '@aptos-labs/ts-sdk';
import { ShelbyBlobClient } from '@shelby-protocol/sdk/node';

let cachedPlatformAccount: Account | null = null;

/**
 * The Shelby-level owner-of-record for every blob this app registers.
 *
 * Shelby's chunk-upload authentication (ShelbyRPCClient.signChallenge)
 * requires a raw Ed25519 signature over arbitrary server-issued bytes, with
 * no framing. Wallet-standard signMessage() (what Petra and every other
 * Aptos wallet extension expose) always wraps input in a structured frame
 * before signing — a deliberate anti-blind-signing security boundary, not
 * a gap in any particular wallet. That means no browser-connected wallet
 * can ever satisfy Shelby's storage-layer ownership check, regardless of
 * which account "should" conceptually own the content. This dedicated
 * server-held account exists specifically to bridge that gap: Shelbyflix
 * pays Shelby's registration/storage fees and is the on-chain "owner" for
 * Shelby's bookkeeping purposes only. Actual content control — access
 * policy, pricing, purchase proceeds — remains entirely with each
 * creator's own wallet via the separate access_control Move module.
 *
 * Also used to delete blobs (see deleteShelbyBlob below): since the
 * platform account is the real on-chain owner, it's the only account that
 * can successfully sign a Shelby delete_object transaction — not the
 * uploader's own wallet, and not an admin's own wallet either.
 */
export function getPlatformAccount(): Account {
  if (cachedPlatformAccount) return cachedPlatformAccount;

  const raw = process.env.SHELBY_PLATFORM_PRIVATE_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'SHELBY_PLATFORM_PRIVATE_KEY is not configured. See .env.example for setup instructions.',
    );
  }

  const privateKey = new Ed25519PrivateKey(raw.trim());
  cachedPlatformAccount = Account.fromPrivateKey({ privateKey });
  return cachedPlatformAccount;
}

/**
 * Delete a blob from Shelby storage, signed by the platform account (the
 * blob's actual on-chain owner). Used by both uploader-initiated and
 * admin-initiated video deletion — see app/api/videos/[id]/route.ts.
 */
export async function deleteShelbyBlob(platformAccount: Account, blobName: string): Promise<void> {
  const { Network } = await import('@aptos-labs/ts-sdk');

  const networkName = (process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'SHELBYNET').toUpperCase();
  const network = networkName === 'TESTNET' ? Network.TESTNET : Network.SHELBYNET;

  const { ShelbyNodeClient } = await import('@shelby-protocol/sdk/node');
  const client = new ShelbyNodeClient({
    network,
    apiKey: process.env.SHELBY_API_KEY,
  });

  const payload = ShelbyBlobClient.createDeleteObjectPayload({ blobName });
  const transaction = await client.aptos.transaction.build.simple({
    sender: platformAccount.accountAddress,
    data: payload,
  });
  await client.aptos.signAndSubmitTransaction({ signer: platformAccount, transaction });
}
