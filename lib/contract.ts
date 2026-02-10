import { aptos, MODULE_ADDRESS, stringToHexBytes, hexBytesToString, waitForTransaction } from './aptos';
import type { VideoMetadata } from '@/types';
import { InputGenerateTransactionPayloadData } from '@aptos-labs/ts-sdk';

/**
 * SMART CONTRACT INTERACTION LAYER
 * 
 * This module handles all interactions with the Move smart contract
 * for storing and retrieving video metadata on-chain.
 */

const MODULE_NAME = 'video_gallery';

/**
 * Upload video metadata to blockchain
 * 
 * @param signer - Wallet signer instance
 * @param metadata - Video metadata to store
 * @returns Transaction hash
 */
export async function storeVideoMetadataOnChain(
  walletAddress: string,
  signAndSubmitTransaction: any,
  metadata: Omit<VideoMetadata, 'timestamp'>
): Promise<string> {
  try {
    const payload: InputGenerateTransactionPayloadData = {
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::upload_video`,
      typeArguments: [],
      functionArguments: [
        stringToHexBytes(metadata.videoId),
        stringToHexBytes(metadata.title),
        stringToHexBytes(metadata.description),
        stringToHexBytes(metadata.shelbyUrl),
        metadata.requiredToken,
      ],
    };

    const response = await signAndSubmitTransaction({
      sender: walletAddress,
      data: payload,
    });

    // Wait for transaction confirmation
    const success = await waitForTransaction(response.hash);
    
    if (!success) {
      throw new Error('Transaction failed');
    }

    return response.hash;
  } catch (error) {
    console.error('Error storing metadata on-chain:', error);
    throw error;
  }
}

/**
 * Get all videos from blockchain
 * 
 * @returns Array of video metadata
 */
export async function getAllVideosFromChain(): Promise<VideoMetadata[]> {
  try {
    // TODO: Call view function to get all videos
    // This is a placeholder - actual implementation depends on Move contract structure
    
    /*
    const videos = await aptos.view({
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::get_all_videos`,
      typeArguments: [],
      functionArguments: [],
    });
    
    return videos.map(parseVideoMetadata);
    */

    // MOCK: Return sample videos for testing
    return getMockVideos();
  } catch (error) {
    console.error('Error fetching videos from chain:', error);
    return [];
  }
}

/**
 * Check if user can access a specific video
 * 
 * @param videoId - Video identifier
 * @param walletAddress - User's wallet address
 * @returns Whether user has access
 */
export async function checkVideoAccess(
  videoId: string,
  walletAddress: string
): Promise<boolean> {
  try {
    const result = await aptos.view({
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::can_access_video`,
      typeArguments: [],
      functionArguments: [walletAddress, stringToHexBytes(videoId)],
    });

    return result[0] as boolean;
  } catch (error) {
    console.error('Error checking video access:', error);
    return false;
  }
}

/**
 * Get video metadata by ID from blockchain
 * 
 * @param videoId - Video identifier
 * @returns Video metadata or null
 */
export async function getVideoMetadata(videoId: string): Promise<VideoMetadata | null> {
  try {
    // TODO: Implement view function call
    /*
    const metadata = await aptos.view({
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::get_video_metadata`,
      typeArguments: [],
      functionArguments: [stringToHexBytes(videoId)],
    });
    
    return parseVideoMetadata(metadata);
    */

    // MOCK: Return from mock data
    const videos = getMockVideos();
    return videos.find(v => v.videoId === videoId) || null;
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    return null;
  }
}

/**
 * Parse raw blockchain data into VideoMetadata
 */
function parseVideoMetadata(raw: any): VideoMetadata {
  return {
    videoId: hexBytesToString(raw.video_id),
    title: hexBytesToString(raw.title),
    description: hexBytesToString(raw.description),
    shelbyUrl: hexBytesToString(raw.shelby_url),
    uploader: raw.uploader,
    timestamp: raw.timestamp,
    requiredToken: raw.required_token,
  };
}

/**
 * MOCK DATA FOR TESTING
 * Remove this when smart contract is deployed
 */
function getMockVideos(): VideoMetadata[] {
  return [
    {
      videoId: 'video_1',
      title: 'Welcome to Token-Gated Videos',
      description: 'An introduction to decentralized video streaming on Aptos with Shelby storage.',
      shelbyUrl: 'shelby://video_1',
      thumbnailUrl: 'https://picsum.photos/seed/video1/640/360',
      uploader: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      timestamp: Date.now() - 86400000 * 2, // 2 days ago
      requiredToken: '0x1::aptos_coin::AptosCoin',
      views: 142,
    },
    {
      videoId: 'video_2',
      title: 'Building on Aptos Blockchain',
      description: 'Learn how to build decentralized applications on the Aptos blockchain using Move language.',
      shelbyUrl: 'shelby://video_2',
      thumbnailUrl: 'https://picsum.photos/seed/video2/640/360',
      uploader: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      timestamp: Date.now() - 86400000 * 5, // 5 days ago
      requiredToken: '0x1::aptos_coin::AptosCoin',
      views: 89,
    },
    {
      videoId: 'video_3',
      title: 'Shelby Protocol Deep Dive',
      description: 'Exploring Shelby decentralized storage and its sub-second streaming capabilities.',
      shelbyUrl: 'shelby://video_3',
      thumbnailUrl: 'https://picsum.photos/seed/video3/640/360',
      uploader: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
      timestamp: Date.now() - 86400000, // 1 day ago
      requiredToken: '0x1::aptos_coin::AptosCoin',
      views: 256,
    },
    {
      videoId: 'video_4',
      title: 'NFT Basics for Beginners',
      description: 'Understanding Non-Fungible Tokens and how they work in the Web3 ecosystem.',
      shelbyUrl: 'shelby://video_4',
      thumbnailUrl: 'https://picsum.photos/seed/video4/640/360',
      uploader: '0x1111111111111111222222222222222233333333333333334444444444444444',
      timestamp: Date.now() - 86400000 * 7, // 1 week ago
      requiredToken: '0x1::aptos_coin::AptosCoin',
      views: 521,
    },
    {
      videoId: 'video_5',
      title: 'Decentralized Storage Explained',
      description: 'How decentralized storage networks like Shelby, IPFS, and Arweave are revolutionizing data storage.',
      shelbyUrl: 'shelby://video_5',
      thumbnailUrl: 'https://picsum.photos/seed/video5/640/360',
      uploader: '0x5555555555555555666666666666666677777777777777778888888888888888',
      timestamp: Date.now() - 86400000 * 3, // 3 days ago
      requiredToken: '0x1::aptos_coin::AptosCoin',
      views: 178,
    },
    {
      videoId: 'video_6',
      title: 'Smart Contract Security Best Practices',
      description: 'Essential security considerations when developing Move smart contracts on Aptos.',
      shelbyUrl: 'shelby://video_6',
      thumbnailUrl: 'https://picsum.photos/seed/video6/640/360',
      uploader: '0xaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbccccccccccccccccdddddddddddddddd',
      timestamp: Date.now() - 86400000 * 10, // 10 days ago
      requiredToken: '0x1::aptos_coin::AptosCoin',
      views: 934,
    },
  ];
}

// Export mock data for use in other components during development
export { getMockVideos };
