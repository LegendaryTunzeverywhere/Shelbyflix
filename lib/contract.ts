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
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::upload_video` as `${string}::${string}::${string}`,
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
      payload: {
        function: `${MODULE_ADDRESS}::${MODULE_NAME}::can_access_video` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [walletAddress, stringToHexBytes(videoId)],
      }
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
  // Use ShelbyUSD token - used to pay upload fees when uploading blobs to Shelby network
  // Get test tokens from: https://docs.shelby.xyz/apis/faucet/shelbyusd
  const SHELBYUSD_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS || '0xa8d56bad68eb3d9c54c5c96b91c7e7471fb4c80dafed03e458da0aca6ef0fb5b0x1b18363a9f1fe5e6ebf247daba5cc1c18052bb232efdc4c50f556053922d98e1';
  
  return [
    {
      videoId: 'video_1',
      title: 'Welcome to Token-Gated Videos on Shelbynet',
      description: 'An introduction to decentralized video streaming on Shelbynet with Shelby storage. Requires ShelbyUSD tokens for access.',
      shelbyUrl: 'shelby://video_1',
      thumbnailUrl: 'https://picsum.photos/seed/video1/640/360',
      uploader: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      timestamp: Date.now() - 86400000 * 2, // 2 days ago
      requiredToken: SHELBYUSD_TOKEN_ADDRESS,
      views: 142,
    },
    {
      videoId: 'video_2',
      title: 'Getting Started with ShelbyUSD',
      description: 'Learn how to get ShelbyUSD tokens from the faucet and use them to access token-gated content on Shelbynet.',
      shelbyUrl: 'shelby://video_2',
      thumbnailUrl: 'https://picsum.photos/seed/video2/640/360',
      uploader: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      timestamp: Date.now() - 86400000 * 5, // 5 days ago
      requiredToken: SHELBYUSD_TOKEN_ADDRESS,
      views: 89,
    },
    {
      videoId: 'video_3',
      title: 'Shelby Protocol Deep Dive',
      description: 'Exploring Shelby decentralized storage and its sub-second streaming capabilities. Upload fees paid in ShelbyUSD.',
      shelbyUrl: 'shelby://video_3',
      thumbnailUrl: 'https://picsum.photos/seed/video3/640/360',
      uploader: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
      timestamp: Date.now() - 86400000, // 1 day ago
      requiredToken: SHELBYUSD_TOKEN_ADDRESS,
      views: 256,
    },
    {
      videoId: 'video_4',
      title: 'Blob Uploads on Shelby Network',
      description: 'How to upload video blobs to the Shelby network using ShelbyUSD tokens for upload fees.',
      shelbyUrl: 'shelby://video_4',
      thumbnailUrl: 'https://picsum.photos/seed/video4/640/360',
      uploader: '0x1111111111111111222222222222222233333333333333334444444444444444',
      timestamp: Date.now() - 86400000 * 7, // 1 week ago
      requiredToken: SHELBYUSD_TOKEN_ADDRESS,
      views: 521,
    },
    {
      videoId: 'video_5',
      title: 'Decentralized Storage on Shelbynet',
      description: 'How Shelby storage integrates with Aptos Shelbynet for decentralized video hosting with ShelbyUSD payments.',
      shelbyUrl: 'shelby://video_5',
      thumbnailUrl: 'https://picsum.photos/seed/video5/640/360',
      uploader: '0x5555555555555555666666666666666677777777777777778888888888888888',
      timestamp: Date.now() - 86400000 * 3, // 3 days ago
      requiredToken: SHELBYUSD_TOKEN_ADDRESS,
      views: 178,
    },
    {
      videoId: 'video_6',
      title: 'Token-Gated Content with ShelbyUSD',
      description: 'Essential guide to creating token-gated video content using ShelbyUSD on the Shelby network.',
      shelbyUrl: 'shelby://video_6',
      thumbnailUrl: 'https://picsum.photos/seed/video6/640/360',
      uploader: '0xaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbccccccccccccccccdddddddddddddddd',
      timestamp: Date.now() - 86400000 * 10, // 10 days ago
      requiredToken: SHELBYUSD_TOKEN_ADDRESS,
      views: 934,
    },
  ];
}

// Export mock data for use in other components during development
export { getMockVideos };
