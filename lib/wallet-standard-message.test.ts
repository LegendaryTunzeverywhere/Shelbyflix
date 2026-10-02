import { describe, expect, it } from 'vitest';
import { Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import { verifyWalletSignature } from '@/lib/wallet-signature';
import { resolveWalletInteractionMessage } from '@/lib/wallet-standard-message';

function toHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

describe('resolveWalletInteractionMessage', () => {
  it('verifies against Petra Web exact fullMessage without changing wallet framing', () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    const fullMessage =
      `APTOS\napp-specific heading\n${content}\nwallet nonce field: challenge`;
    expect(resolveWalletInteractionMessage(
      fullMessage,
      content,
      content,
      'challenge',
    )).toBe(fullMessage);
  });

  it('verifies the bytes Petra signed rather than a server-reconstructed frame', async () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    const fullMessage = `APTOS\ncustom Petra frame\nmessage: ${content}\nnonce: challenge`;
    const signer = Ed25519PrivateKey.generate();
    const signature = signer.sign(toHex(new TextEncoder().encode(fullMessage)));
    const messageToVerify = resolveWalletInteractionMessage(
      fullMessage,
      content,
      content,
      'challenge',
    );

    expect(messageToVerify).toBe(fullMessage);
    expect(messageToVerify).not.toBeNull();
    if (messageToVerify === null) {
      throw new Error('Expected the wallet-signed message to be accepted');
    }
    await expect(verifyWalletSignature({
      publicKey: toHex(signer.publicKey().toUint8Array()),
      signature: toHex(signature.toUint8Array()),
      message: messageToVerify,
    })).resolves.toEqual({ valid: true, scheme: 'ed25519' });
    await expect(verifyWalletSignature({
      publicKey: toHex(signer.publicKey().toUint8Array()),
      signature: toHex(signature.toUint8Array()),
      message: content,
    })).resolves.toMatchObject({ valid: false, reason: 'invalid' });
  });

  it('rejects action content that cannot be proven to be inside the signed message', () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    expect(resolveWalletInteractionMessage(
      'wallet fullMessage with no authorized action',
      content,
      content,
      'challenge',
    )).toBeNull();
  });

  it('requires the issued nonce inside both the requested and returned signed content', () => {
    const expected = 'ShelbyFlix session: different-nonce\n{"purpose":"Authorize"}';
    expect(resolveWalletInteractionMessage(
      `APTOS\nmessage: ${expected}\nnonce: challenge`,
      expected,
      expected,
      'challenge',
    )).toBeNull();
  });
});
