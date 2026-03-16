'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';
import { FilmIcon } from '@heroicons/react/24/outline';

const Header: React.FC = () => {
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/gallery', label: 'Gallery' },
    { href: '/upload', label: 'Upload' },
  ];

  return (
    <header className="bg-brand-dark/80 backdrop-blur-md border-b border-zinc-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-all group">
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-brand-purple to-brand-red rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
              <div className="relative p-2.5 bg-zinc-900 rounded-xl border border-zinc-800 flex items-center justify-center">
                <FilmIcon className="w-7 h-7 text-brand-red" />
              </div>
            </div>
            <div className="hidden sm:block">
              <h1 className="font-black text-2xl tracking-tighter text-white">
                SHELBY<span className="text-brand-red">FLIX</span>
              </h1>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest -mt-1">Premium Streaming</p>
            </div>
          </Link>

          {/* Navigation */}
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
          </nav>

          {/* Wallet Connect */}
          <WalletConnect />
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t border-zinc-900 bg-zinc-950/50 backdrop-blur-md">
        <nav className="flex justify-around py-3">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all
                ${pathname === link.href 
                  ? 'text-brand-red' 
                  : 'text-zinc-600'
                }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
};

export default Header;
