'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import UsernameModal from '@/components/UsernameModal';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
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