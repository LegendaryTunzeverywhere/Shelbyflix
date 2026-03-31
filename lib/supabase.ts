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
  upload_timestamp: number;
  expiration_timestamp: number;
  availability_period: number;
  views: number;
  likes: number;
  dislikes: number;
  comment_count: number;
  price: number;
  created_at: string;
  updated_at: string;
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