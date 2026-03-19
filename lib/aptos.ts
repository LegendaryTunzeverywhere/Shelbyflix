import { Aptos, AptosConfig, Network, InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';

// Shelbynet Network Details
export const SHELBYNET_CONFIG = {
  name: process.env.NEXT_PUBLIC_NETWORK_NAME || 'TESTNET',
  nodeUrl: process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL!,
  indexerUrl: process.env.NEXT_PUBLIC_SHELBYNET_INDEXER_URL!,
  faucetUrl: process.env.NEXT_PUBLIC_SHELBYNET_FAUCET_URL!,
};

// Configure Aptos client for Shelbynet
const config = new AptosConfig({
  network: Network.CUSTOM,
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
export const MODULE_ADDRESS = (process.env.NEXT_PUBLIC_MODULE_ADDRESS || '0x15ff27e78780a703a5e064ff087ac6078ed4889f6f25fa40f2f4d1e39f73ff25') as string;

// Network display information
export const NETWORK_NAME = 'TESTNET';
export const NETWORK_CHAIN = 'TESTNET';
export const SHELBY_FAUCET_URL = SHELBYNET_CONFIG.faucetUrl;
export const SHELBY_DOCS_URL = 'https://docs.shelby.xyz';

/**
 * Check if a wallet address owns the required ShelbyUSD tokens
 * DEPRECATED: Token requirement has been removed - this now always grants access
 * @param walletAddress - The Aptos wallet address to check
 * @param minBalance - Ignored (kept for backwards compatibility)
 * @returns Promise<boolean> - Always returns hasAccess: true
 */
export async function checkTokenOwnership(
  walletAddress: string,
  minBalance: number = parseFloat(process.env.NEXT_PUBLIC_MIN_TOKEN_BALANCE || '0.1')
): Promise<{ hasAccess: boolean; balance: string; isMissingStore?: boolean }> {
  try {
    console.log('✅ Platform access granted for:', walletAddress);
    
    // Token requirement has been removed - all users have access
    return {
      hasAccess: true,
      balance: '0',
      isMissingStore: false,
    };
  } catch (error: any) {
    console.error('Error:', error);
    // Default to granting access even on error
    return {
      hasAccess: true,
      balance: '0',
      isMissingStore: false,
    };
  }
}

/**
 * Register a coin for an account
 * @param signAndSubmitTransaction - Wallet adapter function
 */
export async function registerShelbyUSD(
  signAndSubmitTransaction: any
): Promise<string> {
  // NOTE: For Fungible Assets, manual registration is NOT typically required.
  // The store is created automatically when you receive tokens from a faucet.
  // We keep this function for backwards compatibility or for specific FA setups
  // that might use a "create_store" pattern.
  try {
    // Attempt to create a primary store if it doesn't exist (optional for most FAs)
    const payload: InputGenerateTransactionPayloadData = {
      function: '0x1::primary_fungible_store::ensure_primary_store_exists' as `${string}::${string}::${string}`,
      typeArguments: [],
      functionArguments: [SHELBYUSD_TOKEN],
    };

    const response = await signAndSubmitTransaction({
      data: payload,
    });

    await waitForTransaction(response.hash);
    return response.hash;
  } catch (error: any) {
    console.error('Failed to ensure ShelbyUSD store:', error);
    throw error;
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
    console.log('⏳ Transaction submitted:', txnHash);
    
    // Use the Aptos client to wait for transaction confirmation
    await aptos.waitForTransaction({ transactionHash: txnHash });
    
    console.log('✅ Transaction completed');
    return true;
  } catch (error) {
    console.error('Transaction error:', error);
    return false;
  }
}

// Export network info for display

/**
 * Get video metadata from the blockchain.
 * TODO: Implement actual logic to fetch video metadata from the Aptos smart contract.
 */
export async function getVideoMetadata(videoId: string): Promise<any> {
  console.warn(`[TODO] getVideoMetadata for videoId: ${videoId} is a placeholder.`);
  // Placeholder implementation - return dummy data or null
  return null; // Or throw an error if no data is expected without implementation
}

/**
 * Delete video metadata from the blockchain.
 * TODO: Implement actual logic to send a transaction to the Aptos smart contract to delete video metadata.
 */
export async function deleteVideoFromChain(
  address: string,
  signAndSubmitTransaction: any,
  videoId: string
): Promise<void> {
  console.warn(`[TODO] deleteVideoFromChain for videoId: ${videoId} and address: ${address} is a placeholder.`);
  // Placeholder implementation - simulate a successful transaction
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log(`[TODO] Simulated deletion of video ${videoId} from chain.`);
}

/**
 * Store video metadata on the blockchain.
 * TODO: Implement actual logic to send a transaction to the Aptos smart contract to store video metadata.
 */
export async function storeVideoMetadataOnChain(
  uploaderAddress: string,
  signAndSubmitTransaction: any,
  metadata: {
    videoId: string;
    title: string;
    description: string;
    shelbyUrl: string;
    uploader: string;
    requiredToken: string;
    price: number;
  }
): Promise<void> {
  console.warn(`[TODO] storeVideoMetadataOnChain for videoId: ${metadata.videoId} is a placeholder.`);
  // Placeholder implementation - simulate a successful transaction
  await new Promise(resolve => setTimeout(resolve, 1500));
  console.log(`[TODO] Simulated storing metadata for video ${metadata.videoId} on chain.`);
}

export const networkInfo = {
  name: NETWORK_NAME,
  chain: NETWORK_CHAIN,
  network: 'TESTNET',
  nodeUrl: SHELBYNET_CONFIG.nodeUrl,
  indexerUrl: SHELBYNET_CONFIG.indexerUrl,
  faucetUrl: SHELBYNET_CONFIG.faucetUrl,
  explorerUrl: 'https://explorer.aptoslabs.com',
  faucetDocs: 'https://docs.shelby.xyz/apis/faucet',
  shelbyDocs: SHELBY_DOCS_URL,
};
