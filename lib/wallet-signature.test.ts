import { describe, expect, it } from 'vitest';
import { Network } from '@aptos-labs/ts-sdk';
import {
  resolveKeylessVerificationNetwork,
  resolveKeylessVerificationNetworks,
} from '@/lib/wallet-signature';

describe('resolveKeylessVerificationNetwork', () => {
  it.each([
    ['MAINNET', Network.MAINNET],
    ['TESTNET', Network.TESTNET],
    ['DEVNET', Network.DEVNET],
    ['SHELBYNET', Network.CUSTOM],
    ['CUSTOM', Network.CUSTOM],
    ['shelbynet', Network.CUSTOM],
  ])('maps %s to its Aptos RPC network', (name, network) => {
    expect(resolveKeylessVerificationNetwork(name)).toBe(network);
  });

  it('rejects unknown networks instead of silently verifying against mainnet', () => {
    expect(() => resolveKeylessVerificationNetwork('UNKNOWN')).toThrow(
      'Unsupported keyless verification network: UNKNOWN',
    );
  });
});

describe('resolveKeylessVerificationNetworks', () => {
  it('tries Devnet after Shelbynet when no explicit override is configured', () => {
    expect(resolveKeylessVerificationNetworks('SHELBYNET')).toEqual([
      Network.CUSTOM,
      Network.DEVNET,
    ]);
  });

  it('respects an explicit Shelbynet override without falling back', () => {
    expect(resolveKeylessVerificationNetworks('SHELBYNET', true)).toEqual([
      Network.CUSTOM,
    ]);
  });
});
