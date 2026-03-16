'use client';

import React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Header from '@/components/Header';
import UploadForm from '@/components/UploadForm';
import { SHELBY_FAUCET_URL, registerShelbyUSD } from '@/lib/aptos';
 
import { LockClosedIcon, ArrowRightIcon, SparklesIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline';

export default function UploadPage() {
  const router = useRouter();
  const { connected, signAndSubmitTransaction } = useWallet();
  
  // Token access no longer required - fee-based viewing instead
  const hasAccess = true;
  const loading = false;
  const isMissingStore = false;
  const refetch = async () => {};

  const [registering, setRegistering] = useState(false);

  const handleRegister = async () => {
    try {
      setRegistering(true);
      await registerShelbyUSD(signAndSubmitTransaction);
      await refetch();
    } catch (error) {
      console.error('Registration failed:', error);
    } finally {
      setRegistering(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-dark">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="flex flex-col items-center justify-center h-64">
            <div className="relative">
              <div className="absolute inset-0 bg-brand-purple blur-xl opacity-20 animate-pulse"></div>
              <div className="relative animate-spin rounded-full h-16 w-16 border-t-2 border-brand-purple"></div>
            </div>
            <p className="text-zinc-500 mt-8 font-black uppercase tracking-widest text-sm">Validating Credentials</p>
          </div>
        </main>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="min-h-screen bg-brand-dark text-white">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="max-w-md mx-auto text-center">
            <div className="bg-zinc-900/50 backdrop-blur-xl rounded-[40px] border border-zinc-800 p-12">
              <div className="w-20 h-20 bg-zinc-950 rounded-[24px] border border-zinc-800 flex items-center justify-center mx-auto mb-8">
                <LockClosedIcon className="w-10 h-10 text-zinc-700" />
              </div>
              <h2 className="text-3xl font-black tracking-tighter mb-4">
                UPLOADER <span className="text-zinc-500">LOCKED</span>
              </h2>
              <p className="text-zinc-500 font-medium mb-10 leading-relaxed">
                Your wallet is currently offline. Connect to initialize the decentralized upload protocol.
              </p>
              <div className="inline-flex items-center gap-2 text-brand-pink font-bold text-[10px] uppercase tracking-widest bg-brand-pink/10 px-4 py-2 rounded-full border border-brand-pink/20">
                Connection Required
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-brand-dark text-white">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="max-w-md mx-auto text-center">
            <div className="bg-zinc-900/50 backdrop-blur-xl rounded-[40px] border border-zinc-800 p-12 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-purple to-brand-red opacity-50" />
              
              <div className="w-20 h-20 bg-brand-red/10 rounded-[24px] border border-brand-red/20 flex items-center justify-center mx-auto mb-8">
                <LockClosedIcon className="w-10 h-10 text-brand-red" />
              </div>
              <h2 className="text-3xl font-black tracking-tighter mb-4">
                ACCESS <span className="text-brand-red">DENIED</span>
              </h2>
              
              {isMissingStore ? (
                <div className="mb-10">
                  <p className="text-zinc-500 font-medium mb-10 leading-relaxed">
                    ShelbyUSD protocol is not registered. Initialize your wallet to enable decentralized storage operations.
                  </p>
                  <button
                    onClick={handleRegister}
                    disabled={registering}
                    className="w-full flex items-center justify-center gap-3 px-8 py-5 
                      bg-white text-black rounded-2xl font-black tracking-widest text-xs
                      transition-all disabled:opacity-50 hover:bg-zinc-200 shadow-[0_0_30px_rgba(255,255,255,0.1)]"
                  >
                    {registering ? (
                      <div className="animate-spin h-5 w-5 border-2 border-black border-t-transparent rounded-full" />
                    ) : (
                      <SparklesIcon className="w-5 h-5" />
                    )}
                    INITIALIZE SHELBYUSD
                  </button>
                </div>
              ) : (
                <div className="mb-10">
                  <p className="text-zinc-500 font-medium mb-10 leading-relaxed">
                    Insufficient fuel. Hold Shelby Faucet tokens to authorize new content deployments.
                  </p>
                  <a
                    href={SHELBY_FAUCET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-3 px-8 py-5 
                      bg-brand-red text-white rounded-2xl font-black tracking-widest text-xs
                      transition-all hover:bg-brand-red/90 shadow-[0_0_30px_rgba(246,27,46,0.2)]"
                  >
                    ACQUIRE TOKENS
                    <ArrowRightIcon className="w-4 h-4" />
                  </a>
                </div>
              )}

              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">
                System Status: Unauthorized
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-dark text-white">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-12 flex items-center gap-6">
          <div className="w-16 h-16 bg-zinc-900 rounded-[20px] border border-zinc-800 flex items-center justify-center">
            <CloudArrowUpIcon className="w-8 h-8 text-brand-red" />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tighter">DATA <span className="text-brand-red">INGESTION</span></h1>
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px] mt-1">New Content Deployment Protocol</p>
          </div>
        </div>
        
        <div className="bg-zinc-900/30 backdrop-blur-md rounded-[40px] border border-zinc-800 p-8 md:p-12 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-brand-purple/5 blur-[100px] pointer-events-none" />
          <UploadForm />
        </div>
      </main>
    </div>
  );
}
