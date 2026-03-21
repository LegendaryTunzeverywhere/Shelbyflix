'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';

interface AuthGuardProps {
  children: React.ReactNode;
  requireUsername?: boolean;
}

export default function AuthGuard({ children, requireUsername = true }: AuthGuardProps) {
  const router = useRouter();
  const { address, user, loading, connected } = useWallet();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Wait for wallet/auth to load
    if (loading) return;

    // Check if user is connected
    if (!connected || !address) {
      console.log('❌ Not connected - redirecting to home');
      router.push('/?auth=required');
      return;
    }

    // Check if username is required and missing
    if (requireUsername && (!user || !user.username)) {
      console.log('❌ No username - redirecting to home');
      router.push('/?username=required');
      return;
    }

    // All checks passed
    setIsChecking(false);
  }, [connected, address, user, loading, requireUsername, router]);

  // Show loading state while checking
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

  // If not connected, don't render anything (already redirecting)
  if (!connected || !address) {
    return null;
  }

  // If username required but missing, don't render
  if (requireUsername && (!user || !user.username)) {
    return null;
  }

  // All good - render children
  return <>{children}</>;
}