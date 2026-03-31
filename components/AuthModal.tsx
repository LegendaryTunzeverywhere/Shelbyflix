'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { initiateGoogleLogin } from '@/lib/keyless-auth';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { wallets, connect, connected } = useWallet();
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);

  // Close modal when connected
  useEffect(() => {
    if (connected && onClose) {
      onClose();
    }
  }, [connected, onClose]);

  const handleGoogleLogin = async () => {
    try {
      setGoogleLoading(true);
      initiateGoogleLogin();
    } catch (error) {
      console.error('Google login failed:', error);
      setGoogleLoading(false);
    }
  };

  const handleWalletConnect = (walletName: string) => {
    try {
      setWalletLoading(true);
      setSelectedWallet(walletName);
      connect(walletName);
    } catch (error) {
      console.error('Wallet connection failed:', error);
      setWalletLoading(false);
      setSelectedWallet(null);
    }
  };

  const availableWallets = wallets.filter(
    (w) => w.readyState === 'Installed'
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="border-b border-zinc-800 p-6">
          <h2 className="text-2xl font-black text-white">
            SHELBY<span className="text-brand-red">FLIX</span>
          </h2>
          <p className="text-sm text-zinc-400 mt-2">Choose how to sign in</p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Google Login */}
          <button
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 disabled:from-gray-500 disabled:to-gray-600 text-white font-semibold py-3 px-4 rounded-xl transition flex items-center justify-center gap-3 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <>
                <span className="animate-spin">⏳</span>
                <span>Redirecting to Google...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-zinc-900 text-zinc-500">or</span>
            </div>
          </div>

          {/* Wallet Selection */}
          {availableWallets.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Connected Wallets
              </p>
              {availableWallets.map((wallet) => (
                <button
                  key={wallet.name}
                  onClick={() => handleWalletConnect(wallet.name)}
                  disabled={walletLoading && selectedWallet === wallet.name}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-700 text-white font-semibold py-3 px-4 rounded-xl transition flex items-center justify-between disabled:cursor-not-allowed"
                >
                  <span>{wallet.name}</span>
                  {walletLoading && selectedWallet === wallet.name && (
                    <span className="animate-spin">⏳</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4 text-center">
              <p className="text-sm text-zinc-400">
                No wallet extensions detected. Install{' '}
                <a
                  href="https://www.petra.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 font-semibold"
                >
                  Petra
                </a>
                {' '}or{' '}
                <a
                  href="https://nightly.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 font-semibold"
                >
                  Nightly
                </a>
                {' '}to connect.
              </p>
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
