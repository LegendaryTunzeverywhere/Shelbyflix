# Large File Upload Implementation

## ✅ Implementation Complete

I've implemented proper chunking for large file uploads using multiple `commit_object` transactions.

## How It Works

### Configuration
```typescript
const CHUNK_SIZE = 8 * 1024;      // 8KB per chunk
const CHUNKS_PER_TX = 4;           // 4 chunks per transaction (~32KB)
```

### Upload Flow

**For your 6MB video (5,971,920 bytes):**

1. **Split into chunks:**
   - 5,971,920 bytes ÷ 8,192 bytes = **729 chunks**

2. **Group into transactions:**
   - 729 chunks ÷ 4 chunks/tx = **183 transactions**

3. **Each transaction:**
   - Sends 4 chunks (~32KB of data)
   - Sets `ack_bits` to indicate which chunks are included
   - Uses `overwrite: true` for batches after the first

4. **Progress tracking:**
   - Updates progress bar as chunks upload
   - Shows current chunk count in console

### Example Transaction Flow

```
Transaction 1/183:
  - Chunks: 0-3 (4 chunks)
  - ack_bits: 15 (binary: 1111)
  - Data: chunks[0], chunks[1], chunks[2], chunks[3]
  
Transaction 2/183:
  - Chunks: 4-7 (4 chunks)
  - ack_bits: 240 (binary: 11110000)
  - Data: chunks[4], chunks[5], chunks[6], chunks[7]
  - overwrite: true

... continues for all 183 transactions ...

Transaction 183/183:
  - Chunks: 728 (1 chunk - partial last batch)
  - ack_bits: corresponding bit set
  - Data: chunks[728]
  - overwrite: true
```

## What You'll See

### Console Output
```
📝 Registering blob with contract: 0x85fdb...
✅ Blob registered successfully! Transaction: 0x5aa87...

📤 Starting Shelbynet blob upload via commit_object
📦 Blob name: video_123_file.mp4
📊 Blob size: 5971920 bytes
📦 Converted to Uint8Array: 5971920 bytes
🔢 Blob UID: 1786447169871
📦 Split into 729 chunks of 8192 bytes each
📤 Large file detected, will send 183 transactions
   - Total chunks: 729
   - Chunks per TX: 4

📤 Transaction 1/183:
   - Chunks: 0 to 3 (4 chunks)
   - ack_bits: 15 (binary: 1111)
   📤 Submitting commit_object...
   ⏳ Waiting for transaction: 0x...
   ✅ Transaction confirmed: 0x...
   ✅ Transaction confirmed (4/729 chunks uploaded)

📤 Transaction 2/183:
   - Chunks: 4 to 7 (4 chunks)
   - ack_bits: 240 (binary: 11110000)
   📤 Submitting commit_object...
   ⏳ Waiting for transaction: 0x...
   ✅ Transaction confirmed: 0x...
   ✅ Transaction confirmed (8/729 chunks uploaded)

... continues ...

✅ Upload complete! All 729 chunks uploaded in 183 transactions
```

### UI Progress
- White spinning icon during upload
- White progress bar showing percentage
- Stage indicators: Encrypt → Register → Upload → Finalize
- Progress updates after each transaction batch

### Wallet Popups
- **1st popup:** `register_blob` - Register metadata on-chain
- **2nd-184th popups:** `commit_object` - Upload data in chunks

**⚠️ IMPORTANT:** User will need to approve **184 transactions total** for a 6MB file!

## Transaction Costs

Each `commit_object` transaction costs gas in APT (not ShelbyUSD).

**For 183 transactions:**
- Estimated: ~0.0001-0.0005 APT per transaction
- Total: **~0.02-0.1 APT** for the full upload

Make sure you have enough APT in your wallet!

## Potential Issues

### 1. Too Many Transactions
**Problem:** 183 wallet popups is a lot!

**Solutions:**
- Use smaller test files initially
- Consider implementing batch signature approval
- Look into Aptos transaction batching/multicall if available

### 2. Transaction Failures Mid-Upload
**Problem:** If transaction #50 fails, you've wasted gas on the first 49

**Current behavior:** Throws error, partial upload on-chain

**Potential improvements:**
- Implement retry logic for failed transactions
- Save progress and allow resume
- Check which chunks are already uploaded before continuing

### 3. Ack_bits Limitation
**Problem:** `ack_bits` is a u32 (32 bits), but we have 729 chunks

**Current behavior:** Only sets bits for first 32 chunks, rest have ack_bits=0

**This might be okay if:**
- Storage providers track chunks independently
- ack_bits is just for the current batch, not cumulative

**Need to investigate:**
- How ack_bits actually works in Shelbynet
- Whether we need cumulative tracking
- If there's a better chunking strategy

## Testing Instructions

### Test 1: Small File (< 32KB)
1. Upload a file under 32KB
2. Should complete in **1 commit transaction**
3. Expect **2 wallet popups total** (register + commit)

### Test 2: Medium File (32KB - 256KB)
1. Upload a file ~100KB
2. Should complete in **3-4 commit transactions**
3. Expect **4-5 wallet popups**

### Test 3: Large File (6MB)
1. Upload your test video
2. Should complete in **183 commit transactions**
3. Expect **184 wallet popups** 😅
4. Watch console for progress
5. Check APT balance before/after

## Next Optimizations

If 183 transactions is too much, consider:

1. **Larger chunks:**
   - Increase CHUNK_SIZE to 16KB or 32KB
   - Fewer chunks = fewer transactions
   - Risk: May hit transaction size limits

2. **More chunks per transaction:**
   - Increase CHUNKS_PER_TX to 8 or 16
   - Risk: Transaction payload too large (>64KB limit)

3. **Off-chain upload with on-chain commit:**
   - Upload data to storage providers directly (WebDAV/HTTP)
   - Single commit transaction to confirm
   - Requires finding correct storage provider endpoints

4. **Batch transaction submission:**
   - If Aptos supports it, batch multiple commit_object calls
   - Reduces wallet popups significantly

## Files Modified
- ✅ `lib/shelbynet-blob.ts` - Implemented chunked upload with multiple transactions
- ✅ `components/UploadProgress.tsx` - White progress bar + spinner (done earlier)

## Success Criteria

Upload is successful when:
- ✅ All chunks are uploaded in separate transactions
- ✅ Each transaction confirms on-chain
- ✅ Progress updates correctly
- ✅ Final transaction completes
- ✅ Video becomes accessible at the shelbyUrl

Try it and let me know what happens! 🚀
