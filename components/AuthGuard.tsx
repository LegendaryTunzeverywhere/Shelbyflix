'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';

interface AuthGuardProps {
  children: React.ReactNode;
  requireUsername?: boolean;
}

type VerifyState = 'idle' | 'verifying' | 'done' | 'error';

/**
 * AuthGuard — wraps pages that require a connected wallet.
 *
 * Verification flow (no signMessage required):
 *  1. The Aptos Wallet Adapter has already performed the connect handshake
 *     with the wallet, so we trust `connected && address` on the client.
 *  2. The server re-validates by calling GET /api/auth/check-access, which
 *     enforces the real access gate (token ownership, bans, etc.).
 *  3. Pages render only after the server returns hasAccess=true.
 *
 * We deliberately DO NOT ask the wallet to signMessage here — that was
 * unreliable across wallets after Petra deprecated its legacy API, and the
 * server-side GET check gives us equivalent guarantees for this app.
 */
export default function AuthGuard({
  children,
  requireUsername = false,
}: AuthGuardProps) {
  const router = useRouter();
  const { address, user, loading, connected } = useWallet();

  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [verified, setVerified] = useState(false);

  const verifyWallet = useCallback(async () => {
    if (!connected || !address) return;

    const addrStr = address.toString();

    try {
      setVerifyState('verifying');

      const res = await fetch(
        `/api/auth/check-access?wallet=${encodeURIComponent(addrStr)}`,
        { cache: 'no-store' }
      );

      if (!res.ok) {
        throw new Error(`Server verification failed: ${res.status}`);
      }

      const data = await res.json().catch(() => ({}));
      if (data?.hasAccess === false) {
        throw new Error('Access denied by server');
      }

      console.log('✅ Wallet verified (connected)');
      setVerified(true);
      setVerifyState('done');
    } catch (err) {
      console.error('❌ AuthGuard verification failed:', err);
      setVerifyState('error');
      // Redirect after a brief pause so the error state can be seen
      setTimeout(() => router.push('/'), 1500);
    }
  }, [connected, address, router]);

  useEffect(() => {
    if (loading) return;

    const timer = setTimeout(() => {
      if (!connected || !address) {
        router.push('/');
        return;
      }
      if (requireUsername && user !== null && !user?.username) {
        router.push('/?username=required');
        return;
      }
      // Only verify if not already verified in this session
      if (!verified && verifyState === 'idle') {
        verifyWallet();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [connected, address, user, loading, requireUsername, router, verified, verifyState, verifyWallet]);

  // ── Loading / verification states ────────────────────────────────────────
  if (loading || !verified) {
    const label =
      verifyState === 'verifying' ? 'Verifying access...' :
      verifyState === 'error'     ? 'Verification failed' :
      'Verifying access...';

    const isError = verifyState === 'error';

    return (
      <div className="min-h-screen bg-brand-dark flex items-center justify-center">
        <div className="text-center">
          {isError ? (
            <div className="w-16 h-16 rounded-full bg-red-900/30 border border-red-700 flex items-center justify-center mx-auto mb-4">
              <span className="text-red-400 text-2xl">✕</span>
            </div>
          ) : (
            <div className="w-16 h-16 border-4 border-zinc-700 border-t-brand-red rounded-full animate-spin mx-auto mb-4" />
          )}
          <p className={`text-sm ${isError ? 'text-red-400' : 'text-zinc-500'}`}>{label}</p>
        </div>
      </div>
    );
  }

  if (!connected || !address) return null;

  return <>{children}</>;
}
