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

  // Determine network based on environment variable
  // Note: Wallet adapters use Aptos Network enums. For Shelbynet-1, we still
  // use Network.MAINNET for wallet connections since Shelbynet runs on Aptos mainnet infrastructure
  const networkName = (process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'SHELBYNET').toUpperCase();
  const network = networkName === 'TESTNET' ? Network.TESTNET : Network.MAINNET;

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