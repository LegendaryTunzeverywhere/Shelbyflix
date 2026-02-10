import { useEffect, useState, useCallback } from 'react';
import { checkTokenOwnership } from '@/lib/aptos';
import { useWallet } from './useWallet';

interface TokenAccessState {
  hasAccess: boolean;
  balance: string;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Custom hook to check if connected wallet has required token
 * Automatically checks when wallet connects and provides refetch function
 * 
 * @param minBalance - Minimum token balance required (default: 1)
 * @returns Token access state and refetch function
 */
export function useTokenAccess(minBalance: number = 1): TokenAccessState {
  const { address, connected } = useWallet();
  const [hasAccess, setHasAccess] = useState(false);
  const [balance, setBalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkAccess = useCallback(async () => {
    if (!address || !connected) {
      setHasAccess(false);
      setBalance('0');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await checkTokenOwnership(address, minBalance);
      setHasAccess(result.hasAccess);
      setBalance(result.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check token balance');
      setHasAccess(false);
      setBalance('0');
    } finally {
      setLoading(false);
    }
  }, [address, connected, minBalance]);

  // Check access when wallet connects or address changes
  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  return {
    hasAccess,
    balance,
    loading,
    error,
    refetch: checkAccess,
  };
}

export default useTokenAccess;
