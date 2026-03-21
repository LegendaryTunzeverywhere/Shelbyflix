'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { formatAddress } from '@/lib/aptos';
import { useShelbyAccess } from '@/hooks/useShelbyAccess';
import { initiateGoogleLogin, getUserInfo, logout as logoutGoogle, isLoggedIn } from '@/lib/keyless-auth';

import { 
  WalletIcon, 
  CheckCircleIcon,
  ArrowRightStartOnRectangleIcon,
  UserCircleIcon
} from '@heroicons/react/24/outline';

type AuthMethod = 'google' | 'wallet';

const UnifiedAuth: React.FC = () => {
  // Wallet state
  const { account, connected, disconnect, connect, wallets } = useWallet();
  const { hasAccess, balance, loading: balanceLoading } = useShelbyAccess();
  
  // Google/Keyless state
  const [googleUser, setGoogleUser] = useState<any>(null);
  
  // UI state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeMethod, setActiveMethod] = useState<AuthMethod | null>(null);
  
  const modalRef = useRef<HTMLDivElement>(null);

  // Check for Google login on mount
  useEffect(() => {
    const userInfo = getUserInfo();
    if (userInfo) {
      setGoogleUser(userInfo);
      setActiveMethod('google');
    }
  }, []);

  // Close modal on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setShowAuthModal(false);
      }
    }

    if (showAuthModal) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAuthModal]);

  // Close on ESC key
  useEffect(() => {
    function handleEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowAuthModal(false);
        setShowDropdown(false);
      }
    }

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  // Handle wallet connection
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

  // Handle Google login
  const handleGoogleLogin = () => {
    try {
      initiateGoogleLogin();
    } catch (error) {
      console.error('Google login failed:', error);
      alert('Failed to initiate Google login. Please check your configuration.');
    }
  };

  // Handle logout
  const handleLogout = () => {
    if (confirm('Are you sure you want to logout?')) {
      if (activeMethod === 'google') {
        logoutGoogle();
        setGoogleUser(null);
      } else if (activeMethod === 'wallet') {
        disconnect();
      }
      setActiveMethod(null);
      setShowDropdown(false);
      window.location.href = '/';
    }
  };

  // Determine if user is authenticated
  const isAuthenticated = (connected && account) || (googleUser && isLoggedIn());
  const userAddress = googleUser?.accountAddress || account?.address.toString();

  // NOT AUTHENTICATED - Show connect button
  if (!isAuthenticated) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowAuthModal(true)}
          className="px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-brand-purple via-brand-pink to-brand-red 
            hover:opacity-90 text-white rounded-xl font-bold transition-all shadow-lg 
            flex items-center gap-2 text-sm sm:text-base"
        >
          <WalletIcon className="w-4 h-4 sm:w-5 sm:h-5" />
          <span className="hidden sm:inline">Connect</span>
          <span className="sm:hidden">Sign In</span>
        </button>

        {/* AUTH MODAL */}
        {showAuthModal && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-in fade-in" />
            
            {/* Modal */}
            <div 
              ref={modalRef}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 
                w-[95%] max-w-md bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 
                z-[60] overflow-hidden animate-in zoom-in-95"
            >
              {/* Header */}
              <div className="p-6 border-b border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl sm:text-2xl font-black text-white">
                    Sign In to <span className="text-brand-red">ShelbyFlix</span>
                  </h3>
                  <button
                    onClick={() => setShowAuthModal(false)}
                    className="text-zinc-500 hover:text-white transition-colors p-1"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-sm text-zinc-400">
                  Choose your preferred sign-in method
                </p>
              </div>

              <div className="p-6 space-y-4">
                {/* GOOGLE SIGN-IN */}
                <button
                  onClick={handleGoogleLogin}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 
                    bg-white hover:bg-zinc-100 text-zinc-900 rounded-xl transition-all 
                    shadow-md hover:shadow-lg font-bold group"
                >
                  {/* Google logo */}
                  <svg className="w-6 h-6" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <span>Continue with Google</span>
                </button>

                {/* DIVIDER */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-zinc-800" />
                  <span className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Or</span>
                  <div className="flex-1 h-px bg-zinc-800" />
                </div>

                {/* WALLET OPTIONS */}
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-3">
                    Connect with Wallet
                  </p>
                  {wallets.length > 0 ? (
                    wallets.map((wallet: any) => (
                      <button
                        key={wallet.name}
                        onClick={() => handleWalletConnect(wallet)}
                        className="w-full px-4 py-3 text-left hover:bg-zinc-800 rounded-xl 
                          transition-all flex items-center justify-between group border border-transparent hover:border-zinc-700"
                      >
                        <div className="flex items-center gap-3">
                          {wallet.icon ? (
                            <img 
                              src={wallet.icon} 
                              alt={wallet.name} 
                              className="w-8 h-8 rounded-lg"
                            />
                          ) : (
                            <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center">
                              <WalletIcon className="w-5 h-5 text-zinc-400" />
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-white text-sm group-hover:text-brand-pink transition-colors">
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
                    <div className="text-center py-6 text-zinc-500">
                      <WalletIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No wallets detected</p>
                      <a 
                        href="https://petra.app/" 
                        target="_blank"
                        className="text-xs text-brand-pink hover:text-brand-red mt-2 inline-block"
                      >
                        Get Petra Wallet →
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 bg-zinc-950 border-t border-zinc-800">
                <p className="text-xs text-zinc-400 text-center">
                  New to blockchain?{' '}
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

  // AUTHENTICATED - Show user info
  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 sm:gap-3 px-3 py-2 sm:px-4 bg-zinc-900 border border-zinc-800 
          rounded-xl hover:bg-zinc-800 transition-all shadow-lg group"
      >
        {/* User avatar/icon */}
        <div className="flex-shrink-0">
          {googleUser?.picture ? (
            <img 
              src={googleUser.picture} 
              alt={googleUser.name || googleUser.email}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-zinc-700 group-hover:border-brand-pink transition-colors"
            />
          ) : (
            <div className="p-1.5 bg-zinc-800 rounded-lg group-hover:bg-brand-purple/20 transition-colors">
              <WalletIcon className="w-4 h-4 text-brand-pink" />
            </div>
          )}
        </div>

        {/* User info */}
        <div className="hidden sm:flex flex-col items-start min-w-0">
          <span className="text-xs font-bold text-white truncate max-w-[120px]">
            {googleUser?.name?.split(' ')[0] || formatAddress(userAddress)}
          </span>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
            {activeMethod === 'google' ? 'Google' : balanceLoading ? 'Loading...' : `${balance} SUSD`}
          </span>
        </div>

        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          googleUser || hasAccess ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-brand-red'
        }`} />
      </button>

      {/* DROPDOWN MENU */}
      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 mt-2 w-72 bg-zinc-900 rounded-2xl shadow-2xl 
            border border-zinc-800 z-50 overflow-hidden animate-in slide-in-from-top-2">
            
            {/* User info section */}
            <div className="p-5 border-b border-zinc-800 bg-zinc-950/50">
              {googleUser ? (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    {googleUser.picture && (
                      <img 
                        src={googleUser.picture} 
                        alt={googleUser.name}
                        className="w-12 h-12 rounded-full"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">
                        {googleUser.name || googleUser.email}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {googleUser.email}
                      </p>
                    </div>
                  </div>
                </>
              ) : null}
              
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-2">
                Blockchain Address
              </p>
              <p className="text-xs font-mono text-white break-all bg-black/30 p-2 rounded-lg border border-zinc-800">
                {userAddress}
              </p>
            </div>

            {/* Status section */}
            <div className="p-5 border-b border-zinc-800">
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3">
                Status
              </p>
              <div className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/10 rounded-lg">
                    <CheckCircleIcon className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-green-500">
                      {activeMethod === 'google' ? 'Google Account' : 'PRO Access'}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {activeMethod === 'google' ? 'Keyless Auth' : 'Wallet Connected'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Logout button */}
            <div className="p-2">
              <button
                onClick={handleLogout}
                className="w-full px-4 py-3 text-left text-sm font-bold text-zinc-400 
                  hover:text-white hover:bg-brand-red/10 rounded-xl transition-all 
                  flex items-center justify-between group"
              >
                <div className="flex items-center gap-2">
                  <ArrowRightStartOnRectangleIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  <span>Sign Out</span>
                </div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default UnifiedAuth;