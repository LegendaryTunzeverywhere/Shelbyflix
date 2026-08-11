# Shelbynet Blob Upload Fix - Summary

## Problem
The video uploads to Shelbynet were failing with the following issues:
1. **Type error in utils.ts**: Parameter order mismatch when calling `uploadBlobToShelbynet`
2. **Wallet error**: The `commit_object` transaction approach was failing with "undefined" wallet errors
3. **Videos not accessible**: After upload attempts, videos showed `ERR_FILE_NOT_FOUND`

## Root Cause Analysis
Based on investigation and the user's observation that successful Shelbynet uploads involve additional APTOS transactions:

The previous implementation tried to use `commit_object` transactions to directly embed blob data in chunks. However, this approach had two fundamental issues:
1. **Transaction size limits**: Large files would exceed Aptos transaction payload limits (even when chunked)
2. **Wrong upload mechanism**: `commit_object` is likely called by storage providers AFTER they receive the data, not as the upload mechanism itself

## Solution
Changed to use the **Shelby REST API for blob data upload**:

### Flow
1. ✅ `registerBlob` - Register blob metadata on-chain (already working)
2. ✅ **PUT to REST API** - Upload actual blob data to storage providers via REST endpoint
3. ⏳ Storage providers finalize the blob automatically

### Implementation Changes

#### 1. Fixed `utils.ts` Type Error (Line 111)
**Before:**
```typescript
(uploadProgress) => {
  onProgress?.({
    stage: 'uploading',
    progress: 50 + uploadProgress * 0.45,
    message: `Uploading to Shelbynet... ${uploadProgress}%`,
  });
}
```

**After:**
```typescript
(progress: number) => {
  onProgress?.({
    stage: 'uploading',
    progress: 50 + progress * 0.45,
    message: `Uploading to Shelbynet... ${Math.floor(progress)}%`,
  });
}
```

#### 2. Replaced `uploadBlobToShelbynet` in `shelbynet-blob.ts`
**Old approach:** Used `commit_object` transactions with chunked blob data
**New approach:** Uses direct REST API upload with `PUT` request

**New Upload Method:**
- Endpoint: `PUT {API_BASE}/shelby/v1/blobs/{account}/{blobName}`
- Headers:
  - `Content-Type: application/octet-stream`
  - `Authorization: Bearer {API_KEY}`
  - `X-Blob-Size: {size}`
- Body: Raw blob data as ArrayBuffer

**Benefits:**
- No transaction size limits
- Standard HTTP upload with progress tracking
- Storage providers handle finalization automatically
- Simpler error handling

## Environment Configuration
Ensure these are set in `.env.local`:

```env
# Shelby API endpoints
NEXT_PUBLIC_SHELBYNET_API_BASE=https://api.shelbynet.shelby.xyz

# API Key (AG- prefix format)
SHELBY_API_KEY=AG-FALFUBNZWGGGRWQSP7WDFXFNCHZNUD5CB
NEXT_PUBLIC_SHELBY_API_KEY=AG-FALFUBNZWGGGRWQSP7WDFXFNCHZNUD5CB

# Blob contract address
NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS=0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a
```

## Testing Instructions

### 1. Start the Development Server
```bash
npm run dev
```

### 2. Test Video Upload
1. Navigate to `/upload` page
2. Connect your Petra wallet
3. Select a video file (start with a small file ~5MB)
4. Fill in metadata (title, description, category)
5. Click "Upload Video"
6. Approve the `register_blob` transaction in your wallet
7. Watch the console logs and progress indicator

### 3. Expected Behavior
**Console Output:**
```
📝 Registering blob with primary contract: 0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a
⏳ Waiting for transaction: {hash}
✅ Transaction confirmed
📤 Starting Shelbynet blob upload
📦 Blob name: video_123_filename.mp4
📊 Blob size: 5971920 bytes
🔑 Using API key: AG-FALFUBR...
📍 Upload URL: https://api.shelbynet.shelby.xyz/shelby/v1/blobs/{address}/{blobName}
📤 Sending PUT request to Shelby storage API...
✅ Upload successful!
```

**UI Progress:**
- 0-40%: "Registering on Shelbynet... (approve wallet)"
- 40-50%: "Registration confirmed"
- 50-90%: "Uploading to Shelbynet storage..."
- 90-100%: "Finalizing..."
- 100%: "Upload complete!"

### 4. Verify Upload
After successful upload:
1. Check the video appears in your gallery
2. Try playing the video
3. Verify the video URL works: `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/{address}/{blobName}`

### 5. Common Errors to Watch For

**401 Unauthorized:**
- **Cause**: Invalid or missing API key
- **Fix**: Verify `SHELBY_API_KEY` in `.env.local` is correct

**404 Not Found:**
- **Cause**: Blob not registered on-chain before upload
- **Fix**: Ensure `registerBlob` completes successfully before data upload

**Network Error:**
- **Cause**: API endpoint unreachable
- **Fix**: Verify `NEXT_PUBLIC_SHELBYNET_API_BASE` is correct

## Next Steps If This Fails

If the REST API upload also fails with 401/404, we may need to:

1. **Check API Key Format**: 
   - Try the `aptoslabs_` format instead of `AG-` format
   - Verify the key is valid for Shelbynet (not testnet)

2. **Alternative: WebDAV Upload**:
   - Some Shelby deployments may use WebDAV protocol
   - Would need to implement DAV-compatible upload

3. **Contact Shelby Support**:
   - Get official documentation for the upload flow
   - Verify the correct API endpoint and authentication method

4. **Examine Successful Upload Network Traces**:
   - Use browser DevTools Network tab
   - Capture ALL requests (not just transactions) during a successful upload
   - Look for the actual data upload requests

## Additional Notes

- The SDK's `ShelbyBlobClient` only handles blockchain operations (`registerBlob`, `deleteBlob`, etc.)
- It does NOT handle actual blob data upload to storage providers
- The data upload must be done via REST API or another protocol
- Storage providers watch the chain for new blob registrations and expect data uploads at specific endpoints

## Files Changed
1. `lib/utils.ts` - Fixed type error in progress callback
2. `lib/shelbynet-blob.ts` - Replaced commit_object approach with REST API upload

## Monitoring
Watch these in browser console:
- 📝 Registration logs
- 📤 Upload progress logs
- ✅/❌ Success/error indicators
- Network tab for actual HTTP requests
