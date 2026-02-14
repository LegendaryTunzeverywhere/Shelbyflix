import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';

interface UseWalletReturn {
  address: string | null;
  connected: boolean;
  disconnect: () => void;
  wallet: any;
  signAndSubmitTransaction: any;
}

/**
 * Custom hook wrapping Aptos wallet adapter
 * Provides easy access to wallet connection state
 */
export function useWallet(): UseWalletReturn {
  const {
    account,
    connected,
    disconnect,
    wallet,
    signAndSubmitTransaction,
  } = useAptosWallet();

  return {
    address: account?.address || null,
    connected,
    disconnect,
    wallet,
    signAndSubmitTransaction,
  };
}

export default useWallet;
