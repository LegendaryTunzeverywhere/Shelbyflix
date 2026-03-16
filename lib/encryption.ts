import CryptoJS from 'crypto-js';

/**
 * Generate a random encryption key
 */
export function generateEncryptionKey(): string {
  return CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);
}

/**
 * Encrypt a file using AES-256
 * @param file - Video file to encrypt
 * @param key - Encryption key
 * @returns Encrypted blob
 */
export async function encryptFile(file: File, key: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer);
        
        // Encrypt using AES
        const encrypted = CryptoJS.AES.encrypt(wordArray, key);
        
        // Convert to blob
        const encryptedString = encrypted.toString();
        const blob = new Blob([encryptedString], { type: 'application/octet-stream' });
        
        resolve(blob);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Decrypt a blob using AES-256
 * @param encryptedBlob - Encrypted blob
 * @param key - Decryption key
 * @returns Decrypted blob
 */
export async function decryptBlob(encryptedBlob: Blob, key: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const encryptedString = e.target?.result as string;
        
        // Decrypt using AES
        const decrypted = CryptoJS.AES.decrypt(encryptedString, key);
        
        // Convert back to ArrayBuffer
        const typedArray = new Uint8Array(decrypted.sigBytes);
        for (let i = 0; i < decrypted.sigBytes; i++) {
          typedArray[i] = (decrypted.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
        }
        
        const blob = new Blob([typedArray], { type: 'video/mp4' });
        resolve(blob);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read encrypted blob'));
    reader.readAsText(encryptedBlob);
  });
}

/**
 * Get video duration from file
 */
export async function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(Math.floor(video.duration));
    };
    
    video.onerror = () => {
      reject(new Error('Failed to load video metadata'));
    };
    
    video.src = URL.createObjectURL(file);
  });
}

/**
 * Generate thumbnail from video
 */
export async function generateThumbnail(file: File, timeInSeconds: number = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    
    video.onloadedmetadata = () => {
      video.currentTime = timeInSeconds;
    };
    
    video.onseeked = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const thumbnailUrl = URL.createObjectURL(blob);
          resolve(thumbnailUrl);
        } else {
          reject(new Error('Failed to generate thumbnail'));
        }
      }, 'image/jpeg', 0.8);
      
      window.URL.revokeObjectURL(video.src);
    };
    
    video.onerror = () => reject(new Error('Failed to load video'));
    video.src = URL.createObjectURL(file);
  });
}