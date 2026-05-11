import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWallet } from './useWallet';

// Mock the wallet adapter
const mockDisconnect = vi.fn();
const mockSignAndSubmitTransaction = vi.fn();
const mockSignMessage = vi.fn();

let mockWalletState = {
  account: null as any,
  connected: false,
  disconnect: mockDisconnect,
  signAndSubmitTransaction: mockSignAndSubmitTransaction,
  signMessage: mockSignMessage,
};

vi.mock('@aptos-labs/wallet-adapter-react', () => ({
  useWallet: () => mockWalletState,
}));

// Mock user-service to avoid real network calls
const mockGetUserByWallet = vi.fn().mockResolvedValue(null);
vi.mock('@/lib/user-service', () => ({
  getUserByWallet: (...args: any[]) => mockGetUserByWallet(...args),
}));

describe('useWallet hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWalletState = {
      account: null,
      connected: false,
      disconnect: mockDisconnect,
      signAndSubmitTransaction: mockSignAndSubmitTransaction,
      signMessage: mockSignMessage,
    };
  });

  describe('address (Requirement 3.1)', () => {
    it('returns undefined when wallet is not connected', async () => {
      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.address).toBeUndefined();
    });

    it('returns the Wallet Adapter account address when connected', async () => {
      const mockAddress = '0x1234abcd';
      mockWalletState.account = { address: mockAddress };
      mockWalletState.connected = true;

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.address).toBe(mockAddress);
    });

    it('derives address exclusively from Wallet Adapter account.address', async () => {
      const mockAddress = '0xdeadbeef1234567890';
      mockWalletState.account = { address: mockAddress, publicKey: '0xpubkey' };
      mockWalletState.connected = true;

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.address).toBe(mockAddress);
    });
  });

  describe('connected (Requirement 3.2)', () => {
    it('returns false when Wallet Adapter reports disconnected', async () => {
      mockWalletState.connected = false;

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.connected).toBe(false);
    });

    it('returns true when Wallet Adapter reports connected', async () => {
      mockWalletState.connected = true;
      mockWalletState.account = { address: '0xabc' };

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.connected).toBe(true);
    });

    it('reflects Wallet Adapter connected state directly', async () => {
      mockWalletState.connected = true;
      mockWalletState.account = { address: '0xabc' };

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.connected).toBe(mockWalletState.connected);
    });
  });

  describe('signAndSubmitTransaction (Requirement 3.3)', () => {
    it('delegates to Wallet Adapter signAndSubmitTransaction', async () => {
      const mockPayload = { data: { function: '0x1::coin::transfer', typeArguments: [], functionArguments: ['0xrecipient', 100] } };
      const mockResult = { hash: '0xtxhash' };
      mockSignAndSubmitTransaction.mockResolvedValue(mockResult);
      mockWalletState.connected = true;
      mockWalletState.account = { address: '0xabc' };

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const txResult = await result.current.signAndSubmitTransaction(mockPayload);
      expect(mockSignAndSubmitTransaction).toHaveBeenCalledWith(mockPayload);
      expect(txResult).toEqual(mockResult);
    });

    it('throws when wallet is not connected', async () => {
      mockWalletState.signAndSubmitTransaction = null as any;

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(result.current.signAndSubmitTransaction({ data: {} })).rejects.toThrow(
        'Wallet not connected.'
      );
    });
  });

  describe('signMessage (Requirement 3.4)', () => {
    it('delegates to Wallet Adapter signMessage', async () => {
      const mockArgs = { message: 'Hello', nonce: 'abc123' };
      const mockResult = { signature: '0xsig', fullMessage: 'Hello' };
      mockSignMessage.mockResolvedValue(mockResult);
      mockWalletState.connected = true;
      mockWalletState.account = { address: '0xabc' };

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const signResult = await result.current.signMessage(mockArgs);
      expect(mockSignMessage).toHaveBeenCalledWith(mockArgs);
      expect(signResult).toEqual(mockResult);
    });
  });

  describe('no Google-related properties (Requirement 3.6)', () => {
    it('does not expose googleUser property', async () => {
      mockWalletState.connected = true;
      mockWalletState.account = { address: '0xabc' };

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      const returnedKeys = Object.keys(result.current);

      expect(returnedKeys).not.toContain('googleUser');
    });

    it('does not expose isGoogleAuth property', async () => {
      mockWalletState.connected = true;
      mockWalletState.account = { address: '0xabc' };

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      const returnedKeys = Object.keys(result.current);

      expect(returnedKeys).not.toContain('isGoogleAuth');
    });

    it('does not expose googleAddress property', async () => {
      mockWalletState.connected = true;
      mockWalletState.account = { address: '0xabc' };

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      const returnedKeys = Object.keys(result.current);

      expect(returnedKeys).not.toContain('googleAddress');
    });

    it('only exposes expected wallet-adapter properties', async () => {
      mockWalletState.connected = true;
      mockWalletState.account = { address: '0xabc' };

      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      const returnedKeys = Object.keys(result.current);

      const expectedKeys = [
        'address',
        'connected',
        'disconnect',
        'signAndSubmitTransaction',
        'signMessage',
        'account',
        'user',
        'needsUsername',
        'loading',
        'refreshUser',
      ];

      expect(returnedKeys.sort()).toEqual(expectedKeys.sort());
    });
  });

  describe('disconnect', () => {
    it('exposes the Wallet Adapter disconnect function', async () => {
      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.disconnect).toBe(mockDisconnect);
    });
  });

  describe('user state management', () => {
    it('sets loading to false when wallet is not connected', async () => {
      mockWalletState.connected = false;

      const { result } = renderHook(() => useWallet());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('exposes refreshUser function', async () => {
      const { result } = renderHook(() => useWallet());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(typeof result.current.refreshUser).toBe('function');
    });
  });
});
