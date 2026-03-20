/**
 * Hook to require wallet connection for protected pages
 * Redirects to home if wallet not connected
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from './useWallet';

export function useRequireWallet(redirectUrl: string = '/?connect=true') {
  const { connected, address, loading } = useWallet();
  const router = useRouter();

  useEffect(() => {
    // Don't redirect while still loading
    if (loading) return;

    // Redirect if not connected
    if (!connected || !address) {
      console.log('⚠️ Wallet not connected - redirecting to home');
      router.push(redirectUrl);
    }
  }, [connected, address, loading, router, redirectUrl]);

  return {
    connected,
    address,
    loading,
    isReady: connected && !!address && !loading,
  };
}