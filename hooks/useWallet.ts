'use client';

import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { useState, useEffect, useCallback } from 'react';
import { getUserByWallet, type User } from '@/lib/user-service';

export function useWallet() {
  const { account, connected, disconnect, signAndSubmitTransaction: walletSignAndSubmit } = useAptosWallet();
  const [user, setUser] = useState<User | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [loading, setLoading] = useState(true);

  // Google Keyless state
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [googleAddress, setGoogleAddress] = useState<string | null>(null);

  // Check for Google user on mount
  useEffect(() => {
    try {
      import('@/lib/keyless-auth')
        .then(({ getUserInfo }) => {
          const userInfo = getUserInfo();
          if (userInfo) {
            setGoogleUser(userInfo);
            setGoogleAddress(userInfo.accountAddress);
          }
        })
        .catch(() => {});
    } catch {}
  }, []);

  // Check user whenever wallet or Google state changes
  useEffect(() => {
    checkUser();
  }, [account?.address, connected, googleAddress]);

  const checkUser = async () => {
    const walletAddress = account?.address?.toString();
    const effectiveAddress = googleAddress || walletAddress;
    const isConnected = connected || !!googleAddress;

    if (!effectiveAddress || !isConnected) {
      setUser(null);
      setNeedsUsername(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const existingUser = await getUserByWallet(effectiveAddress);
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

  const refreshUser = async () => { await checkUser(); };

  // Unified disconnect
  const handleDisconnect = async () => {
    if (googleAddress) {
      try {
        const { logout } = await import('@/lib/keyless-auth');
        logout();
        setGoogleUser(null);
        setGoogleAddress(null);
      } catch (error) {
        console.error('Failed to logout from Google:', error);
      }
    } else {
      disconnect();
    }
  };

  /**
   * Unified signAndSubmitTransaction — works for both Petra wallet and Google keyless
   * This is what UploadForm and other components should use
   */
  const unifiedSignAndSubmit = useCallback(async (payload: any): Promise<any> => {
    if (googleAddress) {
      // Google keyless — re-derive account and sign
      const { getKeylessSignAndSubmit } = await import('@/lib/keyless-auth');
      const keylessSign = await getKeylessSignAndSubmit();
      if (!keylessSign) {
        throw new Error('Google session expired. Please sign in again.');
      }
      return keylessSign(payload);
    } else {
      // Petra / browser wallet
      if (!walletSignAndSubmit) {
        throw new Error('Wallet not connected.');
      }
      return walletSignAndSubmit(payload);
    }
  }, [googleAddress, walletSignAndSubmit]);

  return {
    // Address — works for both wallet and Google
    address: googleAddress
      ? { toString: () => googleAddress }
      : account?.address,

    // Connected — true for either auth method
    connected: connected || !!googleAddress,

    disconnect: handleDisconnect,

    // Unified signing — use this everywhere instead of useAptosWallet's version
    signAndSubmitTransaction: unifiedSignAndSubmit,

    user,
    needsUsername,
    loading,
    refreshUser,

    googleUser,
    isGoogleAuth: !!googleAddress,
  };
}
