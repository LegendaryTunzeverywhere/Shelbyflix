'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { wallets, connect, connected } = useWallet();
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Clear error when modal opens/closes
  useEffect(() => {
    if (!isOpen) setAuthError(null);
  }, [isOpen]);

  // Close modal when connected
  useEffect(() => {
    if (connected && onClose) {
      onClose();
    }
  }, [connected, onClose]);

  const handleWalletConnect = async (walletName: string) => {
    try {
      setAuthError(null);
      setWalletLoading(true);
      setSelectedWallet(walletName);
      await connect(walletName);
    } catch (err) {
      console.error('Wallet connection failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      // User-rejection produces a cleaner message
      const friendly = /reject|denied|cancel/i.test(msg)
        ? 'Connection request was cancelled.'
        : `Couldn't connect to ${walletName}: ${msg}`;
      setAuthError(friendly);
      setWalletLoading(false);
      setSelectedWallet(null);
    }
  };

  // Show all wallets — includes both installed extensions and AptosConnect (Petra Web) options
  // AptosConnect wallets provide Google/Apple social login automatically via the Wallet Adapter plugin
  const availableWallets = wallets;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="border-b border-zinc-800 p-6">
          <h2 className="text-2xl font-black text-white">
            SHELBY<span className="text-brand-red">FLIX</span>
          </h2>
          <p className="text-sm text-zinc-400 mt-2">Connect your wallet to sign in</p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Error banner */}
          {authError && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl"
            >
              <svg
                className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm text-red-300 flex-1">{authError}</p>
              <button
                onClick={() => setAuthError(null)}
                className="text-red-400 hover:text-red-300 text-xs font-bold"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}

          {/* Wallet Selection — includes Petra extension + AptosConnect (Google/Apple social login) */}
          {availableWallets.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Choose a connection method
              </p>
              {availableWallets.map((wallet) => (
                <button
                  key={wallet.name}
                  onClick={() => handleWalletConnect(wallet.name)}
                  disabled={walletLoading && selectedWallet === wallet.name}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-700 text-white font-semibold py-3 px-4 rounded-xl transition flex items-center justify-between disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    {wallet.icon && (
                      <img
                        src={wallet.icon}
                        alt={`${wallet.name} icon`}
                        className="w-6 h-6 rounded"
                      />
                    )}
                    <span>{wallet.name}</span>
                  </div>
                  {walletLoading && selectedWallet === wallet.name && (
                    <span className="animate-spin">⏳</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4 text-center">
              <p className="text-sm text-zinc-400 mb-3">
                No wallet connection options available.
              </p>
              <a
                href="https://petra.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-semibold py-2 px-4 rounded-xl transition"
              >
                <span>Install Petra Wallet</span>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-4 text-center">
          <p className="text-xs text-zinc-500">
            Your wallet, your assets, your security
          </p>
        </div>
      </div>
    </div>
  );
}
