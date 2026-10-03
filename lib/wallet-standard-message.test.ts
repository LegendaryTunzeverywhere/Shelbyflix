import { describe, expect, it } from 'vitest';
import { Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import { verifyWalletSignature } from '@/lib/wallet-signature';
import {
  resolveWalletInteractionMessages,
  walletFullMessageBindsAction,
  walletFullMessageIncludes,
} from '@/lib/wallet-standard-message';

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
    )).toEqual([fullMessage]);
    expect(walletFullMessageBindsAction(fullMessage, content, 'challenge')).toBe(true);
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

    expect(messagesToVerify).toEqual([fullMessage]);
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

  it('does not substitute the requested text when fullMessage omits it', async () => {
    const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    const fullMessage = 'wallet-generated signature framing';
    const messagesToVerify = resolveWalletInteractionMessages(
      fullMessage,
      content,
      'challenge',
    );

    expect(messagesToVerify).toEqual([fullMessage]);
    expect(walletFullMessageBindsAction(fullMessage, content, 'challenge')).toBe(false);
  });

  it('accepts CRLF framing for binding while preserving exact message bytes', () => {
    const expected = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
    const fullMessage = `APTOS\r\nmessage: ${expected.replace(/\n/g, '\r\n')}\r\nnonce: challenge`;
    expect(resolveWalletInteractionMessages(
      fullMessage,
      expected,
      'challenge',
    )).toEqual([fullMessage]);
    expect(walletFullMessageBindsAction(fullMessage, expected, 'challenge')).toBe(true);
  });

  it('does not allow a fallback message without the exact requested action or payload', () => {
    expect(resolveWalletInteractionMessages(
      'APTOS\nmessage: ShelbyFlix session: challenge\nnonce: challenge',
      'ShelbyFlix session: challenge\n{"purpose":"Authorize"}',
      'challenge',
    )).toEqual(['APTOS\nmessage: ShelbyFlix session: challenge\nnonce: challenge']);
    expect(walletFullMessageBindsAction(
      'APTOS\nmessage: ShelbyFlix session: challenge\nnonce: challenge',
      'ShelbyFlix session: challenge\n{"purpose":"Authorize"}',
      'challenge',
    )).toBe(false);
  });

  it('requires the expected signed action to contain the issued nonce', () => {
    const expected = 'ShelbyFlix session: different-nonce\n{"purpose":"Authorize"}';
    expect(resolveWalletInteractionMessages(
      `APTOS\nmessage: ${expected}\nnonce: challenge`,
      expected,
      'challenge',
    )).toEqual([]);
    expect(walletFullMessageBindsAction(
      `APTOS\nmessage: ${expected}\nnonce: challenge`,
      expected,
      'challenge',
    )).toBe(false);
  });
});

// Aptos Connect's hosted prompt (web.petra.app, behind "Continue with
// Google"/"Continue with Apple") frames the request's raw bytes with
// Hex.fromHexInput(bytes).toString(), so its signed frame carries
// `message: 0x…` / `nonce: 0x…` while the prompt UI shows the decoded text.
describe('hex-encoded wallet frames', () => {
  const content = 'ShelbyFlix session: challenge\n{"purpose":"Authorize"}';
  const fullMessage = [
    'APTOS',
    'address: 0x1234',
    'application: https://shelbyflix.vercel.app',
    'chainId: 4',
    `message: 0x${Buffer.from(content, 'utf8').toString('hex')}`,
    `nonce: 0x${Buffer.from('challenge', 'utf8').toString('hex')}`,
  ].join('\n');

  it('finds the literal text as well as its hex-encoded form', () => {
    expect(walletFullMessageIncludes(fullMessage, 'ShelbyFlix session: challenge')).toBe(true);
    expect(walletFullMessageIncludes(fullMessage, '{"purpose":"Authorize"}')).toBe(true);
    expect(walletFullMessageIncludes(fullMessage, 'challenge')).toBe(true);
    expect(walletFullMessageIncludes(fullMessage, 'ShelbyFlix comment: challenge')).toBe(false);
  });

  it('binds action, payload and nonce through the hex-encoded message line', () => {
    expect(walletFullMessageBindsAction(fullMessage, content, 'challenge')).toBe(true);
  });

  it('tolerates a wallet that upper-cases its hex', () => {
    expect(walletFullMessageBindsAction(fullMessage.toUpperCase(), content, 'challenge')).toBe(true);
  });

  it('still rejects frames that carry different content', () => {
    expect(walletFullMessageBindsAction(
      fullMessage,
      'ShelbyFlix session: other\n{"purpose":"Authorize"}',
      'other',
    )).toBe(false);
    expect(walletFullMessageBindsAction(fullMessage, content, 'other')).toBe(false);
  });

  it('verifies the signed frame bytes and then binds them', async () => {
    const signer = Ed25519PrivateKey.generate();
    const signature = signer.sign(toHex(new TextEncoder().encode(fullMessage)));
    const messagesToVerify = resolveWalletInteractionMessages(fullMessage, content, 'challenge');

    expect(messagesToVerify).toEqual([fullMessage]);
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
    expect(walletFullMessageBindsAction(fullMessage, content, 'challenge')).toBe(true);
  });
});
