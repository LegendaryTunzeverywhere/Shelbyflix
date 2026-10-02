import { describe, expect, it } from 'vitest';
import {
  buildWalletStandardMessage,
  resolveWalletInteractionMessage,
} from '@/lib/wallet-standard-message';

describe('buildWalletStandardMessage', () => {
  it('reconstructs the canonical Aptos framing returned by Petra Web', () => {
    expect(buildWalletStandardMessage({
      prefix: 'APTOS',
      address: '0xabc',
      application: 'https://shelbyflix.vercel.app',
      chainId: 126,
      message: 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}',
      nonce: 'challenge',
    })).toBe(
      'APTOS\naddress: 0xabc\napplication: https://shelbyflix.vercel.app\nchainId: 126' +
      '\nmessage: ShelbyFlix session: challenge\n{"purpose":"Authorize"}\nnonce: challenge',
    );
  });

  it('rejects unknown prefixes rather than guessing the wallet signature frame', () => {
    expect(buildWalletStandardMessage({
      prefix: 'UNKNOWN',
      message: 'signed content',
      nonce: 'challenge',
    })).toBeNull();
  });

  it('reconstructs the canonical signed bytes when Petra Web returns them separately', () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    expect(resolveWalletInteractionMessage(
      'wallet-returned-full-message',
      content,
      content,
      'challenge',
      { prefix: 'APTOS', application: 'https://shelbyflix.app', chainId: 126 },
    )).toBe(
      'APTOS\napplication: https://shelbyflix.app\nchainId: 126' +
      `\nmessage: ${content}\nnonce: challenge`,
    );
  });

  it('does not accept separately claimed content if it cannot bind it to signed bytes', () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    expect(resolveWalletInteractionMessage(
      'unrelated signed bytes',
      content,
      content,
      'challenge',
    )).toBeNull();
  });
});
