'use client';

import React from 'react';
import Link from 'next/link';
import { useState } from 'react';
import Header from '@/components/Header';
import { useTokenAccess } from '@/hooks/useTokenAccess';
import { useWallet } from '@/hooks/useWallet';
import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { registerShelbyUSD } from '@/lib/aptos';
import {
  LockClosedIcon,
  CloudIcon,
  BoltIcon,
  ShieldCheckIcon,
  ArrowRightIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

export default function Home() {
  const { connected } = useWallet();
  const { signAndSubmitTransaction } = useAptosWallet();
  const { hasAccess, isMissingStore, refetch } = useTokenAccess();
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

  const features = [
    {
      icon: LockClosedIcon,
      title: 'Token-Gated Access',
      description: 'Only users holding Shelby Faucet tokens can upload and watch videos.',
    },
    {
      icon: CloudIcon,
      title: 'Decentralized Storage',
      description: 'Videos are stored on Shelby protocol, ensuring permanence and censorship resistance.',
    },
    {
      icon: BoltIcon,
      title: 'Sub-second Streaming',
      description: 'Shelby provides lightning-fast video streaming with minimal buffering.',
    },
    {
      icon: ShieldCheckIcon,
      title: 'Blockchain Verified',
      description: 'All metadata is stored on Aptos blockchain for transparency and immutability.',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-primary-50">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="inline-block mb-6">
            <span className="px-4 py-2 bg-primary-100 text-primary-700 rounded-full 
              text-sm font-medium">
              Powered by Aptos & Shelby
            </span>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Decentralized Video
            <br />
            <span className="bg-gradient-to-r from-primary-600 to-purple-600 
              bg-clip-text text-transparent">
              Token-Gated Access
            </span>
          </h1>

          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Upload and share videos with exclusive access control. Only token holders can view your content.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            {connected ? (
              hasAccess ? (
                <>
                  <Link
                    href="/upload"
                    className="px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white 
                      rounded-lg font-semibold transition-colors shadow-lg hover:shadow-xl 
                      flex items-center gap-2"
                  >
                    Upload Video
                    <ArrowRightIcon className="w-5 h-5" />
                  </Link>
                  <Link
                    href="/gallery"
                    className="px-8 py-4 bg-white hover:bg-gray-50 text-gray-900 
                      border border-gray-300 rounded-lg font-semibold transition-colors"
                  >
                    Browse Gallery
                  </Link>
                </>
              ) : (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 max-w-md">
                  {isMissingStore ? (
                    <>
                      <p className="text-yellow-800 mb-4 font-medium">
                        ShelbyUSD not detected
                      </p>
                      <p className="text-sm text-yellow-700 mb-6">
                        You need to register the ShelbyUSD coin in your wallet before you can receive or hold it.
                      </p>
                      <button
                        onClick={handleRegister}
                        disabled={registering}
                        className="w-full flex items-center justify-center gap-2 px-6 py-3 
                          bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium 
                          transition-colors disabled:bg-gray-400 shadow-md"
                      >
                        {registering ? (
                          <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                        ) : (
                          <SparklesIcon className="w-5 h-5" />
                        )}
                        Register ShelbyUSD
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-yellow-800 mb-4">
                        You need Shelby Faucet tokens to access videos.
                      </p>
                      <a
                        href="https://docs.shelby.xyz/apis/faucet/shelbyusd"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white 
                          rounded-lg font-medium inline-flex items-center gap-2 shadow-md"
                      >
                        Get Test Tokens
                        <ArrowRightIcon className="w-4 h-4" />
                      </a>
                    </>
                  )}
                </div>
              )
            ) : (
              <div className="bg-primary-50 border border-primary-200 rounded-lg p-6">
                <p className="text-primary-800 mb-4 font-medium">
                  Connect your wallet to get started
                </p>
                <p className="text-sm text-primary-600">
                  Use the "Connect Wallet" button in the top right
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {features.map((feature, index) => (
            <div
              key={index}
              className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md 
                transition-shadow border border-gray-100"
            >
              <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center 
                justify-center mb-4">
                <feature.icon className="w-6 h-6 text-primary-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
              <p className="text-gray-600 text-sm">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* How It Works */}
        <div className="bg-white rounded-2xl shadow-lg p-8 md:p-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">
            How It Works
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-primary-600 text-white rounded-full 
                flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                1
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Connect Wallet</h3>
              <p className="text-gray-600 text-sm">
                Connect your Petra or Martian wallet with Shelby Faucet tokens
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-primary-600 text-white rounded-full 
                flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                2
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Upload Videos</h3>
              <p className="text-gray-600 text-sm">
                Upload your videos to decentralized Shelby storage
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-primary-600 text-white rounded-full 
                flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                3
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Share & Stream</h3>
              <p className="text-gray-600 text-sm">
                Token holders can stream videos with sub-second loading
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-12">
          {[
            { label: 'Decentralized', value: '100%' },
            { label: 'Load Time', value: '<1s' },
            { label: 'Security', value: 'On-chain' },
            { label: 'Network', value: 'Aptos' },
          ].map((stat, index) => (
            <div key={index} className="text-center">
              <p className="text-3xl font-bold text-primary-600 mb-1">{stat.value}</p>
              <p className="text-sm text-gray-600">{stat.label}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="bg-white border-t border-gray-200 py-8 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-600 text-sm">
          <p>Built on Aptos blockchain with Shelby decentralized storage</p>
          <p className="mt-2">
            <a href="https://aptoslabs.com" target="_blank" rel="noopener noreferrer" 
              className="text-primary-600 hover:underline">
              Learn more about Aptos
            </a>
            {' · '}
            <a href="https://shelby.xyz" target="_blank" rel="noopener noreferrer" 
              className="text-primary-600 hover:underline">
              Learn more about Shelby
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
