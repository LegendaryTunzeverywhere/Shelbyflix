// Core Types for Token-Gated Video Gallery

export interface VideoMetadata {
  videoId: string;
  title: string;
  description: string;
  shelbyUrl: string;
  thumbnailUrl?: string;
  uploader: string;
  timestamp: number;
  requiredToken: string;
  fileSize?: number;
  duration?: number;
  views?: number;
}

export interface UploadFormData {
  file: File;
  title: string;
  description: string;
}

export interface WalletState {
  address: string | null;
  connected: boolean;
  hasAccess: boolean;
  balance: string;
}

export interface TokenRequirement {
  tokenAddress: string;
  minBalance: number;
}

export interface ShelbyUploadResponse {
  videoId: string;
  shelbyUrl: string;
  success: boolean;
  error?: string;
}

export interface ShelbyVideoStream {
  streamUrl: string;
  accessToken: string;
  expiresAt: number;
}

export interface VideoAccessCheck {
  hasAccess: boolean;
  reason?: string;
  tokenBalance?: number;
}

export interface UploadProgress {
  percent: number;
  stage: 'preparing' | 'uploading' | 'processing' | 'complete' | 'error';
  message: string;
}

export interface GalleryFilters {
  search: string;
  sortBy: 'newest' | 'oldest' | 'popular';
  showLockedOnly?: boolean;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface VideoListResponse {
  videos: VideoMetadata[];
  total: number;
  page: number;
  pageSize: number;
}

// Move Smart Contract Types
export interface MoveVideoMetadata {
  video_id: number[];
  title: number[];
  description: number[];
  shelby_url: number[];
  uploader: string;
  timestamp: number;
  required_token: string;
}

export interface MoveResource<T> {
  type: string;
  data: T;
}

// Notification Types
export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number;
}

// Storage Interface (for modularity - can swap Shelby with IPFS, etc.)
export interface VideoStorageProvider {
  upload(file: File, metadata: Partial<VideoMetadata>): Promise<ShelbyUploadResponse>;
  retrieve(videoId: string): Promise<string>;
  checkAccess(videoId: string, walletAddress: string): Promise<boolean>;
  getStreamUrl(videoId: string, accessToken?: string): Promise<string>;
}
