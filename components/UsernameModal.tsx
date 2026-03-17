'use client';

import { useState } from 'react';
import { createUser, isUsernameAvailable } from '@/lib/user-service';
import { XMarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

interface UsernameModalProps {
  walletAddress: string;
  onComplete: (username: string) => void;
}

export default function UsernameModal({ walletAddress, onComplete }: UsernameModalProps) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const validateUsername = (value: string): boolean => {
    // Only lowercase letters, numbers, underscore
    const regex = /^[a-z0-9_]{3,20}$/;
    return regex.test(value);
  };

    const handleUsernameChange = async (value: string) => {
    setUsername(value.toLowerCase());
    setError('');
    setAvailable(null);

    if (!value) return;

    if (!validateUsername(value)) {
        setError('Username must be 3-20 characters (letters, numbers, underscore only)');
        return;
    }

    setChecking(true);
    try {
        console.log('🔍 Checking username availability:', value);
        const isAvailable = await isUsernameAvailable(value);
        console.log('✅ Username availability result:', isAvailable);
        
        setAvailable(isAvailable);
        if (!isAvailable) {
        setError('Username already taken');
        }
    } catch (err) {
        console.error('❌ Error checking username:', err);
        setError('Failed to check username availability');
    } finally {
        setChecking(false);
    }
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !available) return;

    setCreating(true);
    setError('');

    try {
      await createUser(walletAddress, username, displayName || username);
      onComplete(username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-[32px] max-w-md w-full p-8 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-black text-white mb-2 tracking-tighter">
            WELCOME TO <span className="text-brand-red">SHELBYFLIX</span>
          </h2>
          <p className="text-zinc-400 font-medium">
            Choose your username to get started
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Username */}
          <div>
            <label className="block text-sm font-black text-zinc-300 mb-2 uppercase tracking-widest">
              Username *
            </label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                placeholder="your_username"
                maxLength={20}
                required
                className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:ring-2 focus:ring-brand-red focus:border-transparent font-medium"
              />
              {checking && (
                <div className="absolute right-3 top-3">
                  <div className="w-5 h-5 border-2 border-brand-red border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {available === true && !checking && (
                <div className="absolute right-3 top-3">
                  <CheckCircleIcon className="w-6 h-6 text-green-500" />
                </div>
              )}
              {available === false && !checking && (
                <div className="absolute right-3 top-3">
                  <XMarkIcon className="w-6 h-6 text-red-500" />
                </div>
              )}
            </div>
            {error && (
              <p className="text-xs text-red-400 mt-2 font-medium">{error}</p>
            )}
            {available === true && (
              <p className="text-xs text-green-400 mt-2 font-medium">✓ Username available!</p>
            )}
            <p className="text-xs text-zinc-500 mt-2">
              3-20 characters, lowercase letters, numbers, and underscores only
            </p>
          </div>

          {/* Display Name (Optional) */}
          <div>
            <label className="block text-sm font-black text-zinc-300 mb-2 uppercase tracking-widest">
              Display Name (Optional)
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How your name appears"
              maxLength={50}
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:ring-2 focus:ring-brand-red focus:border-transparent font-medium"
            />
          </div>

          {/* Wallet Display */}
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4">
            <p className="text-xs font-black text-zinc-500 mb-1 uppercase tracking-widest">
              Connected Wallet
            </p>
            <p className="text-sm text-white font-mono">
              {walletAddress.slice(0, 10)}...{walletAddress.slice(-8)}
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!username || !available || creating}
            className="w-full py-4 bg-brand-red hover:bg-brand-red/90 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-black rounded-xl transition-all uppercase tracking-widest text-sm"
          >
            {creating ? 'CREATING PROFILE...' : 'CREATE PROFILE'}
          </button>
        </form>

        {/* Info */}
        <p className="text-xs text-zinc-600 text-center mt-6">
          Your username cannot be changed later
        </p>
      </div>
    </div>
  );
}