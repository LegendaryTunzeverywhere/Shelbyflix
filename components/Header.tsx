'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';
import { UserCircleIcon } from '@heroicons/react/24/outline';
import useShelbyAccess from '@/hooks/useShelbyAccess';
import { useWallet } from '@/hooks/useWallet';
import { PlayCircleIcon } from '@heroicons/react/24/solid';

const Header: React.FC = () => {
  const pathname = usePathname();
  const { hasAccess } = useShelbyAccess();
  const { address, connected, user } = useWallet();

  const navLinks = [
    { href: '/', label: 'Home' },
  ];

  return (
    <header className="bg-brand-dark/80 backdrop-blur-md border-b border-zinc-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20 gap-2">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 sm:gap-3 hover:opacity-90 transition-all group flex-shrink-0">
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-brand-purple to-brand-red rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
              <div className="relative bg-gradient-to-br from-brand-red to-brand-purple rounded-full p-2 sm:p-2.5 flex items-center justify-center shadow-lg">
                <PlayCircleIcon className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
              </div>
            </div>
            <div>
              <h1 className="font-black text-lg sm:text-2xl tracking-tighter text-white">
                SHELBY<span className="text-brand-red">FLIX</span>
              </h1>
              <p className="hidden sm:block text-[10px] font-bold text-zinc-500 uppercase tracking-widest -mt-1">Premium Streaming</p>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-2 bg-zinc-950/50 p-1.5 rounded-2xl border border-zinc-800/50">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-6 py-2 rounded-xl font-bold text-sm transition-all
                  ${pathname === link.href
                    ? 'bg-zinc-800 text-white shadow-lg'
                    : 'text-zinc-500 hover:text-white hover:bg-zinc-900'
                  }`}
              >
                {link.label}
              </Link>
            ))}
            {hasAccess && (
              <>
                <Link
                  href="/gallery"
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all
                    ${pathname === '/gallery' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white hover:bg-zinc-900'}`}
                >
                  VIDEOS
                </Link>
                <Link
                  href="/shorts"
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all
                    ${pathname === '/shorts' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white hover:bg-zinc-900'}`}
                >
                  SHORTS
                </Link>
                <Link
                  href="/upload"
                  className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all
                    ${pathname === '/upload' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white hover:bg-zinc-900'}`}
                >
                  UPLOAD
                </Link>
                {connected && address && (
                  <Link
                    href={`/channel/${address.toString()}`}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all
                      ${pathname.startsWith('/channel') ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white hover:bg-zinc-900'}`}
                  >
                    <UserCircleIcon className="w-3.5 h-3.5" />
                    {user?.username ? user.username.slice(0, 12) : 'CHANNEL'}
                  </Link>
                )}
              </>
            )}
          </nav>

          {/* Wallet Connect — constrained on mobile so it doesn't overflow */}
          <div className="flex-shrink-0 max-w-[160px] sm:max-w-none">
            <WalletConnect />
          </div>
        </div>
      </div>

      {/* Mobile Navigation — horizontally scrollable, no wrapping/merging */}
      <div className="md:hidden border-t border-zinc-900 bg-zinc-950/60 backdrop-blur-md">
        <nav className="flex items-center gap-1 py-2 px-3 overflow-x-auto scrollbar-none">
          {[
            { href: '/', label: 'Home' },
            { href: '/gallery', label: 'Videos' },
            { href: '/shorts', label: 'Shorts' },
            { href: '/upload', label: 'Upload' },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap
                ${pathname === link.href
                  ? 'bg-zinc-800 text-brand-red'
                  : 'text-zinc-500 hover:text-white'
                }`}
            >
              {link.label}
            </Link>
          ))}
          {connected && address && (
            <Link
              href={`/channel/${address.toString()}`}
              className={`flex-shrink-0 flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap
                ${pathname.startsWith('/channel') ? 'bg-zinc-800 text-brand-red' : 'text-zinc-500 hover:text-white'}`}
            >
              <UserCircleIcon className="w-3 h-3" />
              {user?.username ? user.username.slice(0, 10) : 'Channel'}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Header;