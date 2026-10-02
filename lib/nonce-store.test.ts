import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSupabaseAdmin = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin }));

import { issueNonce, MAX_NONCES_PER_WALLET } from '@/lib/nonce-store';

function query(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ['delete', 'select', 'eq', 'gt', 'order', 'limit', 'lt']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.insert = vi.fn().mockResolvedValue(result);
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe('issueNonce', () => {
  beforeEach(() => getSupabaseAdmin.mockReset());

  it('replaces the oldest outstanding challenge when the wallet is at its cap', async () => {
    const cleanup = query({ error: null });
    const count = query({ count: MAX_NONCES_PER_WALLET, error: null });
    const oldest = query({ data: { nonce: 'old-challenge' }, error: null });
    const removeOldest = query({ error: null });
    const insert = query({ error: null });
    const builders = [cleanup, count, oldest, removeOldest, insert];
    const from = vi.fn(() => builders.shift());
    getSupabaseAdmin.mockReturnValue({ from });

    const nonce = await issueNonce('0xAbC', '127.0.0.1');

    expect(nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(from).toHaveBeenCalledTimes(5);
    expect(removeOldest.eq).toHaveBeenCalledWith('nonce', 'old-challenge');
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({
      wallet_address: '0xabc',
      nonce,
      ip_address: '127.0.0.1',
    }));
  });
});
