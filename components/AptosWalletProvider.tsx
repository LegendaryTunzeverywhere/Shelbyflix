'use client';

import React from 'react';
import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';

export function AptosWalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      optInWallets={["Petra", "Nightly"]}
      onError={(err) => {
        console.error('Wallet error:', err);
        console.error(`Wallet connection failed: ${err.message}`);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}