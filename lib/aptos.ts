import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

// Configure Aptos client based on environment
const network = (process.env.NEXT_PUBLIC_APTOS_NETWORK || 'testnet') as Network;

const config = new AptosConfig({ 
  network,
  fullnode: process.env.NEXT_PUBLIC_APTOS_NODE_URL 
});

export const aptos = new Aptos(config);

// Shelby Faucet Token Configuration
// This is the default Aptos Coin address - replace with actual Shelby Faucet Token when available
export const SHELBY_FAUCET_TOKEN = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || '0x1::aptos_coin::AptosCoin';

// Module address for the smart contract
export const MODULE_ADDRESS = process.env.NEXT_PUBLIC_MODULE_ADDRESS || '0x1';

/**
 * Check if a wallet address owns the required token
 * @param walletAddress - The Aptos wallet address to check
 * @param minBalance - Minimum token balance required (default: 1)
 * @returns Promise<boolean> - Whether the wallet has sufficient balance
 */
export async function checkTokenOwnership(
  walletAddress: string,
  minBalance: number = 1
): Promise<{ hasAccess: boolean; balance: string }> {
  try {
    // For Aptos Coin (or any fungible asset)
    const balance = await aptos.getAccountCoinAmount({
      accountAddress: walletAddress,
      coinType: SHELBY_FAUCET_TOKEN,
    });

    const balanceInTokens = Number(balance) / 100000000; // Convert from Octas to APT

    return {
      hasAccess: balanceInTokens >= minBalance,
      balance: balanceInTokens.toFixed(4),
    };
  } catch (error) {
    console.error('Error checking token ownership:', error);
    return {
      hasAccess: false,
      balance: '0',
    };
  }
}

/**
 * Get account resource data
 * @param accountAddress - The account address
 * @param resourceType - The resource type to fetch
 */
export async function getAccountResource<T>(
  accountAddress: string,
  resourceType: string
): Promise<T | null> {
  try {
    const resource = await aptos.getAccountResource({
      accountAddress,
      resourceType,
    });
    return resource.data as T;
  } catch (error) {
    console.error('Error fetching account resource:', error);
    return null;
  }
}

/**
 * Format Aptos address for display (truncated)
 * @param address - Full Aptos address
 * @returns Truncated address (e.g., "0x1234...5678")
 */
export function formatAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Validate Aptos address format
 * @param address - Address to validate
 * @returns boolean - Whether address is valid
 */
export function isValidAptosAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{1,64}$/.test(address);
}

/**
 * Convert string to hex bytes for Move
 * @param str - String to convert
 * @returns Hex bytes array
 */
export function stringToHexBytes(str: string): number[] {
  return Array.from(Buffer.from(str, 'utf-8'));
}

/**
 * Convert hex bytes to string
 * @param bytes - Hex bytes array
 * @returns Decoded string
 */
export function hexBytesToString(bytes: number[]): string {
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * Get transaction status
 * @param txnHash - Transaction hash
 */
export async function waitForTransaction(txnHash: string): Promise<boolean> {
  try {
    await aptos.waitForTransaction({
      transactionHash: txnHash,
    });
    return true;
  } catch (error) {
    console.error('Transaction failed:', error);
    return false;
  }
}

// Export network info for display
export const networkInfo = {
  name: network,
  explorerUrl: network === 'mainnet' 
    ? 'https://explorer.aptoslabs.com'
    : `https://explorer.aptoslabs.com/?network=${network}`,
};
