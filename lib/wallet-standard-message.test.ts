import { describe, expect, it } from 'vitest';
import { Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import { verifyWalletSignature } from '@/lib/wallet-signature';
import { resolveWalletInteractionMessages } from '@/lib/wallet-standard-message';

function toHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

describe('resolveWalletInteractionMessages', () => {
  it('verifies against Petra Web exact fullMessage without changing wallet framing', () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    const fullMessage =
      `APTOS\napp-specific heading\n${content}\nwallet nonce field: challenge`;
    expect(resolveWalletInteractionMessages(
      fullMessage,
      content,
      'challenge',
    )).toEqual([fullMessage, content]);
  });

  it('verifies the bytes Petra signed rather than a server-reconstructed frame', async () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    const fullMessage = `APTOS\ncustom Petra frame\nmessage: ${content}\nnonce: challenge`;
    const signer = Ed25519PrivateKey.generate();
    const signature = signer.sign(toHex(new TextEncoder().encode(fullMessage)));
    const messagesToVerify = resolveWalletInteractionMessages(
      fullMessage,
      content,
      'challenge',
    );

    expect(messagesToVerify).toEqual([fullMessage, content]);
    await expect(verifyWalletSignature({
      publicKey: toHex(signer.publicKey().toUint8Array()),
      signature: toHex(signature.toUint8Array()),
      message: messagesToVerify[0],
    })).resolves.toEqual({ valid: true, scheme: 'ed25519' });
    await expect(verifyWalletSignature({
      publicKey: toHex(signer.publicKey().toUint8Array()),
      signature: toHex(signature.toUint8Array()),
      message: content,
    })).resolves.toMatchObject({ valid: false, reason: 'invalid' });
  });

  it('verifies the exact requested content when Petra omits it from fullMessage', async () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    const fullMessage = 'wallet-generated signature framing';
    const signer = Ed25519PrivateKey.generate();
    const signature = signer.sign(toHex(new TextEncoder().encode(content)));
    const messagesToVerify = resolveWalletInteractionMessages(
      fullMessage,
      content,
      'challenge',
    );

    expect(messagesToVerify).toEqual([content]);
    await expect(verifyWalletSignature({
      publicKey: toHex(signer.publicKey().toUint8Array()),
      signature: toHex(signature.toUint8Array()),
      message: messagesToVerify[0],
    })).resolves.toEqual({ valid: true, scheme: 'ed25519' });
  });

  it('accepts CRLF framing while preserving exact message bytes', () => {
    const expected = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    const fullMessage = `APTOS\r\nmessage: ${expected.replace(/\n/g, '\r\n')}\r\nnonce: challenge`;
    expect(resolveWalletInteractionMessages(
      fullMessage,
      expected,
      'challenge',
    )).toEqual([fullMessage, expected]);
  });

  it('does not allow a fallback message without the exact requested action or payload', () => {
    expect(resolveWalletInteractionMessages(
      'APTOS\nmessage: ShelbyFlix session: challenge\nnonce: challenge',
      'ShelbyFlix session: challenge\n{"purpose":"Authorize"}',
      'challenge',
    )).toEqual(['ShelbyFlix session: challenge\n{"purpose":"Authorize"}']);
  });

  it('requires the expected signed action to contain the issued nonce', () => {
    const expected = 'ShelbyFlix session: different-nonce\n{"purpose":"Authorize"}';
    expect(resolveWalletInteractionMessages(
      `APTOS\nmessage: ${expected}\nnonce: challenge`,
      expected,
      'challenge',
    )).toEqual([]);
  });
});
