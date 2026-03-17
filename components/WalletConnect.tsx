'use client';

import React, { useState } from 'react';
import { useWallet, groupAndSortWallets } from '@aptos-labs/wallet-adapter-react';
import { formatAddress } from '@/lib/aptos';
import { useShelbyAccess } from '@/hooks/useShelbyAccess';
 

import { 
  WalletIcon, 
  CheckCircleIcon, 
  XCircleIcon,
  ArrowRightStartOnRectangleIcon 
} from '@heroicons/react/24/outline';

const WalletConnect: React.FC = () => {
  const { account, connected, disconnect, connect, wallets } = useWallet();
  const { hasAccess, balance, loading } = useShelbyAccess();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);

  // Handle wallet connection
  const handleConnect = async (wallet: any) => {
    try {
      console.log('Attempting to connect to:', wallet.name);
      // Ensure we use the exact name expected by the adapter
      if (wallet.readyState === 'NotDetected') {
        window.open(wallet.url, '_blank');
        return;
      }
      await connect(wallet.name);
      setShowWalletSelector(false);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      alert(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // If not connected, show connect button
  if (!connected || !account) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowWalletSelector(!showWalletSelector)}
          className="px-4 py-2 bg-gradient-to-r from-brand-purple via-brand-pink to-brand-red 
            hover:opacity-90 text-white rounded-lg font-bold transition-all shadow-lg 
            flex items-center gap-2"
        >
          <WalletIcon className="w-5 h-5" />
          Connect Wallet
        </button>

        {showWalletSelector && (
          <>
            <div
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowWalletSelector(false)}
            />
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 
              w-full max-w-sm bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 
              z-[60] overflow-hidden animate-in">
              <div className="p-6 border-b border-zinc-800">
                <h3 className="text-xl font-bold text-white">Connect Wallet</h3>
                <p className="text-sm text-zinc-400 mt-1">
                  Select an Aptos wallet to continue
                </p>
              </div>
              
              <div className="p-4 space-y-2">
                {wallets.length > 0 ? (
                  wallets.map((wallet: any) => (
                    <button
                      key={wallet.name}
                      onClick={() => handleConnect(wallet)}
                      className="w-full px-4 py-4 text-left hover:bg-zinc-800 rounded-xl 
                        transition-all flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-4">
                        {wallet.icon ? (
                          <img 
                            src={wallet.icon} 
                            alt={wallet.name} 
                            className="w-10 h-10 rounded-lg"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                            <WalletIcon className="w-6 h-6 text-zinc-400" />
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-white group-hover:text-brand-pink transition-colors">
                            {wallet.name}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {wallet.readyState === 'Installed' ? 'Detected' : 'Not Installed'}
                          </p>
                        </div>
                      </div>
                      <div className="w-2 h-2 rounded-full bg-zinc-700 group-hover:bg-brand-red transition-colors" />
                    </button>
                  ))
                ) : (
                  <p className="text-center py-4 text-zinc-500">No wallets detected</p>
                )}
              </div>

              <div className="p-6 bg-zinc-950 border-t border-zinc-800">
                <p className="text-xs text-zinc-400 text-center">
                  New to Aptos?{' '}
                  <a
                    href="https://aptos.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-pink hover:text-brand-red font-bold transition-colors"
                  >
                    Learn More
                  </a>
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // If connected, show wallet info
  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border border-zinc-800 
          rounded-xl hover:bg-zinc-800 transition-all shadow-lg group"
      >
        <div className="p-1.5 bg-zinc-800 rounded-lg group-hover:bg-brand-purple/20 transition-colors">
          <WalletIcon className="w-4 h-4 text-brand-pink" />
        </div>
        <div className="flex flex-col items-start">
          <span className="text-xs font-bold text-white">
            {formatAddress(account.address.toString())}
          </span>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
            {loading ? 'Loading...' : `${balance} SUSD`}
          </span>
        </div>
        <div className={`w-2 h-2 rounded-full ${hasAccess ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-brand-red'}`} />
      </button>

      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 mt-2 w-72 bg-zinc-900 rounded-2xl shadow-2xl 
            border border-zinc-800 z-50 overflow-hidden animate-in">
            <div className="p-5 border-b border-zinc-800 bg-zinc-950/50">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-2">My Address</p>
              <p className="text-sm font-mono text-white break-all bg-black/30 p-2 rounded-lg border border-zinc-800">
                {account.address.toString()}
              </p>
            </div>
            
            <div className="p-5 border-b border-zinc-800">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3">Membership Status</p>
              <div className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/10 rounded-lg">
                    <CheckCircleIcon className="w-5 h-5 text-green-500" />
                  </div>
                  <span className="text-sm font-bold text-green-500">
                    PRO Access
                  </span>
                </div>
              </div>
            </div>

            <div className="p-2">
              <button
                onClick={() => {
                  disconnect();
                  setShowDropdown(false);
                }}
                className="w-full px-4 py-3 text-left text-sm font-bold text-zinc-400 
                  hover:text-white hover:bg-brand-red/10 rounded-xl transition-all 
                  flex items-center justify-between group"
              >
                <div className="flex items-center gap-2">
                  <ArrowRightStartOnRectangleIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  <span>Disconnect</span>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default WalletConnect;
