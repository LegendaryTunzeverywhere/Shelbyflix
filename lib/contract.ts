import { aptos, MODULE_ADDRESS, stringToHexBytes, hexBytesToString, waitForTransaction, SHELBYUSD_TOKEN } from './aptos';
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
 * @param walletAddress - Wallet address of the uploader
 * @param signAndSubmitTransaction - Wallet adapter function
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
        metadata.videoId,
        metadata.title,
        metadata.description,
        metadata.shelbyUrl,
        metadata.price || 0,
        MODULE_ADDRESS, // Registry address is the module address in this case
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
 * Purchase access to a video
 * 
 * @param walletAddress - Buyer's wallet address
 * @param signAndSubmitTransaction - Wallet adapter function
 * @param videoId - ID of the video to purchase
 */
export async function purchaseVideo(
  walletAddress: string,
  signAndSubmitTransaction: any,
  videoId: string
): Promise<string> {
  try {
    const payload: InputGenerateTransactionPayloadData = {
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::purchase_video` as `${string}::${string}::${string}`,
      typeArguments: [],
      functionArguments: [
        videoId,
        MODULE_ADDRESS,
        SHELBYUSD_TOKEN, // Passed as asset_metadata_address
      ],
    };

    const response = await signAndSubmitTransaction({
      sender: walletAddress,
      data: payload,
    });

    const success = await waitForTransaction(response.hash);
    if (!success) throw new Error('Purchase transaction failed');

    return response.hash;
  } catch (error) {
    console.error('Error purchasing video:', error);
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
    const result = await aptos.view({
      payload: {
        function: `${MODULE_ADDRESS}::${MODULE_NAME}::get_all_videos` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [MODULE_ADDRESS],
      }
    });
    
    const videos = result[0] as any[];
    return videos.map(parseVideoMetadata);
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
    if (!walletAddress) return false;

    const result = await aptos.view({
      payload: {
        function: `${MODULE_ADDRESS}::${MODULE_NAME}::can_access_video` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [walletAddress, videoId, MODULE_ADDRESS],
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
    const result = await aptos.view({
      payload: {
        function: `${MODULE_ADDRESS}::${MODULE_NAME}::get_video_by_id` as `${string}::${string}::${string}`,
        typeArguments: [],
        functionArguments: [MODULE_ADDRESS, videoId],
      }
    });
    
    return parseVideoMetadata(result[0]);
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    return null;
  }
}

/**
 * Delete video metadata from blockchain
 * 
 * @param walletAddress - Uploader's wallet address
 * @param signAndSubmitTransaction - Wallet adapter function
 * @param videoId - ID of the video to delete
 */
export async function deleteVideoFromChain(
  walletAddress: string,
  signAndSubmitTransaction: any,
  videoId: string
): Promise<string> {
  try {
    const payload: InputGenerateTransactionPayloadData = {
      function: `${MODULE_ADDRESS}::${MODULE_NAME}::delete_video` as `${string}::${string}::${string}`,
      typeArguments: [],
      functionArguments: [
        videoId,
        MODULE_ADDRESS,
      ],
    };

    const response = await signAndSubmitTransaction({
      sender: walletAddress,
      data: payload,
    });

    const success = await waitForTransaction(response.hash);
    if (!success) throw new Error('Delete transaction failed');

    return response.hash;
  } catch (error) {
    console.error('Error deleting video from chain:', error);
    throw error;
  }
}

/**
 * Parse raw blockchain data into VideoMetadata
 */
function parseVideoMetadata(raw: any): VideoMetadata {
  return {
    videoId: raw.video_id,
    title: raw.title,
    description: raw.description,
    shelbyUrl: raw.shelby_url,
    uploader: raw.uploader,
    timestamp: Number(raw.timestamp) * 1000, // Convert to ms
    requiredToken: raw.required_token,
    views: Number(raw.views),
    price: Number(raw.price),
  };
}
