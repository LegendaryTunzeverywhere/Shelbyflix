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

export type VideoType = 'short' | 'long';

export interface VideoMetadata {
  videoId: string;
  channelId: string;
  channelName: string;
  title: string;
  description?: string;
  category: VideoCategory;
  tags: string[];
  blobId: string;
  blobName: string;
  shelbyUrl: string;
  encryptionKey: string;
  thumbnailUrl?: string;
  duration: number;
  uploadTimestamp: number;
  expirationTimestamp: number;
  availabilityPeriod: number;
  views: number;
  likes: number;
  dislikes: number;
  commentCount: number;
  isShort: boolean;
  videoType: VideoType;
  uploader: string;
  timestamp: number;
  requiredToken?: string;
  price?: number;
  // Access control (see .kiro/specs/video-access-payments/design.md).
  // Defaults to 'public' for legacy videos that predate this feature.
  accessMode: AccessMode;
  // Lowercased Aptos addresses. Empty array unless accessMode === 'allowlist'.
  allowlist: string[];
  // Epoch millis. Only meaningful when accessMode === 'timelock'.
  unlockAt?: number;
}

/**
 * One of the four access modes a creator can pick for a video. Exactly one
 * per video. Mirrors the Shelby Explorer "Manage Permissions" UI.
 */
export type AccessMode = 'public' | 'allowlist' | 'timelock' | 'purchasable';

/**
 * Why access was granted or denied. Returned by the access-resolution
 * endpoint so the UI can render the correct gate state without re-deriving
 * the decision client-side.
 */
export type AccessReason =
  | 'public'
  | 'owner'
  | 'allowlisted'
  | 'purchased'
  | 'time_locked'
  | 'not_on_allowlist'
  | 'payment_required'
  | 'expired';

/**
 * Resolved access for a single (video, wallet) pair. Produced by
 * `lib/access-control.ts#resolveAccess` and returned by
 * `GET /api/videos/:id/access`. Intentionally omits anything sensitive
 * (e.g. encryptionKey) — this is strictly a boolean + metadata surface.
 */
export interface AccessResult {
  hasAccess: boolean;
  reason: AccessReason;
  accessMode: AccessMode;
  ownerIsViewer: boolean;
  unlockAt?: number;
  priceBaseUnits?: number;
}

/**
 * The subset of a video's row that the access-control layer needs to make
 * a decision. Decoupled from `VideoMetadata` so a future Shelby-native
 * backend can populate it from on-chain permissions instead of Supabase.
 */
export interface AccessConfig {
  videoId: string;
  ownerWallet: string;          // lowercase
  accessMode: AccessMode;
  allowlist?: string[];         // lowercase
  unlockAt?: number;            // epoch ms
  priceBaseUnits?: number;      // SUSD base units (8 decimals)
  expirationTimestamp: number;  // epoch ms
}

/**
 * Domain representation of a verified on-chain purchase receipt. The
 * database row shape is `VideoPurchaseRecord` in `lib/supabase.ts`; this
 * camelCase variant is what UI code and hooks consume.
 */
export interface VideoPurchase {
  videoId: string;
  walletAddress: string;      // lowercase
  txHash: string;             // globally unique
  amountTotal: number;        // base units
  amountCreator: number;      // base units
  amountPlatform: number;     // base units
  blockVersion?: number;
  createdAt: string;          // ISO timestamp
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
  progress: number;
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
  duration?: number;
}