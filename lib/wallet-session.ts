import { createHash, randomBytes } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const WALLET_SESSION_COOKIE = 'shelbyflix_wallet_session';
export const WALLET_SESSION_TTL_SECONDS = 24 * 60 * 60;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function hasWalletSession(
  request: NextRequest,
  walletAddress: string,
): Promise<boolean> {
  const token = request.cookies.get(WALLET_SESSION_COOKIE)?.value;
  if (!token) return false;

  const { data, error } = await getSupabaseAdmin()
    .from('wallet_auth_sessions')
    .select('wallet_address')
    .eq('session_hash', hashToken(token))
    .eq('wallet_address', walletAddress.toLowerCase())
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function createWalletSession(walletAddress: string): Promise<string> {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const { error: cleanupError } = await admin
    .from('wallet_auth_sessions')
    .delete()
    .lt('expires_at', now.toISOString());
  if (cleanupError) throw cleanupError;

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(now.getTime() + WALLET_SESSION_TTL_SECONDS * 1000).toISOString();

  const { error } = await admin.from('wallet_auth_sessions').insert({
    session_hash: hashToken(token),
    wallet_address: walletAddress.toLowerCase(),
    expires_at: expiresAt,
  });
  if (error) throw error;

  return token;
}

export function setWalletSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(WALLET_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: WALLET_SESSION_TTL_SECONDS,
  });
}
