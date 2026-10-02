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

  it('does not rely on the wallet-reported message claim', () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    const fullMessage = `APTOS\nmessage: ${content}\nnonce: challenge`;
    expect(resolveWalletInteractionMessage(
      fullMessage,
      content,
      'challenge',
    )).toBe(fullMessage);
  });

  it('rejects a fullMessage that omits the requested action or payload', () => {
    expect(resolveWalletInteractionMessage(
      'APTOS\nmessage: ShelbyFlix session: challenge\nnonce: challenge',
      'ShelbyFlix session: challenge\n{"purpose":"Authorize"}',
      'challenge',
    )).toBeNull();
  });

  it('requires the expected signed action to contain the issued nonce', () => {
    const expected = 'ShelbyFlix session: different-nonce\n{"purpose":"Authorize"}';
    expect(resolveWalletInteractionMessage(
      `APTOS\nmessage: ${expected}\nnonce: challenge`,
      expected,
      'challenge',
    )).toBeNull();
  });
});
