import { supabase } from './supabase';
import type { User } from './supabase';

// Re-export User type
export type { User } from './supabase';

/**
 * Check if username is available
 */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('users')
    .select('username')
    .eq('username', username.toLowerCase());
  
  // Username is available if no rows found (data is empty array)
  if (error) {
    console.error('Error checking username:', error);
    return false; // Assume taken on error
  }
  
  return data.length === 0; // Available if no matching usernames found
}

/**
 * Get user by wallet address
 */
export async function getUserByWallet(walletAddress: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('wallet_address', walletAddress.toLowerCase())
    .single();
  
  if (error) return null;
  return data;
}

/**
 * Get user by username
 */
export async function getUserByUsername(username: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username.toLowerCase())
    .single();
  
  if (error) return null;
  return data;
}

/**
 * Create new user
 */
export async function createUser(
  walletAddress: string,
  username: string,
  displayName?: string
): Promise<User | null> {
  try {
    // Check if user already exists
    const existing = await getUserByWallet(walletAddress);
    if (existing) {
      console.log('User already exists:', existing);
      return existing;
    }
    
    // Check if username is taken
    const available = await isUsernameAvailable(username);
    if (!available) {
      throw new Error('Username already taken');
    }
    
    // Create new user
    const { data, error } = await supabase
      .from('users')
      .insert({
        wallet_address: walletAddress.toLowerCase(),
        username: username.toLowerCase(),
        display_name: displayName || username,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating user:', error);
      throw error;
    }
    
    console.log('✅ User created successfully:', data);
    return data;
  } catch (error) {
    console.error('Failed to create user:', error);
    throw error;
  }
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  walletAddress: string,
  updates: {
    username?: string;
    display_name?: string;
    avatar_url?: string;
    bio?: string;
  }
): Promise<User | null> {
  // If updating username, check availability
  if (updates.username) {
    const currentUser = await getUserByWallet(walletAddress);
    if (currentUser && currentUser.username.toLowerCase() !== updates.username.toLowerCase()) {
      const available = await isUsernameAvailable(updates.username);
      if (!available) {
        throw new Error('Username already taken');
      }
    }
  }
  
  const { data, error } = await supabase
    .from('users')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('wallet_address', walletAddress.toLowerCase())
    .select()
    .single();
  
  if (error) throw error;
  return data;
}