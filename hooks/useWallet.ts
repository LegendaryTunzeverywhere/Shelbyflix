'use client';

import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { useState, useEffect } from 'react';
import { getUserByWallet, type User } from '@/lib/user-service';

export function useWallet() {
  const { account, connected, disconnect, signAndSubmitTransaction } = useAptosWallet();
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
        .catch(() => {
          // Google auth not available
        });
    } catch {
      // Google auth module not found
    }
  }, []);

  // Check user whenever wallet or Google state changes
  useEffect(() => {
    checkUser();
  }, [account?.address, connected, googleAddress]);

  const checkUser = async () => {
    // Determine address from either wallet or Google
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

  const refreshUser = async () => {
    await checkUser();
  };

  // Unified disconnect function
  const handleDisconnect = async () => {
    if (googleAddress) {
      // Logout from Google
      try {
        const { logout } = await import('@/lib/keyless-auth');
        logout();
        setGoogleUser(null);
        setGoogleAddress(null);
      } catch (error) {
        console.error('Failed to logout from Google:', error);
      }
    } else {
      // Disconnect wallet
      disconnect();
    }
  };

  return {
    // Address (from wallet or Google)
    address: googleAddress ? { toString: () => googleAddress } : account?.address,
    
    // Connected status (wallet OR Google)
    connected: connected || !!googleAddress,
    
    // Disconnect (handles both)
    disconnect: handleDisconnect,
    
    // Sign function (wallet only for now - Google needs implementation)
    signAndSubmitTransaction,
    
    // User data
    user,
    needsUsername,
    loading,
    refreshUser,
    
    // Google-specific info
    googleUser,
    isGoogleAuth: !!googleAddress,
  };
}