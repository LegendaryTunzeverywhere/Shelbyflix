/**
 * Utility functions for ShelbyFlix
 */

/**
 * Format wallet address for display
 * @param address - Full wallet address
 * @param chars - Number of characters to show on each end (default: 4)
 * @returns Formatted address like "0x15ff...ff25"
 */
export function formatAddress(address: string | undefined | null, chars: number = 4): string {
  if (!address) return '';
  
  // Remove 0x prefix for calculation
  const hex = address.startsWith('0x') ? address.slice(2) : address;
  
  // If address is short enough, return as-is
  if (hex.length <= chars * 2) return address;
  
  // Return formatted: 0x + first chars + ... + last chars
  return `0x${hex.slice(0, chars)}...${hex.slice(-chars)}`;
}

/**
 * Truncate text with ellipsis
 * @param text - Text to truncate
 * @param maxLength - Maximum length before truncation
 * @returns Truncated text with "..."
 */
export function truncateText(text: string | undefined | null, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Format number with K/M suffix
 * @param num - Number to format
 * @returns Formatted string like "1.2K" or "3.5M"
 */
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 * @param seconds - Duration in seconds
 * @returns Formatted duration string
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Check if user can perform action on video
 * @param userAddress - Current user's wallet address
 * @param videoUploader - Video uploader's wallet address
 * @returns true if user owns the video
 */
export function isVideoOwner(
  userAddress: string | undefined,
  videoUploader: string | undefined
): boolean {
  if (!userAddress || !videoUploader) return false;
  return userAddress.toLowerCase() === videoUploader.toLowerCase();
}

/**
 * Validate email address
 * @param email - Email to validate
 * @returns true if valid email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate username
 * @param username - Username to validate
 * @returns Object with valid boolean and error message
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username) {
    return { valid: false, error: 'Username is required' };
  }
  
  if (username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  
  if (username.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or less' };
  }
  
  if (!/^[a-z0-9_]+$/.test(username)) {
    return { valid: false, error: 'Username can only contain lowercase letters, numbers, and underscores' };
  }
  
  return { valid: true };
}

/**
 * Copy text to clipboard
 * @param text - Text to copy
 * @returns Promise<boolean> - true if successful
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Generate random ID
 * @param prefix - Optional prefix for the ID
 * @returns Random ID string
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

/**
 * Debounce function
 * @param func - Function to debounce
 * @param wait - Wait time in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };
    
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}