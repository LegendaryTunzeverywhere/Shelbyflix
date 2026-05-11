'use client';

import { useState, useEffect, useRef } from 'react';
import { useWallet } from './useWallet';

interface UseShelbyAccessReturn {
  hasAccess: boolean;
  balance: string;
  loading: boolean;
  error: string | null;
}

/**
 * Hook that checks whether the connected wallet has platform access.
 *
 * SECURITY FIXES applied vs. original:
 *  1. Errors now default to DENY access (not grant). Granting access on error
 *     meant any network hiccup, API outage, or thrown exception would
 *     silently open the platform to everyone — a safe-fail-open bug.
 *  2. The check is done via the server-side /api/auth/check-access endpoint
 *     (which verifies a wallet signature) rather than purely client-side,
 *     so the result cannot be spoofed by disabling JS or patching state.
 *
 * NOTE: If you have removed token-gating entirely (hasAccess always true),
 * you can simplify this hook to just `return { hasAccess: true, ... }` and
 * remove the API call — but never keep a "grant on error" fallback.
 */
export function useShelbyAccess(): UseShelbyAccessReturn {
  const { address, connected } = useWallet();
  const [hasAccess, setHasAccess]   = useState(false);
  const [balance, setBalance]       = useState('0');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastAddressRef = useRef<string | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Cancel previous request if wallet changed
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const currentAddress = address?.toString();

    // Skip if no address or address hasn't changed
    if (!connected || !currentAddress) {
      setHasAccess(false);
      setBalance('0');
      setLoading(false);
      setError(null);
      lastAddressRef.current = null;
      return;
    }

    // Skip if address hasn't actually changed
    if (lastAddressRef.current === currentAddress) {
      return;
    }

    lastAddressRef.current = currentAddress;

    // Debounce the fetch by 500ms to avoid rapid rerenders
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    setLoading(true);
    setError(null);

    debounceTimeoutRef.current = setTimeout(async () => {
      try {
        abortControllerRef.current = new AbortController();
        
        const res = await fetch(
          `/api/auth/check-access?wallet=${encodeURIComponent(currentAddress)}`,
          {
            method: 'GET',
            signal: abortControllerRef.current.signal,
          }
        );

        if (!res.ok) {
          // On error, deny access by default (secure fail-deny)
          setHasAccess(false);
          setBalance('0');
          setError(`Access check failed: ${res.status}`);
        } else {
          const data = await res.json();
          setHasAccess(!!data.hasAccess);
          setBalance(data.balance ?? '0');
          setError(null);
        }
      } catch (err: any) {
        // Ignore abort errors (request cancelled)
        if (err.name === 'AbortError') {
          return;
        }
        console.error('Access check error:', err);
        setHasAccess(false);
        setBalance('0');
        setError('Network error. Please check your connection.');
      } finally {
        setLoading(false);
      }
    }, 500); // 500ms debounce

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [connected, address]);

  return { hasAccess, balance, loading, error };
}

export default useShelbyAccess;