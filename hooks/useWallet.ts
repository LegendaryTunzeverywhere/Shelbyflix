'use client';

import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { useState, useEffect, useCallback } from 'react';
import { getUserByWallet, type User } from '@/lib/user-service';

export function useWallet() {
  const {
    account,
    connected,
    disconnect,
    signAndSubmitTransaction: walletSignAndSubmit,
    signMessage: walletSignMessage,
  } = useAptosWallet();

  const [user, setUser] = useState<User | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check user whenever wallet state changes
  useEffect(() => {
    checkUser();
  }, [account?.address, connected]);

  const checkUser = async () => {
    const walletAddress = account?.address?.toString();

    if (!walletAddress || !connected) {
      setUser(null);
      setNeedsUsername(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const existingUser = await getUserByWallet(walletAddress);
      if (existingUser) {
        setUser(existingUser);
        setNeedsUsername(false);
      } else {
        setUser(null);
        setNeedsUsername(true);
      }
    } catch (error) {
      console.error('Failed to check user:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshUser = async () => {
    await checkUser();
  };

  /**
   * Sign and submit a transaction via the Wallet Adapter.
   */
  const signAndSubmitTransaction = useCallback(
    async (payload: any): Promise<any> => {
      if (!walletSignAndSubmit) {
        throw new Error('Wallet not connected.');
      }
      return walletSignAndSubmit(payload);
    },
    [walletSignAndSubmit]
  );

  /**
   * Sign a message via the Wallet Adapter.
   * Returns { signature, fullMessage, address, publicKey? } where available.
   */
  const signMessage = useCallback(
    async (args: { message: string; nonce: string }): Promise<any> => {
      if (!walletSignMessage) {
        throw new Error('Connected wallet does not support signMessage.');
      }
      return walletSignMessage(args);
    },
    [walletSignMessage]
  );

  return {
    address: account?.address,
    connected,
    disconnect,
    signAndSubmitTransaction,
    signMessage,
    account,
    user,
    needsUsername,
    loading,
    refreshUser,
  };
}
