import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Database types
export interface User {
  id: string;
  wallet_address: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  banner_url?: string;
  bio?: string;
  created_at: string;
  updated_at: string;
}

export interface VideoRecord {
  id: string;
  video_id: string;
  blob_id: string;
  blob_name: string;
  uploader_wallet: string;
  channel_id: string;
  channel_name: string;
  title: string;
  description?: string;
  category: string;
  tags: string[];
  shelby_url: string;
  encryption_key: string;
  thumbnail_url?: string;
  duration: number;
  is_short: boolean;
  // Optional: stores 'short' | 'long' string in newer rows
  video_type?: 'short' | 'long';
  upload_timestamp: number;
  expiration_timestamp: number;
  availability_period: number;
  views: number;
  likes: number;
  dislikes: number;
  comment_count: number;
  price: number;
  // Access control (see supabase/migrations/2026_05_video_access_payments.sql)
  // CHECK constraint restricts access_mode to these four values; existing rows
  // default to 'public' so legacy videos retain current behavior.
  access_mode: 'public' | 'allowlist' | 'timelock' | 'purchasable';
  // Lowercased Aptos addresses. Empty array for non-allowlist modes.
  allowlist: string[];
  // Epoch millis; only meaningful when access_mode === 'timelock'.
  unlock_at: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * One row per verified on-chain purchase receipt. Mirrors the `video_purchases`
 * table. PK is (video_id, wallet_address); tx_hash is globally unique.
 * RLS is enabled with no policies — only the service-role client may read/write.
 */
export interface VideoPurchaseRecord {
  video_id: string;
  wallet_address: string; // lowercased
  tx_hash: string;        // globally unique
  amount_total: number;   // base units (bigint in DB; safe within JS number range for SUSD amounts)
  amount_creator: number;
  amount_platform: number;
  block_version: number | null;
  created_at: string;
}

export interface CommentRecord {
  id: string;
  comment_id: string;
  video_id: string;
  user_id: string;
  user_name: string;
  user_avatar?: string;
  text: string;
  likes: number;
  timestamp: number;
  parent_comment_id?: string;
  created_at: string;
  updated_at: string;
}