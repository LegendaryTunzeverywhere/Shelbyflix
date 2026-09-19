'use client';

import React, { useEffect } from 'react';
import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';
import { Network } from '@aptos-labs/ts-sdk';

export function AptosWalletProvider({ children }: { children: React.ReactNode }) {
  // One-time cleanup of stale Google keyless localStorage keys from previous auth system
  useEffect(() => {
    localStorage.removeItem('aptos-keyless-ekp');
    localStorage.removeItem('aptos-keyless-user');
    localStorage.removeItem('aptos-keyless-jwt');
  }, []);

  // Determine network based on environment variable.
  //
  // FIX: this previously defaulted to Network.MAINNET based on a comment
  // claiming "Shelbynet runs on Aptos mainnet infrastructure" — that's
  // contradicted by Shelby's own SDK, which defines Network.SHELBYNET as a
  // genuinely distinct network (shelbyNetworks = [LOCAL, TESTNET,
  // SHELBYNET] in @shelby-protocol/sdk), with its own RPC endpoints
  // (api.shelbynet.shelby.xyz), its own deployer account, and its own
  // faucet (real Aptos mainnet has no faucet at all — that alone rules out
  // "Shelbynet is just mainnet"). Every other file in this codebase
  // already correctly defaults to Network.SHELBYNET
  // (lib/aptos.ts, lib/aptos-client.ts, lib/shelbynet-blob.ts,
  // app/api/uploads/route.ts) — this was the one place still pointing the
  // connected wallet at real Aptos mainnet, where the access_control
  // module isn't even deployed.
  const networkName = (process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'SHELBYNET').toUpperCase();
  const network = networkName === 'TESTNET' ? Network.TESTNET : Network.SHELBYNET;

  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      optInWallets={["Petra", "Nightly", "Continue with Google", "Continue with Apple"]}
      dappConfig={{
        network,
        aptosConnectDappId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      }}
      onError={(err) => {
        console.error('Wallet error:', err);
        console.error(`Wallet connection failed: ${err.message}`);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}