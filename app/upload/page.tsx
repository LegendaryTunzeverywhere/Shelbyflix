'use client';

import React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import Header from '@/components/Header';
import UploadForm from '@/components/UploadForm';
import { SHELBY_FAUCET_URL, registerShelbyUSD } from '@/lib/aptos';
import { useTokenAccess } from '@/hooks/useTokenAccess';
import { LockClosedIcon, ArrowRightIcon, SparklesIcon } from '@heroicons/react/24/outline';

export default function UploadPage() {
  const router = useRouter();
  const { connected, signAndSubmitTransaction } = useWallet();
  const { hasAccess, loading, isMissingStore, refetch } = useTokenAccess();
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
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 
                border-primary-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Checking access...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-md mx-auto text-center">
            <div className="bg-white rounded-xl shadow-lg p-8">
              <LockClosedIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Wallet Not Connected
              </h2>
              <p className="text-gray-600 mb-6">
                Please connect your wallet to upload videos.
              </p>
              <p className="text-sm text-gray-500">
                Use the "Connect Wallet" button in the top right corner
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-md mx-auto text-center">
            <div className="bg-white rounded-xl shadow-lg p-8">
              <LockClosedIcon className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Access Denied
              </h2>
              
              {isMissingStore ? (
                <div className="mb-6">
                  <p className="text-gray-600 mb-6">
                    ShelbyUSD is not registered in your wallet. You must register the coin before you can receive or hold it.
                  </p>
                  <button
                    onClick={handleRegister}
                    disabled={registering}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 
                      bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium 
                      transition-colors disabled:bg-gray-400"
                  >
                    {registering ? (
                      <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                      <SparklesIcon className="w-5 h-5" />
                    )}
                    Register ShelbyUSD
                  </button>
                </div>
              ) : (
                <div className="mb-6">
                  <p className="text-gray-600 mb-6">
                    You need to hold Shelby Faucet tokens to upload videos.
                  </p>
                  <a
                    href={SHELBY_FAUCET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 
                      hover:bg-primary-700 text-white rounded-lg font-medium 
                      transition-colors"
                  >
                    Get Test Tokens
                    <ArrowRightIcon className="w-4 h-4" />
                  </a>
                </div>
              )}

              <p className="text-sm text-gray-500">
                After completing the action above, refresh this page.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <UploadForm
          onSuccess={() => {
            router.push('/gallery');
          }}
          onCancel={() => {
            router.push('/gallery');
          }}
        />
      </main>
    </div>
  );
}
