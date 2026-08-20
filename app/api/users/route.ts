import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizeAddress } from '@/lib/access-control';

/**
 * POST /api/users
 * Create a new user profile
 * 
 * This route uses the service role to bypass RLS since wallet-based auth
 * doesn't integrate with Supabase's auth.uid() system.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, username, displayName } = body;

    // Validate inputs
    if (!walletAddress || !username) {
      return NextResponse.json(
        { error: 'walletAddress and username are required' },
        { status: 400 }
      );
    }

    const walletLc = normalizeAddress(walletAddress);
    const usernameLc = username.toLowerCase();
    
    const admin = getSupabaseAdmin();

    // Check if user already exists
    const { data: existingUser } = await admin
      .from('users')
      .select('*')
      .eq('wallet_address', walletLc)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json(existingUser, { status: 200 });
    }

    // Check if username is taken
    const { data: existingUsername } = await admin
      .from('users')
      .select('username')
      .eq('username', usernameLc)
      .maybeSingle();

    if (existingUsername) {
      return NextResponse.json(
        { error: 'Username already taken' },
        { status: 409 }
      );
    }

    // Create new user
    const { data: newUser, error } = await admin
      .from('users')
      .insert({
        wallet_address: walletLc,
        username: usernameLc,
        display_name: displayName || username,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating user:', error);
      return NextResponse.json(
        { error: 'Failed to create user', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error('Failed to create user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/users?walletAddress=0x...
 * Get user by wallet address
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('walletAddress');

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'walletAddress parameter is required' },
        { status: 400 }
      );
    }

    const walletLc = normalizeAddress(walletAddress);
    const admin = getSupabaseAdmin();

    const { data: user, error } = await admin
      .from('users')
      .select('*')
      .eq('wallet_address', walletLc)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user:', error);
      return NextResponse.json(
        { error: 'Failed to fetch user' },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(user, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
/**
 * PATCH /api/users
 * Update user profile (avatar, banner, bio, etc.)
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, updates } = body;

    // Validate inputs
    if (!walletAddress || !updates) {
      return NextResponse.json(
        { error: 'walletAddress and updates are required' },
        { status: 400 }
      );
    }

    const walletLc = normalizeAddress(walletAddress);
    const admin = getSupabaseAdmin();

    // Verify user exists
    const { data: existingUser } = await admin
      .from('users')
      .select('*')
      .eq('wallet_address', walletLc)
      .maybeSingle();

    if (!existingUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // If updating username, check availability
    if (updates.username && updates.username.toLowerCase() !== existingUser.username.toLowerCase()) {
      const { data: existingUsername } = await admin
        .from('users')
        .select('username')
        .eq('username', updates.username.toLowerCase())
        .maybeSingle();

      if (existingUsername) {
        return NextResponse.json(
          { error: 'Username already taken' },
          { status: 409 }
        );
      }
    }

    // Update user profile
    const { data: updatedUser, error } = await admin
      .from('users')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', walletLc)
      .select()
      .single();

    if (error) {
      console.error('Error updating user:', error);
      return NextResponse.json(
        { error: 'Failed to update user', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedUser, { status: 200 });
  } catch (error) {
    console.error('Failed to update user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
