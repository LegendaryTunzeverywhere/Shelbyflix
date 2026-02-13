import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

// ============================================================================
// SHELBYNET NETWORK CONFIGURATION
// ============================================================================
// Shelbynet is a custom Aptos network for Shelby Protocol
// Official Docs: https://docs.shelby.xyz

// Shelbynet Network Details
export const SHELBYNET_CONFIG = {
  name: process.env.NEXT_PUBLIC_NETWORK_NAME || 'shelbynet',
  nodeUrl: process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL || 'https://api.shelbynet.shelby.xyz/v1',
  indexerUrl: process.env.NEXT_PUBLIC_SHELBYNET_INDEXER_URL || 'https://api.shelbynet.shelby.xyz/v1/graphql',
  faucetUrl: process.env.NEXT_PUBLIC_SHELBYNET_FAUCET_URL || 'https://faucet.shelbynet.shelby.xyz',
};

// Configure Aptos client for Shelbynet
const config = new AptosConfig({
  fullnode: SHELBYNET_CONFIG.nodeUrl,
  indexer: SHELBYNET_CONFIG.indexerUrl,
  faucet: SHELBYNET_CONFIG.faucetUrl,
});

export const aptos = new Aptos(config);

// ============================================================================
// SHELBYUSD TOKEN CONFIGURATION
// ============================================================================
// ShelbyUSD is the native token for paying upload fees on Shelby network
// Token Type: 0xa8d56bad68eb3d9c54c5c96b91c7e7471fb4c80dafed03e458da0aca6ef0fb5b0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1
// Get test tokens from faucet: https://faucet.shelbynet.shelby.xyz

export const SHELBYUSD_TOKEN = (
  process.env.NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS
    ? `${process.env.NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS}`
    : '0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1'
) as `${string}::${string}::${string}`;

// Module address for the smart contract
export const MODULE_ADDRESS = (process.env.NEXT_PUBLIC_MODULE_ADDRESS || '0x1') as string;

// Network display information
export const NETWORK_NAME = 'Shelbynet';
export const NETWORK_CHAIN = 'Shelby Testnet';
export const SHELBY_FAUCET_URL = SHELBYNET_CONFIG.faucetUrl;
export const SHELBY_DOCS_URL = 'https://docs.shelby.xyz';

/**
 * Check if a wallet address owns the required ShelbyUSD tokens
 * ShelbyUSD tokens are used to pay upload fees on the Shelby network
 * @param walletAddress - The Aptos wallet address to check
 * @param minBalance - Minimum token balance required (default: 0.1 ShelbyUSD)
 * @returns Promise<boolean> - Whether the wallet has sufficient balance
 */
export async function checkTokenOwnership(
  walletAddress: string,
  minBalance: number = parseFloat(process.env.NEXT_PUBLIC_MIN_TOKEN_BALANCE || '0.1')
): Promise<{ hasAccess: boolean; balance: string }> {
  try {
    console.log('🔍 Checking ShelbyUSD balance for:', walletAddress);
    console.log('📍 Token address:', SHELBYUSD_TOKEN);

    // Check balance of ShelbyUSD tokens using the correct coin type
    const balance = await aptos.getAccountCoinAmount({
      accountAddress: walletAddress,
      coinType: SHELBYUSD_TOKEN,
    });

    console.log('💰 Raw balance:', balance);

    // ShelbyUSD has 8 decimals
    const balanceInTokens = Number(balance) / 100000000;

    console.log('✅ Balance in ShelbyUSD:', balanceInTokens.toFixed(8));
    console.log('🎯 Required minimum:', minBalance);

    return {
      hasAccess: balanceInTokens >= minBalance,
      balance: balanceInTokens.toFixed(8),
    };
  } catch (error) {
    console.error('❌ Error checking ShelbyUSD token ownership:', error);
    // If the account doesn't have the coin store, it means balance is 0
    return {
      hasAccess: false,
      balance: '0.00000000',
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
      resourceType: resourceType as `${string}::${string}::${string}`,
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
  name: NETWORK_NAME,
  chain: NETWORK_CHAIN,
  network: 'shelbynet',
  nodeUrl: SHELBYNET_CONFIG.nodeUrl,
  indexerUrl: SHELBYNET_CONFIG.indexerUrl,
  faucetUrl: SHELBYNET_CONFIG.faucetUrl,
  explorerUrl: 'https://explorer.aptoslabs.com',
  faucetDocs: 'https://docs.shelby.xyz/apis/faucet',
  shelbyDocs: SHELBY_DOCS_URL,
};
