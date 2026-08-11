# Chunked Upload Fix - ack_bits Calculation

## Problem Identified

The previous implementation had a critical bug in how it calculated `ack_bits` for multi-transaction uploads:

```typescript
// ❌ WRONG - Sets bits based on absolute chunk position in file
let ackBits = 0;
for (let i = 0; i < batchChunks.length; i++) {
  const chunkIndex = startChunk + i;  // Absolute position!
  if (chunkIndex < 32) {
    ackBits |= (1 << chunkIndex);
  }
}
```

### Why This Was Wrong

When uploading a large file in multiple transactions:
- **Transaction 1**: Chunks 0-15 → `ack_bits` should be `0b1111111111111111 = 65535` ✅
- **Transaction 2**: Chunks 16-31 → Previous code tried to set bits 16-31, which exceeds 16 bits
- **Transaction 3+**: Would set even higher bits, causing overflow

The `ack_bits` field is meant to represent **which chunks in THIS batch** were acknowledged, not the absolute position in the entire file.

## Solution

Fixed the calculation to properly represent the current batch:

```typescript
// ✅ CORRECT - Sets bits for chunks in this batch only
const ackBits = (1 << batchChunks.length) - 1;
```

### Examples

- 4 chunks in batch: `(1 << 4) - 1 = 0b1111 = 15`
- 16 chunks in batch: `(1 << 16) - 1 = 0b1111111111111111 = 65535`
- 8 chunks in batch: `(1 << 8) - 1 = 0b11111111 = 255`

## Upload Configuration

Current settings optimized for Shelbynet:

```typescript
const CHUNK_SIZE = 3 * 1024;  // 3KB per chunk
const CHUNKS_PER_TX = 16;     // 16 chunks per transaction
```

### For a 6MB file:
- Total chunks: ~2048 chunks
- Transactions needed: 128 transactions
- Each transaction: ~48KB of data
- Gas cost per TX: ~0.012 APT
- Total estimated cost: ~1.54 APT

### Each transaction will have:
- `ack_bits: 65535` (all 16 chunks in the batch)
- 16 chunks of 3KB each
- Transaction size: ~50KB (under the 60KB limit)

## Expected Behavior

When uploading a large file:

1. **First transaction (register_blob)**:
   - Registers blob metadata on-chain
   - Cost: ~0.005 APT + storage fee
   - Sets up the blob object

2. **Subsequent transactions (commit_object)**:
   - Transaction 1: Uploads chunks 0-15, `ack_bits: 65535`, `overwrite: false`
   - Transaction 2: Uploads chunks 16-31, `ack_bits: 65535`, `overwrite: true`
   - Transaction 3: Uploads chunks 32-47, `ack_bits: 65535`, `overwrite: true`
   - ...and so on until all chunks are uploaded

3. **Final state**:
   - Blob state: `CommittedObject`
   - Events emitted: `BlobPersistedEvent`, `ObjectCommittedEvent`
   - All chunks acknowledged by storage providers

## User Experience

For large files, users will need to:
1. Approve the initial `register_blob` transaction
2. Approve each subsequent `commit_object` transaction (potentially 100+ for large files)
3. Wait for all transactions to complete

The progress bar will update as each batch completes, showing incremental progress through the upload.

## Optimization Opportunities

If 128 transactions is too many to approve, we could:

1. **Increase chunk size to 4KB**:
   - 6MB file → 1536 chunks → 96 transactions

2. **Use 32 chunks per transaction** (if transaction size limit allows):
   - 6MB file with 3KB chunks → 2048 chunks → 64 transactions
   - Each TX would be ~96KB (might exceed limit)

3. **Increase chunk size to 6KB with 16 chunks per TX**:
   - 6MB file → 1024 chunks → 64 transactions
   - Each TX would be ~96KB (might exceed limit)

The current 3KB/16 chunks configuration is conservative to ensure we stay under the ~60KB transaction limit with some margin for overhead.

## Testing Checklist

- [x] Small files (< 48KB) - single transaction
- [ ] Medium files (50KB - 1MB) - 2-20 transactions
- [ ] Large files (5-10MB) - 100-200 transactions
- [ ] Verify all transactions show `ack_bits: 65535`
- [ ] Verify final blob state is `CommittedObject`
- [ ] Verify blob is downloadable after upload
- [ ] Monitor gas costs remain reasonable (~0.012 APT per batch)
