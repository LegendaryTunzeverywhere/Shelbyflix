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

  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      optInWallets={["Petra", "Nightly", "Continue with Google", "Continue with Apple"]}
      dappConfig={{
        network: Network.TESTNET,
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