'use client';

import { useEffect, useState } from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AptosWalletProvider } from '@/components/AptosWalletProvider';
import { useWallet } from '@/hooks/useWallet';
import UsernameModal from '@/components/UsernameModal';

const inter = Inter({ subsets: ['latin'] });

// Move metadata to separate metadata.ts or remove from client component
// export const metadata: Metadata = { ... }

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { needsUsername, address, refreshUser } = useWallet();
  const [showUsernameModal, setShowUsernameModal] = useState(false);

  useEffect(() => {
    setShowUsernameModal(needsUsername);
  }, [needsUsername]);

  const handleUsernameComplete = async (username: string) => {
    setShowUsernameModal(false);
    await refreshUser();
  };

  return (
    <>
      {children}
      
      {/* Username Registration Modal */}
      {showUsernameModal && address && (
        <UsernameModal
          walletAddress={address.toString()}
          onComplete={handleUsernameComplete}
        />
      )}
    </>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <title>SHELBYFLIX - Aptos & Shelby</title>
        <meta name="description" content="Decentralized video platform with NFT/SHELBYFLIX on Aptos blockchain" />
        <meta name="keywords" content="Web3, Aptos, Shelby, NFT, Token-gated, Video, Decentralized" />
      </head>
      <body className={inter.className}>
        <AptosWalletProvider>
          <LayoutContent>{children}</LayoutContent>
        </AptosWalletProvider>
      </body>
    </html>
  );
}