'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { formatAddress, sanitizeUrl } from '@/lib/utils';
import { useShelbyAccess } from '@/hooks/useShelbyAccess';
import {
  WalletIcon,
  CheckCircleIcon,
  ArrowRightStartOnRectangleIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import { getAptosClient } from '@/lib/keyless-auth';

type AuthMethod = 'google' | 'wallet';

// ── Logout confirmation modal ─────────────────────────────────────────────────
function LogoutModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl">
        <div className="w-16 h-16 bg-yellow-500/10 border border-yellow-500/20 rounded-full
          flex items-center justify-center mx-auto mb-4">
          <ExclamationTriangleIcon className="w-8 h-8 text-yellow-500" />
        </div>
        <h3 className="text-white font-black text-xl text-center mb-2">Sign Out?</h3>
        <p className="text-zinc-400 text-sm text-center mb-6">
          Are you sure you want to disconnect your wallet?
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-3 bg-brand-red hover:bg-brand-red/90 text-white rounded-xl font-bold transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const WalletConnect: React.FC = () => {
  const { account, connected, disconnect, connect, wallets } = useWallet();
  const { hasAccess, balance, loading: balanceLoading } = useShelbyAccess();

  const [googleUser, setGoogleUser] = useState<any>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [activeMethod, setActiveMethod] = useState<AuthMethod | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [balances, setBalances] = useState({ apt: 0, shelbyUsd: 0 });
  const [balancesLoading, setBalancesLoading] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Pre-compute authenticated state and address early
  const isAuthenticated = (connected && account) || googleUser;
  const userAddress = googleUser?.accountAddress || account?.address.toString();

  // Check for existing Google session
  useEffect(() => {
    try {
      import('@/lib/keyless-auth')
        .then(({ getUserInfo }) => {
          const userInfo = getUserInfo();
          if (userInfo) {
            setGoogleUser(userInfo);
            setActiveMethod('google');
          }
        })
        .catch(() => {});
    } catch {}
  }, []);

  // Fetch user balances when authenticated
  useEffect(() => {
    const fetchBalances = async () => {
      if (!userAddress) return;
      
      setBalancesLoading(true);
      try {
        const aptos = getAptosClient();
        
        // Fetch all coin balances
        const coins = await aptos.account.getAccountCoinsData({
          accountAddress: userAddress,
        });
        
        // Find APT and ShelbyUSD
        let aptBalance = 0;
        let shelbyUsdBalance = 0;
        
        coins.forEach((coin: any) => {
          if (coin.metadata?.asset_type?.includes('0x1::aptos_coin::AptosCoin')) {
            aptBalance = parseFloat(coin.amount || '0') / 100000000;
          }
          
          const shelbyUsdToken = process.env.NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS;
          if (shelbyUsdToken && coin.metadata?.asset_type?.includes(shelbyUsdToken)) {
            shelbyUsdBalance = parseFloat(coin.amount || '0') / 100000000;
          }
        });

        setBalances({ apt: aptBalance, shelbyUsd: shelbyUsdBalance });
      } catch (error) {
        console.error('Failed to fetch balances:', error);
      } finally {
        setBalancesLoading(false);
      }
    };

    if (showDropdown) {
      fetchBalances();
    }
  }, [showDropdown, userAddress]);

  // Close modal on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        modalRef.current &&
        !modalRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowAuthModal(false);
      }
    }
    if (showAuthModal) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAuthModal]);

  // ESC key closes everything
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setShowAuthModal(false);
        setShowDropdown(false);
        setShowLogoutModal(false);
      }
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  const handleWalletConnect = async (wallet: any) => {
    try {
      if (wallet.readyState === 'NotDetected') {
        window.open(wallet.url, '_blank');
        return;
      }
      await connect(wallet.name);
      setActiveMethod('wallet');
      setShowAuthModal(false);
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      alert(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const { initiateGoogleLogin } = await import('@/lib/keyless-auth');
      initiateGoogleLogin();
    } catch {
      alert('Google Sign-In is not fully configured yet. Please use a wallet to connect.');
    }
  };

  const handleLogoutClick = () => {
    setShowDropdown(false);
    setShowLogoutModal(true);
  };

  const confirmLogout = async () => {
    if (activeMethod === 'google') {
      try {
        const { logout: logoutGoogle } = await import('@/lib/keyless-auth');
        logoutGoogle();
        setGoogleUser(null);
      } catch {}
    } else {
      disconnect();
    }
    setActiveMethod(null);
    setShowLogoutModal(false);
    window.location.href = '/';
  };

  const handleCopyAddress = async () => {
    if (userAddress) {
      try {
        await navigator.clipboard.writeText(userAddress);
        setIsCopied(true);
        console.log('Wallet address copied:', userAddress); // Logging for validation
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy wallet address:', err);
        alert('Failed to copy address.');
      }
    }
  };

  // ── NOT AUTHENTICATED ───────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="relative">
        {/* Connect button */}
        <button
          ref={buttonRef}
          onClick={() => setShowAuthModal(v => !v)}
          className="px-4 py-2 bg-gradient-to-r from-brand-purple via-brand-pink to-brand-red
            hover:opacity-90 text-white rounded-lg font-bold transition-all shadow-lg
            flex items-center gap-2 whitespace-nowrap"
        >
          <WalletIcon className="w-5 h-5 flex-shrink-0" />
          <span>Connect Wallet</span>
        </button>

        {/* Auth modal — anchored below button, right-aligned */}
        {showAuthModal && (
          <>
            {/* Full-screen backdrop */}
            <div
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowAuthModal(false)}
            />

            {/* Dropdown panel */}
            <div
              ref={modalRef}
              className="absolute right-0 top-[calc(100%+8px)] z-[60]
                w-80 max-h-[80vh]
                bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl
                flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-shrink-0">
                <h3 className="text-base font-black text-white">Sign In</h3>
                <button
                  onClick={() => setShowAuthModal(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-full
                    bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  <XMarkIcon className="w-4 h-4 text-zinc-400" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">

                {/* Google — always shown regardless of wallet availability */}
                <button
                  onClick={handleGoogleLogin}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3
                    bg-white hover:bg-zinc-100 text-zinc-900 rounded-xl
                    transition-all shadow-sm font-bold text-sm"
                >
                  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <span>Continue with Google</span>
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-zinc-800" />
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Or</span>
                  <div className="flex-1 h-px bg-zinc-800" />
                </div>

                {/* Wallet list */}
                <div className="space-y-1.5">
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider px-1">
                    Connect Wallet
                  </p>

                  {wallets.length > 0 ? (
                    wallets.map((wallet: any) => (
                      <button
                        key={wallet.name}
                        onClick={() => handleWalletConnect(wallet)}
                        className="w-full px-3 py-2.5 text-left hover:bg-zinc-800 rounded-xl
                          transition-all flex items-center gap-3 group"
                      >
                        {wallet.icon ? (
                          <img
                            src={sanitizeUrl(wallet.icon)}
                            alt={wallet.name}
                            className="w-9 h-9 rounded-xl flex-shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 bg-zinc-800 rounded-xl flex items-center justify-center flex-shrink-0">
                            <WalletIcon className="w-5 h-5 text-zinc-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-white text-sm group-hover:text-brand-pink transition-colors truncate">
                            {wallet.name}
                          </p>
                          <p className="text-[10px] text-zinc-500">
                            {wallet.readyState === 'Installed' ? '● Ready' : '○ Not Installed'}
                          </p>
                        </div>
                        <div className="w-2 h-2 rounded-full flex-shrink-0 transition-colors
                          bg-zinc-700 group-hover:bg-brand-red" />
                      </button>
                    ))
                  ) : (
                    <div className="text-center py-5 bg-zinc-950 rounded-xl border border-zinc-800">
                      <WalletIcon className="w-8 h-8 mx-auto mb-2 text-zinc-700" />
                      <p className="text-xs font-bold text-zinc-500 mb-1">No Wallets Found</p>
                      <p className="text-[10px] text-zinc-600 mb-3 px-4">
                        Install a wallet extension or use Google Sign-In above.
                      </p>
                      <a
                        href="https://petra.app/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-pink hover:text-brand-red font-bold"
                      >
                        Get Petra Wallet →
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 px-5 py-3 bg-zinc-950 border-t border-zinc-800">
                <p className="text-[10px] text-zinc-500 text-center">
                  New to Web3?{' '}
                  <a
                    href="https://aptos.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-pink hover:text-brand-red font-bold"
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

  // ── AUTHENTICATED ───────────────────────────────────────────────────────────
  return (
    <>
      <div className="relative">
        <button
          onClick={() => setShowDropdown(v => !v)}
          className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border border-zinc-800
            rounded-xl hover:bg-zinc-800 transition-all shadow-lg group"
        >
          {googleUser?.picture ? (
            <img
              src={googleUser.picture}
              alt={googleUser.name || googleUser.email}
              className="w-8 h-8 rounded-full border-2 border-zinc-700 group-hover:border-brand-pink transition-colors flex-shrink-0"
            />
          ) : (
            <div className="p-1.5 bg-zinc-800 rounded-lg group-hover:bg-brand-purple/20 transition-colors flex-shrink-0">
              <WalletIcon className="w-4 h-4 text-brand-pink" />
            </div>
          )}
          <div className="flex flex-col items-start min-w-0">
            <span className="text-xs font-bold text-white truncate max-w-[120px]">
              {googleUser?.name?.split(' ')[0] || formatAddress(userAddress)}
            </span>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
              {activeMethod === 'google' ? 'Google' : balanceLoading ? 'Loading...' : `${balance} SUSD`}
            </span>
          </div>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
            googleUser || hasAccess
              ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
              : 'bg-brand-red'
          }`} />
        </button>

        {/* Dropdown */}
        {showDropdown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
            <div className="absolute right-0 mt-2 w-72 bg-zinc-900 rounded-2xl shadow-2xl
              border border-zinc-800 z-50 overflow-hidden">

              <div className="p-5 border-b border-zinc-800 bg-zinc-950/50">
                {googleUser && (
                  <div className="flex items-center gap-3 mb-3">
                    {googleUser.picture && (
                      <img src={googleUser.picture} alt={googleUser.name} className="w-12 h-12 rounded-full" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{googleUser.name || googleUser.email}</p>
                      <p className="text-xs text-zinc-500 truncate">{googleUser.email}</p>
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-2">
                  Blockchain Address
                </p>
                <div className="flex items-center gap-2 bg-black/30 p-2 rounded-lg border border-zinc-800">
                  <p className="text-xs font-mono text-white break-all flex-1">
                    {userAddress}
                  </p>
                  <button
                    onClick={handleCopyAddress}
                    className="flex-shrink-0 p-1.5 rounded-md bg-zinc-700 hover:bg-zinc-600 transition-colors"
                    title="Copy address"
                  >
                    {isCopied ? (
                      <CheckCircleIcon className="w-4 h-4 text-green-500" />
                    ) : (
                      <DocumentDuplicateIcon className="w-4 h-4 text-zinc-400" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-5 border-b border-zinc-800">
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3">Token Balances</p>
                <div className="space-y-2">
                  {/* APT Balance */}
                  <div className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-black rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-white">
                        Ⓐ
                      </div>
                      <span className="text-sm font-bold text-white">APT</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-white">
                        {balancesLoading ? '...' : `${balances.apt.toFixed(4)}`}
                      </p>
                      {balances.apt < 0.01 && !balancesLoading && (
                        <p className="text-[10px] text-brand-red font-bold">⚠️ Low balance</p>
                      )}
                    </div>
                  </div>

                  {/* ShelbyUSD Balance */}
                  <div className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-brand-purple/20 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-brand-purple">
                        $
                      </div>
                      <span className="text-sm font-bold text-white">ShelbyUSD</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-white">
                        {balancesLoading ? '...' : `${balances.shelbyUsd.toFixed(4)}`}
                      </p>
                      {balances.shelbyUsd < 0.1 && !balancesLoading && (
                        <p className="text-[10px] text-brand-red font-bold">⚠️ No funds</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Fee Warning */}
                {(balances.apt < 0.01 || balances.shelbyUsd < 0.1) && !balancesLoading && (
                  <div className="mt-3 p-3 bg-brand-red/10 border border-brand-red/20 rounded-lg flex gap-2">
                    <ExclamationTriangleIcon className="w-4 h-4 text-brand-red flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-brand-red mb-1">Insufficient Funds</p>
                      <p className="text-[10px] text-zinc-400">
                        You need APT for gas fees and ShelbyUSD to register blobs for uploads.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-5 border-b border-zinc-800">
                <div className="p-2">
                  <button
                    onClick={handleLogoutClick}
                    className="w-full px-4 py-3 text-left text-sm font-bold text-zinc-400
                      hover:text-white hover:bg-brand-red/10 rounded-xl transition-all
                      flex items-center gap-2 group"
                  >
                    <ArrowRightStartOnRectangleIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {showLogoutModal && (
        <LogoutModal onConfirm={confirmLogout} onCancel={() => setShowLogoutModal(false)} />
      )}
    </>
  );
};

export default WalletConnect;