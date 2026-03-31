'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { finalizeGoogleLogin } from '@/lib/keyless-auth';
import { supabase } from '@/lib/supabase';
import { aptos } from '@/lib/aptos'; // Import aptos client
import UsernameModal from '@/components/UsernameModal';

interface UserInfo {
  email: string;
  name?: string;
  picture?: string;
  sub: string;
  accountAddress: string;
}

export default function CallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState('Processing login...');
  const [error, setError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [showUsernameModal, setShowUsernameModal] = useState(false);

  useEffect(() => {
    handleCallback();
  }, []);

  async function handleCallback() {
    try {
      setStatus('Verifying with Google...');
      
      // 1. Finalize Google OAuth and get Aptos account
      const info = await finalizeGoogleLogin();
      console.log('Derived Aptos Account Address:', info.accountAddress);
      setUserInfo(info);

      // Check if Aptos account exists on chain
      try {
        await aptos.account.getAccountInfo({ accountAddress: info.accountAddress });
        console.log('✅ Aptos account exists on chain:', info.accountAddress);
      } catch (aptosError: any) {
        console.warn('⚠️ Aptos account does NOT exist on chain. This account needs to be funded:', info.accountAddress);
      }
      
      setStatus('Checking your profile...');
      
      // 2. Check if user exists in database
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('wallet_address', info.accountAddress.toLowerCase())
        .maybeSingle();
      
      if (existingUser) {
        console.log('✅ Existing user found');
        setStatus('Login successful! Redirecting...');
        setTimeout(() => {
          router.push('/');
        }, 1500);
      } else {
        // New user - show username creation modal
        console.log('⏳ New user - showing username selection');
        setStatus('Complete your profile');
        setShowUsernameModal(true);
      }
      
    } catch (err: any) {
      console.error('Callback error:', err);
      setError(err.message || 'Login failed. Please try again.');
      setStatus('Login failed');
    }
  }

  const handleUsernameComplete = async () => {
    setStatus('Profile created! Redirecting...');
    setTimeout(() => {
      router.push('/');
    }, 1000);
  };

  return (
    <>
      <div className="min-h-screen bg-brand-dark flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-zinc-900 rounded-2xl p-8 border border-zinc-800">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black text-white mb-2">
              SHELBY<span className="text-brand-red">FLIX</span>
            </h1>
            <p className="text-sm text-zinc-500">Completing your sign in...</p>
          </div>

          {/* Status */}
          <div className="space-y-6">
            {error ? (
              <>
                {/* Error state */}
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                  <p className="text-red-400 text-sm font-medium">{error}</p>
                </div>
                
                <button
                  onClick={() => router.push('/')}
                  className="w-full py-3 bg-brand-red text-white rounded-xl font-bold hover:bg-brand-red/90 transition-colors"
                >
                  Return to Home
                </button>
              </>
            ) : (
              <>
                {/* Loading state */}
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 border-4 border-zinc-700 border-t-brand-red rounded-full animate-spin" />
                  <p className="text-white font-medium">{status}</p>
                </div>
                
                {/* Progress steps */}
                <div className="space-y-2 text-sm text-zinc-500">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                    <span>Verified with Google</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${status.includes('profile') ? 'bg-green-500' : 'bg-zinc-700'}`} />
                    <span>Creating your profile</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${status.includes('successful') ? 'bg-green-500' : 'bg-zinc-700'}`} />
                    <span>Finalizing login</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Username Modal for new users */}
      {showUsernameModal && userInfo && (
        <UsernameModal
          walletAddress={userInfo.accountAddress}
          googleName={userInfo.name}
          onComplete={handleUsernameComplete}
        />
      )}
    </>
  );
}
