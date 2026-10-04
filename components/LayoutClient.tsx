'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, ShieldCheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useWallet } from '@/hooks/useWallet';
import { authorizeWalletSession } from '@/lib/wallet-interactions';
import UsernameModal from '@/components/UsernameModal';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const { needsUsername, loading: walletLoading, address, connected, account, signMessage, refreshUser } = useWallet();
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [sessionState, setSessionState] = useState<'idle' | 'authorizing' | 'failed'>('idle');
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const attemptedWallet = useRef<string | null>(null);
  const sessionDialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!showSessionModal) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    sessionDialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [showSessionModal]);

  useEffect(() => {
    setShowUsernameModal(needsUsername);
  }, [needsUsername]);

  const authorize = useCallback(async () => {
    if (!connected || !address) return;

    setSessionState('authorizing');
    setSessionError(null);
    window.dispatchEvent(new Event('wallet-session-authorizing'));
    try {
      await authorizeWalletSession(
        address.toString(),
        account?.publicKey,
        signMessage,
        async () => {
          setShowSessionModal(true);
          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => resolve());
            });
          });
        },
      );
      setSessionState('idle');
      setShowSessionModal(false);
      window.dispatchEvent(new Event('wallet-session-established'));
    } catch (error) {
      console.error('Failed to authorize wallet session:', error);
      setShowSessionModal(true);
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
        setShowSessionModal(false);
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

  // Programmatic sign-in trigger: the wallet dropdown's "Sign In" button
  // and the players' "Sign In" state after a 401 both dispatch this event
  // so the signing flow (and its modal) lives in exactly one place.
  useEffect(() => {
    const onRequestSession = () => {
      if (!connected || !address) return;
      if (sessionState === 'authorizing') return;
      void authorize();
    };
    window.addEventListener('shelbyflix:authorize-session', onRequestSession);
    return () =>
      window.removeEventListener('shelbyflix:authorize-session', onRequestSession);
  }, [connected, address, sessionState, authorize]);

  const handleUsernameComplete = async (_username: string) => {
    setShowUsernameModal(false);
    await refreshUser();
  };

  return (
    <>
      {children}

      {connected && sessionState !== 'idle' && showSessionModal && !showUsernameModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-session-title"
            aria-describedby="wallet-session-description"
            ref={sessionDialogRef}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && sessionState === 'failed') {
                setShowSessionModal(false);
                return;
              }
              if (event.key !== 'Tab') return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
              );
              if (!buttons.length) {
                event.preventDefault();
                return;
              }
              const first = buttons[0];
              const last = buttons[buttons.length - 1];
              if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
                event.preventDefault();
                first.focus();
              }
            }}
            className="relative my-auto w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl sm:p-8"
          >
            {sessionState === 'failed' && (
              <button
                type="button"
                onClick={() => setShowSessionModal(false)}
                aria-label="Close wallet authorization"
                className="absolute right-4 top-4 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            )}

            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-brand-red/30 bg-brand-red/10">
              {sessionState === 'authorizing'
                ? <ArrowPathIcon className="h-6 w-6 animate-spin text-brand-red" />
                : <ShieldCheckIcon className="h-6 w-6 text-brand-red" />
              }
            </div>
            <h2 id="wallet-session-title" className="text-xl font-bold text-white">
              {sessionState === 'authorizing' ? 'Authorize Shelbyflix' : 'Wallet authorization needed'}
            </h2>
            <p id="wallet-session-description" className="mt-3 text-sm leading-6 text-zinc-300">
              Approve the wallet signature to sign in — it unlocks comments, likes,
              subscriptions, and protected videos for 24 hours. It is not a
              blockchain transaction and will not transfer tokens.
            </p>

            {sessionState === 'authorizing' ? (
              <p role="status" aria-live="polite" className="mt-6 flex items-center gap-2 text-sm text-zinc-300">
                <ArrowPathIcon className="h-4 w-4 animate-spin text-brand-red" />
                Waiting for your wallet…
              </p>
            ) : (
              <>
                <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm leading-5 text-red-200">
                  {sessionError || 'Authorization was not completed.'}
                </p>
                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setShowSessionModal(false)}
                    className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    onClick={() => void authorize()}
                    className="rounded-xl bg-brand-red px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Try again
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {showUsernameModal && address && (
        <UsernameModal
          walletAddress={address.toString()}
          onComplete={handleUsernameComplete}
        />
      )}
    </>
  );
}
