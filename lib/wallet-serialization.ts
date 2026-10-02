function asBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}

export function serializeWalletValue(
  value: unknown,
  encoding: 'hex' | 'utf8' | 'signature' | 'publicKey',
): string {
  if (typeof value === 'string') return value;

  const directBytes = asBytes(value);
  if (directBytes) {
    return encoding === 'utf8'
      ? new TextDecoder().decode(directBytes)
      : `0x${Array.from(directBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  if (value && typeof value === 'object') {
    const candidate = value as {
      bcsToBytes?: () => Uint8Array;
      toUint8Array?: () => Uint8Array;
      signature?: unknown;
    };
    const isAnySignature =
      'signature' in candidate &&
      candidate.signature != null &&
      typeof candidate.signature === 'object';
    // AnySignature's toUint8Array() is deprecated and BCS bytes preserve its
    // variant tag; Petra's Ed25519 signatures keep their raw-byte encoding.
    const bytes = asBytes(isAnySignature
      ? (candidate.bcsToBytes?.() ?? candidate.toUint8Array?.())
      : (candidate.toUint8Array?.() ?? candidate.bcsToBytes?.()));

    if (bytes) {
      return encoding === 'utf8'
        ? new TextDecoder().decode(bytes)
        : `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    }
  }

  return String(value);
}
