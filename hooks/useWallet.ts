import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { useEffect, useState } from 'react';
import { checkTokenOwnership } from '@/lib/aptos';

interface UseWalletReturn {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  disconnect: () => void;
  wallet: any;
}

/**
 * Custom hook wrapping Aptos wallet adapter
 * Provides easy access to wallet connection state
 */
export function useWallet(): UseWalletReturn {
  const {
    account,
    connected,
    connecting,
    disconnect,
    wallet,
  } = useAptosWallet();

  return {
    address: account?.address || null,
    connected,
    connecting,
    disconnect,
    wallet,
  };
}

export default useWallet;
