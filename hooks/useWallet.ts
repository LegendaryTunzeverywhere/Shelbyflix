'use client';

import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { useState, useEffect } from 'react';
import { getUserByWallet, type User } from '@/lib/user-service';

export function useWallet() {
  const { account, connected, disconnect, signAndSubmitTransaction } = useAptosWallet();
  const [user, setUser] = useState<User | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();
  }, [account?.address, connected]);

  const checkUser = async () => {
    if (!account?.address || !connected) {
      setUser(null);
      setNeedsUsername(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const existingUser = await getUserByWallet(account.address.toString());
      
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

  return {
    address: account?.address,
    connected,
    disconnect,
    signAndSubmitTransaction,
    user,
    needsUsername,
    loading,
    refreshUser,
  };
}