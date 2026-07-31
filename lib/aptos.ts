import {
  Aptos,
  AptosConfig,
  Network,
  InputGenerateTransactionPayloadData,
} from '@aptos-labs/ts-sdk';

// ---------------------------------------------------------------------------
// Shelbynet Network Configuration
// ---------------------------------------------------------------------------
export const SHELBYNET_CONFIG = {
  name:       process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'TESTNET',
  nodeUrl:    process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL!,
  indexerUrl: process.env.NEXT_PUBLIC_SHELBYNET_INDEXER_URL!,
  faucetUrl:  process.env.NEXT_PUBLIC_SHELBYNET_FAUCET_URL!,
};

const config = new AptosConfig({
  network:  Network.CUSTOM,
  fullnode: SHELBYNET_CONFIG.nodeUrl,
  indexer:  SHELBYNET_CONFIG.indexerUrl,
  faucet:   SHELBYNET_CONFIG.faucetUrl,
});

export const aptos = new Aptos(config);

// ---------------------------------------------------------------------------
// Token Configuration
// ---------------------------------------------------------------------------
export const SHELBYUSD_TOKEN = (
  process.env.NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS
    ? `${process.env.NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS}`
    : '0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1'
) as `${string}::${string}::${string}`;

// Developer-friendly warning: if the env value looks like a plain address
// (e.g. 0xabc...123) rather than a full Move type tag (`0x...::module::Type`),
// wallet adapters (Petra, etc.) will fail to parse the typeTag during
// simulation/signing. Show an actionable hint in the console so devs can
// fix their `.env.local` quickly. We don't throw here to avoid breaking
// unit tests that set a short-form address in their mocking environment.
try {
  const raw = process.env.NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS;
  if (raw && /^0x[a-fA-F0-9]{1,64}$/.test(raw)) {
    // Only warn in non-production or when running locally
    // so deployed servers don't spam logs unnecessarily.
    if ((process.env.NODE_ENV || 'development') !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        `[lib/aptos] NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS appears to be an address-only value. ` +
          `Wallet adapters expect a full Move type tag like 0x1::module::Resource. ` +
          `Set NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS to the full token type (e.g. 0x1::shelby_usd::ShelbyUSD) in your .env.local to avoid typeTag parse errors.`
      );
    }
  }
} catch (_) {
  // Ignore any incidental errors reading env during SSR import.
}

export const MODULE_ADDRESS = (
  process.env.NEXT_PUBLIC_MODULE_ADDRESS ??
  '0x15ff27e78780a703a5e064ff087ac6078ed4889f6f25fa40f2f4d1e39f73ff25'
) as string;

export const NETWORK_NAME    = 'TESTNET';
export const NETWORK_CHAIN   = 'TESTNET';
export const SHELBY_FAUCET_URL = SHELBYNET_CONFIG.faucetUrl;
export const SHELBY_DOCS_URL   = 'https://docs.shelby.xyz';

// ---------------------------------------------------------------------------
// checkTokenOwnership
//
// SECURITY FIX: The original implementation always returned `hasAccess: true`
// with a comment saying "token requirement has been removed".
//
// This is dangerous because:
//  a) It makes the function a no-op that provides false confidence.
//  b) Any code path that calls this and checks the result believes it did
//     a real check — when it did nothing.
//
// Two valid approaches:
//  1. If you genuinely want open access: DELETE the calls to this function
//     and remove the token-gate UI entirely, so the intent is explicit.
//  2. If you want real token-gating: implement the actual balance check below.
//
// This file implements option 2. Switch to option 1 if needed.
// ---------------------------------------------------------------------------
export async function checkTokenOwnership(
  walletAddress: string,
  minBalance: number = parseFloat(process.env.NEXT_PUBLIC_MIN_TOKEN_BALANCE ?? '0.1')
): Promise<{ hasAccess: boolean; balance: string; isMissingStore?: boolean }> {

  if (!walletAddress || !/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
    console.warn('checkTokenOwnership: invalid address', walletAddress);
    // SECURE DEFAULT: deny on bad input
    return { hasAccess: false, balance: '0', isMissingStore: false };
  }

  try {
    // Fetch the primary fungible-asset store balance for SHELBYUSD_TOKEN
    const resources = await aptos.getAccountResources({ accountAddress: walletAddress });

    // Look for a FungibleStore or CoinStore that matches our token
    // Adjust the resource type string to match your actual on-chain module
    const coinStoreType = `0x1::coin::CoinStore<${SHELBYUSD_TOKEN}>`;
    const coinStore = resources.find((r: any) => r.type === coinStoreType);

    if (!coinStore) {
      // Store doesn't exist — wallet has never held this token
      return { hasAccess: false, balance: '0', isMissingStore: true };
    }

    const rawBalance: number = (coinStore.data as any)?.coin?.value ?? 0;
    // Aptos coins use 8 decimal places by default
    const humanBalance = rawBalance / 1e8;
    const hasAccess    = humanBalance >= minBalance;

    return {
      hasAccess,
      balance:      humanBalance.toFixed(4),
      isMissingStore: false,
    };
  } catch (error: any) {
    console.error('checkTokenOwnership error:', error);

    // ── SECURE DEFAULT: deny on error ─────────────────────────────────────
    // The original code returned `hasAccess: true` here — that is wrong.
    // A network error, RPC outage, or unexpected exception must not silently
    // grant access. Fail closed (deny) so the user is prompted to retry.
    return { hasAccess: false, balance: '0', isMissingStore: false };
  }
}

// ---------------------------------------------------------------------------
// registerShelbyUSD
// ---------------------------------------------------------------------------
export async function registerShelbyUSD(
  signAndSubmitTransaction: any
): Promise<string> {
  try {
    const payload: InputGenerateTransactionPayloadData = {
      function:          '0x1::primary_fungible_store::ensure_primary_store_exists' as `${string}::${string}::${string}`,
      typeArguments:     [],
      functionArguments: [SHELBYUSD_TOKEN],
    };
    const response = await signAndSubmitTransaction({ data: payload });
    await waitForTransaction(response.hash);
    return response.hash;
  } catch (error: any) {
    console.error('Failed to ensure ShelbyUSD store:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
export async function getAccountResource<T>(
  accountAddress: string,
  resourceType: string
): Promise<T | null> {
  try {
    const resource = await aptos.getAccountResource({
      accountAddress,
      resourceType: resourceType as `${string}::${string}::${string}`,
    });
    return resource.data as T;
  } catch {
    return null;
  }
}

export function formatAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function isValidAptosAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{1,64}$/.test(address);
}

export async function waitForTransaction(txnHash: string): Promise<boolean> {
  try {
    await aptos.waitForTransaction({ transactionHash: txnHash });
    return true;
  } catch (error) {
    console.error('Transaction error:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Removed stubs (2026-05):
// `storeVideoMetadataOnChain`, `getVideoMetadata`, and `deleteVideoFromChain`
// were placeholder functions that never did anything beyond logging and a
// timer-based `await`. The video-access-payments feature moved to the
// Supabase-backed `access-control.ts` + server verification pipeline, so
// these stubs were dead code. If a future feature needs to mirror video
// metadata on-chain, use `MODULE_ADDRESS` as the publish target and add
// real entry-function calls here — don't reintroduce stubs.
// ---------------------------------------------------------------------------

export const networkInfo = {
  name:        NETWORK_NAME,
  chain:       NETWORK_CHAIN,
  network:     'TESTNET',
  nodeUrl:     SHELBYNET_CONFIG.nodeUrl,
  indexerUrl:  SHELBYNET_CONFIG.indexerUrl,
  faucetUrl:   SHELBYNET_CONFIG.faucetUrl,
  explorerUrl: 'https://explorer.aptoslabs.com',
  faucetDocs:  'https://docs.shelby.xyz/apis/faucet',
  shelbyDocs:  SHELBY_DOCS_URL,
};