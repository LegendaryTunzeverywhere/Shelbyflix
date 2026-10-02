/**
 * Durable, IP-bound nonce storage for serverless challenge/verify flows.
 */

import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/** Maximum outstanding nonces per wallet address */
export const MAX_NONCES_PER_WALLET = 5;

export const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Issue a new nonce for a wallet, bound to the requesting IP.
 * When the wallet reaches its outstanding-challenge cap, replace its oldest
 * live challenge so failed attempts cannot lock the wallet out until expiry.
 */
export async function issueNonce(walletAddress: string, ip: string): Promise<string | null> {
  const key = walletAddress.toLowerCase();
  const now = Date.now();
  const admin = getSupabaseAdmin();

  const { error: pruneError } = await admin
    .from('wallet_auth_challenges')
    .delete()
    .lt('expires_at', new Date(now).toISOString());
  if (pruneError) throw pruneError;

  const { count, error: countError } = await admin
    .from('wallet_auth_challenges')
    .select('nonce', { count: 'exact', head: true })
    .eq('wallet_address', key)
    .gt('expires_at', new Date(now).toISOString());
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_NONCES_PER_WALLET) {
    const { data: oldest, error: oldestError } = await admin
      .from('wallet_auth_challenges')
      .select('nonce')
      .eq('wallet_address', key)
      .gt('expires_at', new Date(now).toISOString())
      .order('expires_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oldestError) throw oldestError;

    if (oldest) {
      const { error: removeError } = await admin
        .from('wallet_auth_challenges')
        .delete()
        .eq('nonce', oldest.nonce);
      if (removeError) throw removeError;
    }
  }

  const nonce = randomBytes(32).toString('hex');
  const { error: insertError } = await admin.from('wallet_auth_challenges').insert({
    wallet_address: key,
    nonce,
    ip_address: ip,
    expires_at: new Date(now + NONCE_TTL_MS).toISOString(),
  });
  if (insertError) throw insertError;
  return nonce;
}

export async function hasNonce(
  walletAddress: string,
  nonce: string,
  ip: string,
): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from('wallet_auth_challenges')
    .select('nonce')
    .eq('wallet_address', walletAddress.toLowerCase())
    .eq('nonce', nonce)
    .eq('ip_address', ip)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Atomically consume a nonce only when its wallet, IP and expiry all match.
 */
export async function verifyAndConsumeNonce(
  walletAddress: string,
  nonce: string,
  ip: string,
): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from('wallet_auth_challenges')
    .delete()
    .eq('wallet_address', walletAddress.toLowerCase())
    .eq('nonce', nonce)
    .eq('ip_address', ip)
    .gt('expires_at', new Date().toISOString())
    .select('nonce')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
