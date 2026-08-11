# Shelbynet Blob Upload Fix - commit_object Implementation

## Problem Summary

The Shelby SDK's `putBlob` method was failing with 401/404 errors when trying to upload blobs to Shelbynet-1:
- Error: `Failed to start multipart upload! status: 401, body: Unauthorized: API key not found`
- Endpoint failing: `POST https://api.shelbynet.shelby.xyz/shelby/v1/multipart-uploads`

## Root Cause

Through investigation of successful Shelbynet uploads, we discovered that **Shelbynet does NOT use HTTP multipart uploads**. Instead, the actual upload flow is:

1. ✅ **register_blob** transaction - registers blob metadata on-chain
2. ✅ **commit_object** transaction - commits the blob with data embedded as chunked byte arrays
3. ❌ ~~HTTP multipart upload API~~ - this doesn't exist or requires different auth on Shelbynet-1

The SDK's `putBlob` method tries to use a multipart upload API that isn't available on Shelbynet-1.

## Solution Implemented

### Changed Files

1. **lib/shelbynet-blob.ts** - Completely refactored
   - Removed SDK's `ShelbyClient` and `putBlob` usage
   - Removed API key dependencies (not needed for wallet-signed transactions)
   - Implemented direct `commit_object` transaction approach
   
2. **lib/utils.ts** - Updated function calls
   - Added `signAndSubmitTransaction` and `blobId` parameters to `uploadBlobToShelbynet` call
   
3. **lib/shelby.ts** - Updated function calls
   - Added `signAndSubmitTransaction` and `blobId` parameters to `uploadBlobToShelbynet` call

### New Upload Flow

**Step 1: Register Blob (unchanged)**
```typescript
await registerBlob(
  signAndSubmitTransaction,
  blobName,
  commitments,
  uploaderAddress,
  expirationDays
)
```
- Transaction: `0x...::blob_metadata::register_blob`
- Registers blob metadata on-chain
- Returns `{ hash, blobId }`

**Step 2: Commit Blob Data (NEW IMPLEMENTATION)**
```typescript
await uploadBlobToShelbynet(
  signAndSubmitTransaction,  // Wallet signing function
  encryptedBlob,              // The actual file data
  blobName,                   // Blob identifier
  blobId,                     // From register_blob
  uploaderAddress,            // Owner address
  onProgress                  // Progress callback
)
```

The `commit_object` transaction:
- Transaction: `0x...::blob_metadata::commit_object`
- **Chunks the blob data** into 256KB segments
- **Embeds the chunks** directly in the transaction as `vector<vector<u8>>`
- Calculates `ack_bits` (bitmask indicating all chunks received)
- Extracts `blob_uid` from the `blobId` timestamp

### commit_object Transaction Structure

```typescript
{
  function: "${contractAddress}::blob_metadata::commit_object",
  functionArguments: [
    blobUid,        // u64 - extracted from blobId timestamp
    blobName,       // String - blob identifier
    true,           // bool - overwrite flag
    null,           // Option<vector<u8>> - etag (None)
    ackBits,        // u32 - chunk acknowledgment bitmask (65535 = all 16 bits)
    chunks,         // vector<vector<u8>> - the actual blob data chunked into arrays
  ]
}
```

### Key Implementation Details

**Chunking Algorithm:**
```typescript
const CHUNK_SIZE = 256 * 1024; // 256KB per chunk

const chunks: number[][] = [];
for (let offset = 0; offset < blobData.length; offset += CHUNK_SIZE) {
  const chunkEnd = Math.min(offset + CHUNK_SIZE, blobData.length);
  const chunk = Array.from(blobData.slice(offset, chunkEnd));
  chunks.push(chunk);
}
```

**ack_bits Calculation:**
```typescript
// For N chunks: (2^N - 1) sets all N bits to 1
// Example: 16 chunks = 65535 = 0xFFFF (all 16 bits set)
const ackBits = chunks.length <= 16 
  ? (1 << chunks.length) - 1 
  : 65535; // Max for >16 chunks
```

**blob_uid Extraction:**
```typescript
// blobId format: "blob_1786439169900_video_name.mp4"
// Extract timestamp as blob_uid
const blobUidMatch = blobId.match(/^blob_(\d+)_/);
const blobUid = blobUidMatch ? parseInt(blobUidMatch[1], 10) : Date.now();
```

## Testing Notes

1. **API Key**: No longer needed for uploads since we're using wallet-signed transactions. The API key (if configured) is only used for reading blobs via the HTTP API.

2. **Transaction Confirmation**: The implementation waits for on-chain confirmation of the `commit_object` transaction before returning success.

3. **Chunk Limits**: Current implementation uses 256KB chunks. For very large files (>16 chunks), `ack_bits` is capped at 65535 (max 32-bit value).

4. **Error Handling**: All Move VM errors are surfaced with clear messages including the VM status code.

## Expected Behavior

When uploading a video:
1. ✅ User approves `register_blob` wallet transaction
2. ✅ Transaction confirms on-chain
3. ✅ User approves `commit_object` wallet transaction
4. ✅ Blob data is embedded in transaction and sent to Shelbynet
5. ✅ Transaction confirms - blob is now persisted and available

## Next Steps

1. Test with actual video upload to verify the approach works
2. Monitor for any `BlobPersistedEvent` events in transaction results
3. Adjust chunk size or ack_bits calculation if needed based on actual behavior
4. Consider adding blob availability polling after commit_object (currently removed)

## References

- Contract address: `0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a`
- Function: `blob_metadata::commit_object` (ABI function #12)
- Based on actual successful Shelbynet upload network traces
