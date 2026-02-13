'use client';

import React from 'react';
import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';
import { PetraWallet } from 'petra-plugin-wallet-adapter';
import { MartianWallet } from '@martianwallet/aptos-wallet-adapter';
import { Network } from '@aptos-labs/ts-sdk';

export function AptosWalletProvider({ children }: { children: React.ReactNode }) {
  // Initialize wallets inside the component to avoid SSR issues
  const wallets = React.useMemo(() => {
    if (typeof window === 'undefined') return [];
    return [new PetraWallet(), new MartianWallet()];
  }, []);

  return (
    <AptosWalletAdapterProvider
      plugins={wallets}
      autoConnect={true}
      onError={(error) => {
        console.error('Wallet error:', error);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
