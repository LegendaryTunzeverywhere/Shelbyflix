import { useState, useEffect } from 'react';
import { useWallet } from './useWallet';
import { checkTokenOwnership } from '@/lib/aptos';
import { AccountAddress } from '@aptos-labs/ts-sdk';

interface UseShelbyAccessReturn {
  hasAccess: boolean;
  balance: string;
  loading: boolean;
}

export function useShelbyAccess(): UseShelbyAccessReturn {
  const { address, connected } = useWallet();
  const [hasAccess, setHasAccess] = useState(false);
  const [balance, setBalance] = useState('0');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAccessStatus() {
      if (!connected || !address) {
        setHasAccess(false);
        setBalance('0');
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const result = await checkTokenOwnership(address.toString());
        setHasAccess(result.hasAccess);
        setBalance(result.balance);
      } catch (error) {
        console.error('Error checking Shelby access:', error);
        // Default to granting access even on error, as per checkTokenOwnership's behavior
        setHasAccess(true);
        setBalance('0');
      } finally {
        setLoading(false);
      }
    }

    fetchAccessStatus();
  }, [address, connected]);

  return {
    hasAccess,
    balance,
    loading,
  };
}

export default useShelbyAccess;
