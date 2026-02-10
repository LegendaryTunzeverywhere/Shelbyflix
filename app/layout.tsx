import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AptosWalletProvider } from '@/components/AptosWalletProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Token-Gated Videos - Aptos & Shelby',
  description: 'Decentralized video platform with NFT/token-gated access on Aptos blockchain',
  keywords: ['Web3', 'Aptos', 'Shelby', 'NFT', 'Token-gated', 'Video', 'Decentralized'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AptosWalletProvider>
          {children}
        </AptosWalletProvider>
      </body>
    </html>
  );
}
