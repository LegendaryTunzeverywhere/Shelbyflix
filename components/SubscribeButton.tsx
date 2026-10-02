'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/hooks/useWallet';
import {
  toggleSubscription,
  isSubscribed,
} from '@/lib/engagement-store';
import { authorizeWalletSession } from '@/lib/wallet-interactions';
import { BellIcon, CheckIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

interface SubscribeButtonProps {
  channelId: string;
  compact?: boolean;
  onSubscribe?: () => void;
}

export default function SubscribeButton({ channelId, compact = false, onSubscribe }: SubscribeButtonProps) {
  const { address, account, signMessage } = useWallet();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionPending, setSessionPending] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!address) {
      setSubscribed(null);
      setStatusError(null);
      setStatusLoading(false);
      return () => { active = false; };
    }

    setStatusLoading(true);
    setStatusError(null);
    const refreshStatus = () => {
      setStatusLoading(true);
      setStatusError(null);
      isSubscribed(address.toString(), channelId)
        .then((value) => {
          if (active) setSubscribed(value);
        })
        .catch((error) => {
          console.error('Failed to load subscription status:', error);
          if (active) setStatusError('Could not verify subscription status.');
        })
        .finally(() => {
          if (active) setStatusLoading(false);
        });
    };

    refreshStatus();
    const onSessionAuthorizing = () => setSessionPending(true);
    const onSessionFinished = () => setSessionPending(false);
    window.addEventListener('wallet-session-authorizing', onSessionAuthorizing);
    window.addEventListener('wallet-session-established', onSessionFinished);
    window.addEventListener('wallet-session-established', refreshStatus);
    window.addEventListener('wallet-session-failed', onSessionFinished);
    return () => {
      active = false;
      window.removeEventListener('wallet-session-authorizing', onSessionAuthorizing);
      window.removeEventListener('wallet-session-established', onSessionFinished);
      window.removeEventListener('wallet-session-established', refreshStatus);
      window.removeEventListener('wallet-session-failed', onSessionFinished);
    };
  }, [channelId, address]);

  const handleSubscribe = async () => {
    if (!address || loading) return;

    setLoading(true);
    setActionError(null);
    try {
      const walletAddress = address.toString();
      if (subscribed === null) {
        await authorizeWalletSession(walletAddress, account?.publicKey, signMessage);
        const currentStatus = await isSubscribed(walletAddress, channelId);
        setSubscribed(currentStatus);
        return;
      }

      const result = await toggleSubscription(walletAddress, channelId, signMessage, account?.publicKey);
      setSubscribed(result);
      onSubscribe?.();
    } catch (error) {
      console.error('Failed to verify or update subscription:', error);
      setActionError('Could not verify or update subscription. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Don't show on own channel
  if (address?.toString().toLowerCase() === channelId.toLowerCase()) return null;

  if (compact) {
    return (
      <div>
        <button
          onClick={handleSubscribe}
          disabled={!address || loading || sessionPending || statusLoading || Boolean(statusError)}
          title={subscribed === null ? 'Authorize your wallet' : subscribed ? 'Unsubscribe' : 'Subscribe'}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-black text-xs tracking-widest transition-all
            ${subscribed === true
              ? 'bg-zinc-800 text-white border border-zinc-700 hover:bg-zinc-700'
              : subscribed === null
                ? 'bg-zinc-800 text-white border border-zinc-700 hover:bg-zinc-700'
                : 'bg-brand-red text-white hover:bg-brand-red/90'
            } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {sessionPending
            ? <span>AUTHORIZING…</span>
            : statusLoading
            ? <span>CHECKING…</span>
            : subscribed === null
              ? <><ShieldCheckIcon className="w-3.5 h-3.5" /><span>AUTHORIZE</span></>
              : subscribed
              ? <><CheckIcon className="w-3.5 h-3.5" /><span>SUBSCRIBED</span></>
              : <><BellIcon className="w-3.5 h-3.5" /><span>SUBSCRIBE</span></>
          }
        </button>
        {(statusError || actionError) && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {statusError || actionError}
            {statusError && (
              <button
                type="button"
                onClick={() => {
                  setStatusError(null);
                  setStatusLoading(true);
                  isSubscribed(address!.toString(), channelId)
                    .then(setSubscribed)
                    .catch((error) => {
                      console.error('Failed to retry subscription status:', error);
                      setStatusError('Could not verify subscription status.');
                    })
                    .finally(() => setStatusLoading(false));
                }}
                className="ml-1 underline underline-offset-2"
              >
                Retry
              </button>
            )}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={handleSubscribe}
        disabled={!address || loading || sessionPending || statusLoading || Boolean(statusError)}
        title={subscribed === null ? 'Authorize your wallet' : subscribed ? 'Unsubscribe' : 'Subscribe'}
        className={`flex items-center gap-2 px-8 py-3 rounded-full font-black text-sm transition-all
          ${subscribed === true
            ? 'bg-zinc-800 text-white border border-zinc-700 hover:bg-zinc-700'
            : subscribed === null
              ? 'bg-zinc-800 text-white border border-zinc-700 hover:bg-zinc-700'
              : 'bg-brand-red text-white hover:bg-brand-red/90'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {sessionPending
          ? <span>AUTHORIZING…</span>
          : statusLoading
          ? <span>CHECKING…</span>
          : subscribed === null
            ? <><ShieldCheckIcon className="w-5 h-5" /><span>AUTHORIZE</span></>
            : subscribed
            ? <><CheckIcon className="w-5 h-5" /><span>SUBSCRIBED</span></>
            : <><BellIcon className="w-5 h-5" /><span>SUBSCRIBE</span></>
        }
      </button>
      {(statusError || actionError) && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {statusError || actionError}
          {statusError && (
            <button
              type="button"
              onClick={() => {
                setStatusError(null);
                setStatusLoading(true);
                isSubscribed(address!.toString(), channelId)
                  .then(setSubscribed)
                  .catch((error) => {
                    console.error('Failed to retry subscription status:', error);
                    setStatusError('Could not verify subscription status.');
                  })
                  .finally(() => setStatusLoading(false));
              }}
              className="ml-1 underline underline-offset-2"
            >
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}