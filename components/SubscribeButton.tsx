'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { 
  toggleSubscription, 
  isSubscribed, 
  getSubscriberCount 
} from '@/lib/engagement-store';
import { BellIcon, CheckIcon } from '@heroicons/react/24/outline';

interface SubscribeButtonProps {
  channelId: string;
}

export default function SubscribeButton({ channelId }: SubscribeButtonProps) {
  const { address } = useWallet();
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);

  useEffect(() => {
    loadSubscriptionStatus();
  }, [channelId, address]);

  const loadSubscriptionStatus = () => {
    if (address) {
      setSubscribed(isSubscribed(address, channelId));
    }
    setSubscriberCount(getSubscriberCount(channelId));
  };

  const handleToggle = () => {
    if (!address) return;
    
    const newStatus = toggleSubscription(address, channelId);
    setSubscribed(newStatus);
    loadSubscriptionStatus();
  };

  // Don't show if viewing own channel
  if (address?.toLowerCase() === channelId.toLowerCase()) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleToggle}
        disabled={!address}
        className={`flex items-center gap-2 px-8 py-3 rounded-full font-black text-sm transition-all ${
          subscribed
            ? 'bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700'
            : 'bg-brand-red text-white hover:bg-brand-red/90'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {subscribed ? (
          <>
            <CheckIcon className="w-5 h-5" />
            <span>SUBSCRIBED</span>
          </>
        ) : (
          <>
            <BellIcon className="w-5 h-5" />
            <span>SUBSCRIBE</span>
          </>
        )}
      </button>
      
      <span className="text-zinc-500 font-bold text-sm">
        {subscriberCount} {subscriberCount === 1 ? 'subscriber' : 'subscribers'}
      </span>
    </div>
  );
}