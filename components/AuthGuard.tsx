'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';

interface AuthGuardProps {
  children: React.ReactNode;
  requireUsername?: boolean;
}

export default function AuthGuard({ children, requireUsername = false }: AuthGuardProps) {
  const router = useRouter();
  const { address, user, loading, connected } = useWallet();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Wait for wallet/auth to fully load before making any decision
    if (loading) return;

    // Give Google keyless auth extra time to restore session from localStorage
    const timer = setTimeout(() => {
      if (!connected || !address) {
        router.push('/');
        return;
      }

      // Username check — only redirect if explicitly required
      if (requireUsername && user !== null && !user?.username) {
        router.push('/?username=required');
        return;
      }

      setIsChecking(false);
    }, 300); // 300ms buffer for Google auth state to hydrate

    return () => clearTimeout(timer);
  }, [connected, address, user, loading, requireUsername, router]);

  if (loading || isChecking) {
    return (
      <div className="min-h-screen bg-brand-dark flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-zinc-700 border-t-brand-red rounded-full animate-spin mx-auto mb-4" />
          <p className="text-zinc-500 text-sm">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!connected || !address) return null;

  return <>{children}</>;

