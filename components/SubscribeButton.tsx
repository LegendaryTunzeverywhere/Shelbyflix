'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/hooks/useWallet';
import {
  toggleSubscription,
  isSubscribed,
  getSubscriberCount,
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
  const [subscriberCount, setSubscriberCount] = useState(0);
  // Lock after first subscribe — cannot unsubscribe
  const [hasSubscribed, setHasSubscribed] = useState(false);

  useEffect(() => {
    if (address) {
      const alreadySubscribed = isSubscribed(address.toString(), channelId);
      setSubscribed(alreadySubscribed);
      setHasSubscribed(alreadySubscribed);
    }
    setSubscriberCount(getSubscriberCount(channelId));
  }, [channelId, address]);

  const handleSubscribe = () => {
    // Locked — already subscribed, do nothing
    if (!address || hasSubscribed) return;

    toggleSubscription(address.toString(), channelId);
    setSubscribed(true);
    setHasSubscribed(true);
    setSubscriberCount(c => c + 1);
    onSubscribe?.();
  };

  // Don't show on own channel
  if (address?.toString().toLowerCase() === channelId.toLowerCase()) return null;

  const formattedCount = subscriberCount >= 1_000_000
    ? `${(subscriberCount / 1_000_000).toFixed(1)}M`
    : subscriberCount >= 1_000
    ? `${(subscriberCount / 1_000).toFixed(1)}K`
    : subscriberCount.toString();

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubscribe}
          disabled={!address || hasSubscribed}
          title={hasSubscribed ? 'Already subscribed' : 'Subscribe'}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-black text-xs tracking-widest transition-all
            ${subscribed
              ? 'bg-zinc-800 text-white border border-zinc-700 cursor-default'
              : 'bg-brand-red text-white hover:bg-brand-red/90'
            } disabled:cursor-not-allowed`}
        >
          {subscribed
            ? <><CheckIcon className="w-3.5 h-3.5" /><span>SUBSCRIBED</span></>
            : <><BellIcon className="w-3.5 h-3.5" /><span>SUBSCRIBE</span></>
          }
        </button>
        <span className="text-zinc-500 text-xs font-bold whitespace-nowrap">{formattedCount}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSubscribe}
        disabled={!address || hasSubscribed}
        title={hasSubscribed ? 'Already subscribed' : 'Subscribe'}
        className={`flex items-center gap-2 px-8 py-3 rounded-full font-black text-sm transition-all
          ${subscribed
            ? 'bg-zinc-800 text-white border border-zinc-700 cursor-default'
            : 'bg-brand-red text-white hover:bg-brand-red/90'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {subscribed
          ? <><CheckIcon className="w-5 h-5" /><span>SUBSCRIBED</span></>
          : <><BellIcon className="w-5 h-5" /><span>SUBSCRIBE</span></>
        }
      </button>
      <span className="text-zinc-500 font-bold text-sm whitespace-nowrap">
        {formattedCount} {subscriberCount === 1 ? 'subscriber' : 'subscribers'}
      </span>
    </div>
  );
}