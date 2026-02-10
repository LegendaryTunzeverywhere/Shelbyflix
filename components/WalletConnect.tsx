'use client';

import React, { useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { WalletSelector } from '@aptos-labs/wallet-adapter-ant-design';
import { formatAddress } from '@/lib/aptos';
import { useTokenAccess } from '@/hooks/useTokenAccess';
import { 
  WalletIcon, 
  CheckCircleIcon, 
  XCircleIcon,
  ArrowRightOnRectangleIcon 
} from '@heroicons/react/24/outline';

const WalletConnect: React.FC = () => {
  const { account, connected, disconnect } = useWallet();
  const { hasAccess, balance, loading } = useTokenAccess();
  const [showDropdown, setShowDropdown] = useState(false);

  if (!connected || !account) {
    return (
      <div className="flex items-center gap-3">
        <WalletSelector />
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-3 px-4 py-2 bg-white border border-gray-200 
          rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
      >
        <WalletIcon className="w-5 h-5 text-gray-600" />
        <div className="flex flex-col items-start">
          <span className="text-sm font-medium text-gray-900">
            {formatAddress(account.address)}
          </span>
          <span className="text-xs text-gray-500">
            {loading ? 'Checking...' : `${balance} APT`}
          </span>
        </div>
        {hasAccess ? (
          <CheckCircleIcon className="w-5 h-5 text-green-500" />
        ) : (
          <XCircleIcon className="w-5 h-5 text-red-500" />
        )}
      </button>

      {showDropdown && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl 
            border border-gray-200 z-20 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <p className="text-xs text-gray-500 mb-1">Wallet Address</p>
              <p className="text-sm font-mono text-gray-900 break-all">
                {account.address}
              </p>
            </div>
            
            <div className="p-4 border-b border-gray-100">
              <p className="text-xs text-gray-500 mb-2">Access Status</p>
              <div className="flex items-center gap-2">
                {hasAccess ? (
                  <>
                    <CheckCircleIcon className="w-5 h-5 text-green-500" />
                    <span className="text-sm font-medium text-green-700">
                      Access Granted
                    </span>
                  </>
                ) : (
                  <>
                    <XCircleIcon className="w-5 h-5 text-red-500" />
                    <span className="text-sm font-medium text-red-700">
                      Token Required
                    </span>
                  </>
                )}
              </div>
              <p className="text-xs text-gray-600 mt-1">
                Balance: {balance} APT
              </p>
            </div>

            <button
              onClick={() => {
                disconnect();
                setShowDropdown(false);
              }}
              className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 
                hover:bg-red-50 transition-colors flex items-center gap-2"
            >
              <ArrowRightOnRectangleIcon className="w-5 h-5" />
              Disconnect Wallet
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default WalletConnect;
