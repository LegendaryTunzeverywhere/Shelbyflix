import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { getAptosClientConfigWithApiKey, getShelbyApiKey } from './shelby-env';

// Shelbynet fullnode now requires an API key (Authorization: Bearer).
// Without it, every view / transaction call fails with 401 "API key not found"
// which previously bubbled up as a 502 in /api/uploads. We resolve the key
// from SHELBY_API_KEY or NEXT_PUBLIC_SHELBY_API_KEY (fallback) and inject it
// into the Aptos SDK's clientConfig.
const apiKey = getShelbyApiKey();
const clientConfig = getAptosClientConfigWithApiKey();

if (!apiKey && process.env.NODE_ENV === 'production') {
  // Warn once at import time so operators see the misconfiguration in logs
  // before the first request fails. Validation in instrumentation.ts should
  // already throw, but Vercel's instrumentation hook may not run in all
  // runtimes — this is a safety net.
  console.warn(
    '[aptos-client] SHELBY_API_KEY is missing. Shelbynet requests will fail with 401. ' +
      'Set SHELBY_API_KEY in Vercel env vars (see .env.example).',
  );
}

const aptosClient = new Aptos(
  new AptosConfig({
    network: Network.CUSTOM,
    fullnode: process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL ?? 'https://api.shelbynet.shelby.xyz/v1',
    indexer: process.env.NEXT_PUBLIC_SHELBYNET_INDEXER_URL ?? 'https://api.shelbynet.shelby.xyz/v1/graphql',
    ...(clientConfig ? { clientConfig } : {}),
  }),
);

export function getAptosClient(): Aptos {
  return aptosClient;
}
