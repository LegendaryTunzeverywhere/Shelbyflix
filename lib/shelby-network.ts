/**
 * Single source of truth for which Shelby network this deployment talks to.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several files independently computed the Shelby network with:
 *
 *     const networkName = (process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'SHELBYNET').toUpperCase();
 *     const network = networkName === 'TESTNET' ? Network.TESTNET : Network.SHELBYNET;
 *
 * That is no longer valid. As of @shelby-protocol/sdk 0.8.x the SDK's
 * `ShelbyNetwork` is only:
 *
 *     type ShelbyNetwork = Network.LOCAL | Network.SHELBYNET | Network.CUSTOM
 *
 * There is no `TESTNET` member — Aptos testnet is not a Shelby network. A
 * testnet deployment therefore has to be expressed as `Network.CUSTOM` with an
 * explicit Aptos fullnode, not as `Network.TESTNET`.
 *
 * Centralising it also stops the drift that produced the production outage:
 * the SDK dropped `expirationMicros` from `register_blob` in 0.8.0 to match
 * the deployed contracts, and the app was pinned to `^0.4.1`, which — because
 * caret ranges on 0.x versions stop at the next minor — can never resolve to
 * 0.8.x. Every upload then failed on chain with
 * `Type mismatch for argument 3, type 'vector<u8>'`.
 */

import { Network } from '@aptos-labs/ts-sdk';
import type { ShelbyClientConfig, ShelbyNetwork } from '@shelby-protocol/sdk/node';
import { getAptosClientConfigWithApiKey } from './shelby-env';

export interface ResolvedShelbyNetwork {
  /** Value to pass to `ShelbyNodeConfig.network`. */
  network: ShelbyNetwork;
  /**
   * Aptos fullnode override. Only set for `Network.CUSTOM`; leave undefined
   * for LOCAL/SHELBYNET so the SDK uses its built-in endpoints.
   */
  fullnode?: string;
  indexer?: string;
  faucet?: string;
}

export function resolveShelbyNetwork(): ResolvedShelbyNetwork {
  const raw = (process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'SHELBYNET').trim().toUpperCase();

  switch (raw) {
    case 'LOCAL':
      return { network: Network.LOCAL };

    case 'TESTNET':
    case 'DEVNET':
    case 'CUSTOM': {
      // Not a Shelby network — point the SDK at Aptos directly and let it
      // treat the deployment as a custom chain.
      return {
        network: Network.CUSTOM,
        fullnode: process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL?.trim(),
        indexer: process.env.NEXT_PUBLIC_SHELBYNET_INDEXER_URL?.trim(),
        faucet: process.env.NEXT_PUBLIC_SHELBYNET_FAUCET_URL?.trim(),
      };
    }

    case 'SHELBYNET':
    default:
      return { network: Network.SHELBYNET };
  }
}

/**
 * Build the config object accepted by `new ShelbyNodeClient(...)`.
 *
 * `apiKey` is included only when one is configured; the SDK treats a present
 * but empty key as an auth attempt and Shelbynet answers 401
 * "API key not found", which is much harder to diagnose than a missing header.
 */
export function buildShelbyNodeConfig(overrides: {
  locationHint?: string;
  selectedLocation?: string;
} = {}): ShelbyClientConfig {
  const { network, fullnode, indexer, faucet } = resolveShelbyNetwork();
  const apiKey = getAptosClientConfigWithApiKey();

  const config: ShelbyClientConfig = {
    network,
    ...(apiKey ? { apiKey: apiKey.API_KEY } : {}),
    ...(overrides.locationHint ? { locationHint: overrides.locationHint } : {}),
  };

  if (network === Network.CUSTOM) {
    // `ShelbyClientConfig` takes Aptos endpoints under `aptos`, and the
    // Shelby-side endpoints as nested objects. Only CUSTOM needs any of this;
    // LOCAL and SHELBYNET use the SDK's built-in endpoints.
    if (fullnode || indexer || faucet) {
      config.aptos = {
        ...(fullnode ? { fullnode } : {}),
        ...(indexer ? { indexer } : {}),
        ...(faucet ? { faucet } : {}),
      } as ShelbyClientConfig['aptos'];
    }
  }

  return config;
}
