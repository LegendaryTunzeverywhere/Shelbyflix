'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useWallet } from '@/hooks/useWallet';
import { authorizeWalletSession } from '@/lib/wallet-interactions';
import UsernameModal from '@/components/UsernameModal';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const { needsUsername, loading: walletLoading, address, connected, account, signMessage, refreshUser } = useWallet();
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [sessionState, setSessionState] = useState<'idle' | 'authorizing' | 'failed'>('idle');
  const [sessionError, setSessionError] = useState<string | null>(null);
  const attemptedWallet = useRef<string | null>(null);

  useEffect(() => {
    setShowUsernameModal(needsUsername);
  }, [needsUsername]);

  const authorize = useCallback(async () => {
    if (!connected || !address) return;

    setSessionState('authorizing');
    setSessionError(null);
    window.dispatchEvent(new Event('wallet-session-authorizing'));
    try {
      await authorizeWalletSession(address.toString(), account?.publicKey, signMessage);
      setSessionState('idle');
      window.dispatchEvent(new Event('wallet-session-established'));
    } catch (error) {
      console.error('Failed to authorize wallet session:', error);
      setSessionError(error instanceof Error ? error.message : 'Wallet authorization was not completed.');
      setSessionState('failed');
      window.dispatchEvent(new Event('wallet-session-failed'));
    }
  }, [connected, address, account?.publicKey, signMessage]);

  useEffect(() => {
    if (!connected || !address || walletLoading || needsUsername) {
      attemptedWallet.current = null;
      if (!connected || !address) {
        setSessionState('idle');
        setSessionError(null);
      }
      return;
    }

    const walletAddress = address.toString().toLowerCase();
    if (attemptedWallet.current === walletAddress) return;
    attemptedWallet.current = walletAddress;
    setSessionState('authorizing');
    const timer = window.setTimeout(() => {
      void authorize();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [connected, address, walletLoading, needsUsername, authorize]);

  const handleUsernameComplete = async (_username: string) => {
    setShowUsernameModal(false);
    await refreshUser();
  };

  return (
    <>
      {connected && sessionState !== 'idle' && (
        <section
          aria-live="polite"
          className="flex flex-col gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <div className="flex min-w-0 items-start gap-3">
            {sessionState === 'authorizing'
              ? <ArrowPathIcon className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-brand-red" />
              : <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-red" />
            }
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">
                {sessionState === 'authorizing' ? 'Authorize Shelbyflix once' : 'Wallet authorization needed'}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-zinc-300">
                Approve the wallet signature to enable comments, likes, and subscriptions for 24 hours.
                This is not a blockchain transaction and will not transfer tokens.
              </p>
              {sessionState === 'failed' && (
                <p role="alert" className="mt-1 text-xs text-red-300">
                  {sessionError || 'Authorization was not completed.'}
                </p>
              )}
            </div>
          </div>
          {sessionState === 'failed' && (
            <button
              type="button"
              onClick={() => void authorize()}
              className="shrink-0 self-start rounded-xl bg-brand-red px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:self-center"
            >
              Try again
            </button>
          )}
        </section>
      )}
      {children}

      {showUsernameModal && address && (
        <UsernameModal
          walletAddress={address.toString()}
          onComplete={handleUsernameComplete}
        />
      )}
    </>
  );
}
