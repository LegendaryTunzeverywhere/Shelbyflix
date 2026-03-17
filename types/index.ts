export enum VideoCategory {
  ENTERTAINMENT = "Entertainment",
  EDUCATION = "Education",
  GAMING = "Gaming",
  MUSIC = "Music",
  SPORTS = "Sports",
  NEWS = "News",
  TECH = "Technology",
  LIFESTYLE = "Lifestyle",
  COMEDY = "Comedy",
  OTHER = "Other"
}

export interface VideoMetadata {
  // Identity
  videoId: string;
  channelId: string; // Uploader's wallet address
  channelName: string;
  
  // Content
  title: string;
  description?: string;
  category: VideoCategory;
  tags: string[];
  
  // Storage
  blobId: string; // Shelbynet blob ID
  blobName: string;
  shelbyUrl: string;
  encryptionKey: string; // Symmetric key for ACE decryption
  thumbnailUrl?: string;
  
  // Metadata
  duration: number; // Video duration in seconds
  uploadTimestamp: number;
  expirationTimestamp: number;
  availabilityPeriod: number; // Days until expiration
  
  // Engagement
  views: number;
  likes: number;
  dislikes: number;
  commentCount: number;
  
  // Video type
  isShort: boolean; // Videos under 60 seconds
  
  // Legacy (keep for backwards compatibility)
  uploader: string;
  timestamp: number;
  requiredToken?: string;
  price?: number;
}

export interface Channel {
  channelId: string;
  channelName: string;
  description: string;
  avatarUrl?: string;
  bannerUrl?: string;
  subscribers: number;
  totalViews: number;
  totalVideos: number;
  createdAt: number;
}

export interface VideoEngagement {
  videoId: string;
  userId: string;
  liked: boolean;
  disliked: boolean;
  timestamp: number;
}

export interface Comment {
  commentId: string;
  videoId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  text: string;
  likes: number;
  timestamp: number;
  replies?: Comment[];
  parentCommentId?: string;
}

export interface Subscription {
  subscriberId: string;
  channelId: string;
  timestamp: number;
}

export interface UploadProgress {
  stage: 'preparing' | 'encrypting' | 'uploading' | 'registering' | 'finalizing' | 'complete' | 'error' | 'processing';
  progress: number; // 0-100
  message: string;
}

export interface ShelbyBlobMetadata {
  blobId: string;
  blobName: string;
  blobCommitment: string;
  blobSize: number;
  chunksetCount: number;
  expirationMicros: number;
  paymentAmount: number;
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number; // Optional duration in milliseconds after which the toast auto-closes
}
