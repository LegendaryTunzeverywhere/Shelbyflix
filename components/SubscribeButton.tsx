'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/hooks/useWallet';
import {
  toggleSubscription,
  isSubscribed,
} from '@/lib/engagement-store';
import { BellIcon, CheckIcon } from '@heroicons/react/24/outline';

interface SubscribeButtonProps {
  channelId: string;
  compact?: boolean;
  onSubscribe?: () => void;
}

export default function SubscribeButton({ channelId, compact = false, onSubscribe }: SubscribeButtonProps) {
  const { address } = useWallet();
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (address) {
      isSubscribed(address.toString(), channelId).then(setSubscribed);
    }
  }, [channelId, address]);

  const handleSubscribe = async () => {
    if (!address || loading) return;

    setLoading(true);
    try {
      const walletAddress = address.toString();
      const result = await toggleSubscription(walletAddress, channelId);
      setSubscribed(result);
      onSubscribe?.();
    } catch (error) {
      console.error('Failed to toggle subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  // Don't show on own channel
  if (address?.toString().toLowerCase() === channelId.toLowerCase()) return null;

  if (compact) {
    return (
      <button
        onClick={handleSubscribe}
        disabled={!address || loading}
        title={subscribed ? 'Unsubscribe' : 'Subscribe'}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-black text-xs tracking-widest transition-all
          ${subscribed
            ? 'bg-zinc-800 text-white border border-zinc-700 hover:bg-zinc-700'
            : 'bg-brand-red text-white hover:bg-brand-red/90'
          } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {subscribed
          ? <><CheckIcon className="w-3.5 h-3.5" /><span>SUBSCRIBED</span></>
          : <><BellIcon className="w-3.5 h-3.5" /><span>SUBSCRIBE</span></>
        }
      </button>
    );
  }

  return (
    <button
      onClick={handleSubscribe}
      disabled={!address || loading}
      title={subscribed ? 'Unsubscribe' : 'Subscribe'}
      className={`flex items-center gap-2 px-8 py-3 rounded-full font-black text-sm transition-all
        ${subscribed
          ? 'bg-zinc-800 text-white border border-zinc-700 hover:bg-zinc-700'
          : 'bg-brand-red text-white hover:bg-brand-red/90'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {subscribed
        ? <><CheckIcon className="w-5 h-5" /><span>SUBSCRIBED</span></>
        : <><BellIcon className="w-5 h-5" /><span>SUBSCRIBE</span></>
      }
    </button>
  );
}