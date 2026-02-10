'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import UploadForm from '@/components/UploadForm';
import { useWallet } from '@/hooks/useWallet';
import { useTokenAccess } from '@/hooks/useTokenAccess';
import { LockClosedIcon, ArrowRightIcon } from '@heroicons/react/24/outline';

export default function UploadPage() {
  const router = useRouter();
  const { connected } = useWallet();
  const { hasAccess, loading } = useTokenAccess();

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
              <p className="text-gray-600 mb-6">
                You need to hold Shelby Faucet tokens to upload videos.
              </p>
              <a
                href="https://aptoslabs.com/testnet-faucet"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 
                  hover:bg-primary-700 text-white rounded-lg font-medium 
                  transition-colors"
              >
                Get Test Tokens
                <ArrowRightIcon className="w-4 h-4" />
              </a>
              <p className="text-sm text-gray-500 mt-4">
                After getting tokens, refresh this page
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
