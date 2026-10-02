import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const csrfFetch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/csrf-client', () => ({ csrfFetch }));

import { authorizeWalletSession, postWalletInteraction } from '@/lib/wallet-interactions';

const walletAddress = '0x1234';
const payload = { videoId: 'video-1', liked: true, disliked: false };

function jsonResponse(body: unknown, ok: boolean, status: number): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('postWalletInteraction', () => {
  beforeEach(() => csrfFetch.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('uses the existing wallet session without requesting a signature', async () => {
    csrfFetch.mockResolvedValueOnce(jsonResponse({ success: true }, true, 200));
    const signMessage = vi.fn();

    await expect(
      postWalletInteraction(
        walletAddress,
        'public-key',
        signMessage,
        'engagement',
        payload,
      ),
    ).resolves.toEqual({ success: true });

    expect(csrfFetch).toHaveBeenCalledTimes(1);
    expect(signMessage).not.toHaveBeenCalled();
  });

  it('bootstraps a session with an explicit, non-transaction purpose', async () => {
    csrfFetch.mockResolvedValueOnce(jsonResponse({ authorized: true }, true, 200));
    const signMessage = vi.fn();
    const onSignatureRequired = vi.fn();

    await expect(
      authorizeWalletSession(walletAddress, 'public-key', signMessage, onSignatureRequired),
    ).resolves.toBeUndefined();

    expect(JSON.parse(csrfFetch.mock.calls[0][1].body)).toEqual({
      walletAddress,
      action: 'session',
      payload: {
        purpose: 'Authorize Shelbyflix interactions for 24 hours. No transaction or token transfer.',
      },
    });
    expect(signMessage).not.toHaveBeenCalled();
    expect(onSignatureRequired).not.toHaveBeenCalled();
  });

  it('signs the clear 24-hour purpose when no wallet session exists', async () => {
    csrfFetch
      .mockResolvedValueOnce(jsonResponse(
        { code: 'wallet_signature_required', requiresSignature: true },
        true,
        200,
      ))
      .mockResolvedValueOnce(jsonResponse({ authorized: true }, true, 200));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ nonce: 'session-challenge' }, true, 200),
    ));
    const purpose = 'Authorize Shelbyflix interactions for 24 hours. No transaction or token transfer.';
    const message = `ShelbyFlix session: session-challenge\n{"purpose":${JSON.stringify(purpose)}}`;
    const signMessage = vi.fn().mockResolvedValue({
      signature: '0xsig',
      fullMessage: `APTOS\napplication: Shelbyflix\nmessage: ${message}\nnonce: session-challenge`,
      message,
      publicKey: '0xkey',
    });
    const onSignatureRequired = vi.fn();

    await expect(
      authorizeWalletSession(walletAddress, '0xkey', signMessage, onSignatureRequired),
    ).resolves.toBeUndefined();

    expect(onSignatureRequired).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledWith({ message, nonce: 'session-challenge' });
    expect(JSON.parse(csrfFetch.mock.calls[1][1].body)).toMatchObject({
      action: 'session',
      payload: { purpose },
      signedContent: message,
      signedMessage: `APTOS\napplication: Shelbyflix\nmessage: ${message}\nnonce: session-challenge`,
      nonce: 'session-challenge',
    });
  });

  it('requests a signature only when the server requires one', async () => {
    csrfFetch
      .mockResolvedValueOnce(jsonResponse(
        {
          code: 'wallet_signature_required',
          error: 'Wallet signature required',
          requiresSignature: true,
        },
        true,
        200,
      ))
      .mockResolvedValueOnce(jsonResponse({ success: true }, true, 200));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ nonce: 'challenge-1' }, true, 200),
    ));
    const fullMessage = new TextEncoder().encode(
      'ShelbyFlix engagement: challenge-1\n{"disliked":false,"liked":true,"videoId":"video-1"}',
    );
    const toUint8Array = vi.fn(() => new Uint8Array([0xff]));
    const signMessage = vi.fn().mockResolvedValue({
      signature: {
        signature: {},
        bcsToBytes: () => new Uint8Array([1, 2]),
        toUint8Array,
      },
      fullMessage: new TextEncoder().encode('wallet-standard-framing'),
      message: fullMessage,
      publicKey: { toUint8Array: () => new Uint8Array([3, 4]) },
    });

    await expect(
      postWalletInteraction(
        walletAddress,
        'fallback-public-key',
        signMessage,
        'engagement',
        payload,
      ),
    ).resolves.toEqual({ success: true });

    expect(signMessage).toHaveBeenCalledWith({
      message: 'ShelbyFlix engagement: challenge-1\n{"disliked":false,"liked":true,"videoId":"video-1"}',
      nonce: 'challenge-1',
    });
    expect(csrfFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(csrfFetch.mock.calls[1][1].body)).toMatchObject({
      walletAddress,
      action: 'engagement',
      payload,
      publicKey: '0x0304',
      signature: '0x0102',
      signedMessage: 'wallet-standard-framing',
      signedContent: 'ShelbyFlix engagement: challenge-1\n{"disliked":false,"liked":true,"videoId":"video-1"}',
      nonce: 'challenge-1',
    });
    expect(toUint8Array).not.toHaveBeenCalled();
  });
});
