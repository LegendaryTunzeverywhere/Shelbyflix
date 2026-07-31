# ShelbyFlix Architecture: Shelby Storage + Supabase

This document explains how ShelbyFlix uses both **Shelby decentralized storage** (blockchain) and **Supabase** (traditional database/API) together.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         USER UPLOADS VIDEO                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (Browser / React)                  │
│  - UploadForm.tsx collects metadata + video file             │
│  - Calls uploadToShelby() function                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   LIB/SHELBY.TS (Upload Logic)               │
│                                                               │
│  Step 1: Encrypt video file (client-side)                    │
│  Step 2: Generate thumbnail                                  │
│  Step 3: Upload encrypted video to Shelby Storage Network    │
│  Step 4: Register blob metadata on Shelby blockchain         │
│  Step 5: Return videoId, blobId, shelbyUrl, encryptionKey    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                LIB/VIDEO-SERVICE.TS (saveVideo)              │
│                                                               │
│  Calls: POST /api/videos with metadata                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│               APP/API/VIDEOS/ROUTE.TS (Server)               │
│                                                               │
│  Uses service role to insert into Supabase:                  │
│  - video_id, blob_id, blob_name                              │
│  - title, description, category, tags                        │
│  - shelby_url, encryption_key                                │
│  - thumbnail_url, duration                                   │
│  - access_mode, price, allowlist, unlock_at                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE (PostgreSQL)                     │
│                                                               │
│  Stores: Video metadata for fast querying/listing            │
└─────────────────────────────────────────────────────────────┘
```

---

## What's Stored Where?

### 🔗 **Shelby Storage Network (Blockchain)**

**File:** `lib/shelby.ts`, `lib/shelbynet-blob.ts`

**What's stored:**
1. **Encrypted video file** - The actual video content (encrypted)
2. **Blob metadata** - On-chain record with:
   - `blob_id` - Unique identifier
   - `blob_name` - Human-readable name
   - `owner` - Wallet address of uploader
   - `size` - File size in bytes
   - `access_policy` - Access control rules (public/allowlist/timelock/purchasable)
   - `green_box_*` - Encryption metadata
3. **Access control policies** - Who can access the video

**Why blockchain?**
- ✅ **Decentralized** - No single point of failure
- ✅ **Immutable** - Can't be censored or deleted by a third party
- ✅ **Verifiable** - Cryptographic proof of ownership
- ✅ **Pay-per-use** - Users pay for storage with ShelbyUSD tokens

**Contract Addresses:**
```env
NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS=0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a
NEXT_PUBLIC_ACCESS_CONTROL_MODULE_ADDRESS=0x8e09cdeebdebcf4885c8d6b8a388a7a01e1b8c9327c886ea234b5d92bfa8d652
```

---

### 💾 **Supabase (Traditional Database)**

**Files:** `lib/video-service.ts`, `app/api/videos/route.ts`

**What's stored:**
1. **Video metadata** - Fast queries for:
   - Title, description, category, tags
   - Duration, thumbnail URL
   - Upload timestamp, views, likes, comments
   - Channel info, uploader wallet
2. **References to Shelby** - Links to blockchain:
   - `blob_id` - Points to Shelby blob
   - `blob_name` - Shelby blob identifier
   - `shelby_url` - Full URL to retrieve video
   - `encryption_key` - Used to decrypt video after download
3. **Access control cache** - Mirror of blockchain state:
   - `access_mode` - public/allowlist/timelock/purchasable
   - `price` - Cost to purchase (in ShelbyUSD)
   - `allowlist` - Wallet addresses with access
   - `unlock_at` - Time-locked release timestamp
4. **Purchase receipts** - `video_purchases` table:
   - Verified on-chain payments
   - Prevents re-verification for every view

**Why Supabase?**
- ✅ **Fast queries** - List/search/filter videos instantly
- ✅ **Complex queries** - Search by category, trending, recent, etc.
- ✅ **Traditional features** - Comments, likes, user profiles
- ✅ **Cost-effective** - Don't pay blockchain fees for every query

---

## Data Flow Examples

### 📤 **Upload Flow**

```typescript
// 1. USER uploads video via UploadForm.tsx
const result = await uploadToShelby(
  file,
  metadata,
  address,
  signAndSubmitTransaction,
  setUploadProgress
);

// ↓ Inside uploadToShelby() (lib/shelby.ts):

// 2. ENCRYPT video file (client-side)
const encryptedVideo = await encryptData(videoBuffer, encryptionKey);

// 3. UPLOAD to Shelby Storage Network
const uploadResponse = await uploadBlob(
  encryptedVideo,
  metadata,
  shelbyApiKey
);

// 4. REGISTER blob on blockchain (Move contract)
const txResult = await signAndSubmitTransaction({
  function: `${ACCESS_CONTROL_MODULE}::register_blob_v2`,
  arguments: [
    videoId,
    blobName,
    accessPolicy, // Access control rules
  ],
});

// 5. RETURN blockchain references
return {
  videoId,
  blobId,
  blobName,
  shelbyUrl,     // URL to retrieve from Shelby
  encryptionKey, // Key to decrypt after download
};

// 6. SAVE to Supabase (lib/video-service.ts)
await saveVideo({
  videoId,
  blobId,
  shelbyUrl,
  encryptionKey,
  title,
  description,
  // ... other metadata
});

// ↓ saveVideo() calls API route:

// 7. API ROUTE inserts into Supabase (app/api/videos/route.ts)
const { data, error } = await supabaseAdmin.from('videos').insert({
  video_id,
  blob_id,
  shelby_url,
  encryption_key,
  // ... metadata
});
```

---

### 📥 **Video Playback Flow**

```typescript
// 1. USER clicks video in gallery
// Gallery fetches from Supabase (fast query):
const videos = await getAllVideos(); // lib/video-service.ts

// 2. USER navigates to /video/[id]
const video = await getVideoById(videoId); // From Supabase

// 3. CHECK access permissions
// Option A: Read from Supabase cache (fast)
if (video.accessMode === 'public') {
  // Allow playback
}

// Option B: Verify on blockchain (authoritative)
const accessConfig = await resolveAccess(videoId); // lib/move-contract-backend.ts
// Reads BlobMetadataV2 from Shelby blockchain

// 4. VERIFY purchase (if purchasable)
const hasPurchased = await checkPurchaseReceipt(videoId, walletAddress);
// Checks Supabase video_purchases table
// (Receipts verified on-chain, then cached in DB)

// 5. DOWNLOAD encrypted video from Shelby
const encryptedBlob = await fetch(video.shelbyUrl);

// 6. DECRYPT video (client-side)
const decryptedVideo = await decryptData(
  encryptedBlob,
  video.encryptionKey
);

// 7. PLAY video in browser
<video src={decryptedVideoUrl} controls />
```

---

### 💰 **Purchase Flow (Purchasable Videos)**

```typescript
// 1. USER clicks "Purchase Video"
// PurchaseGate.tsx initiates purchase

// 2. SUBMIT purchase transaction on blockchain
const txHash = await signAndSubmitTransaction({
  function: `${ACCESS_CONTROL_MODULE}::purchase_access`,
  arguments: [
    videoId,
    priceAmount, // ShelbyUSD tokens
  ],
});

// 3. VERIFY purchase on blockchain
const response = await fetch('/api/payments/verify', {
  method: 'POST',
  body: JSON.stringify({
    txHash,
    videoId,
    walletAddress,
  }),
});

// ↓ Inside /api/payments/verify/route.ts:

// 4. READ blockchain transaction
const txDetails = await aptosClient.getTransactionByHash(txHash);

// 5. VERIFY it's a valid purchase event
// - Check correct contract/function
// - Verify videoId matches
// - Confirm payment amount
// - Check buyer wallet

// 6. SAVE receipt to Supabase (video_purchases table)
await supabaseAdmin.from('video_purchases').insert({
  video_id: videoId,
  wallet_address: walletAddress,
  tx_hash: txHash,
  amount_total: price,
  // ...
});

// 7. ALLOW playback
// Next time user views video, check video_purchases table (fast)
// instead of re-verifying blockchain transaction
```

---

## Key Files & Their Roles

### **Shelby Blockchain Integration**

| File | Purpose |
|------|---------|
| `lib/shelby.ts` | Main upload logic, encryption, blob registration |
| `lib/shelbynet-blob.ts` | Low-level blob upload/download from Shelby network |
| `lib/move-contract-backend.ts` | Read access policies from blockchain |
| `lib/move-bcs.ts` | Binary serialization for Move contract calls |
| `lib/aptos-client.ts` | Aptos blockchain client wrapper |

### **Supabase Database Integration**

| File | Purpose |
|------|---------|
| `lib/video-service.ts` | CRUD operations for videos (calls API) |
| `lib/supabase.ts` | Anon Supabase client (read-only) |
| `lib/supabase-admin.ts` | Service role client (write access) |
| `app/api/videos/route.ts` | API endpoint to insert/query videos |
| `app/api/payments/verify/route.ts` | Verify purchases, save receipts |

### **Access Control**

| File | Purpose |
|------|---------|
| `lib/access-resolver.ts` | Unified interface for access checks |
| `app/api/videos/[id]/access-config/route.ts` | Get access config for a video |
| `app/api/auth/check-access/route.ts` | Verify user has access |
| `components/PurchaseGate.tsx` | UI for purchasing access |

---

## Hybrid Architecture Benefits

### 🎯 **Best of Both Worlds**

| Feature | Shelby (Blockchain) | Supabase (Database) |
|---------|---------------------|---------------------|
| **Video storage** | ✅ Decentralized, immutable | ❌ |
| **Access control** | ✅ Cryptographically enforced | 📋 Cached copy |
| **Ownership proof** | ✅ On-chain verification | ❌ |
| **Fast queries** | ❌ Slow, expensive | ✅ Instant |
| **Search/filter** | ❌ Complex, limited | ✅ Full SQL |
| **Comments/likes** | ❌ Expensive | ✅ Traditional features |
| **Cost** | 💰 Pay per storage/access | 💰 Fixed monthly |

---

## Move Contract Functions Used

### **Blob Registration** (`register_blob_v2`)
```move
public entry fun register_blob_v2(
    owner: &signer,
    blob_id: String,
    blob_name: String,
    size: u64,
    green_box_scheme: u8,
    green_box_bytes: vector<u8>,
    access_policy: AccessPolicy,
)
```

**Called when:** Uploading a video

**Purpose:** Register blob metadata and access policy on-chain

---

### **Update Access Policy** (`force_update_policy_v2`)
```move
public entry fun force_update_policy_v2(
    owner: &signer,
    blob_name: String,
    new_policy: AccessPolicy,
)
```

**Called when:** Creator changes access mode/price/allowlist

**Purpose:** Update access control rules

---

### **Purchase Access** (`purchase_access`)
```move
public entry fun purchase_access(
    buyer: &signer,
    blob_name: String,
    amount: u64,
)
```

**Called when:** User buys access to a video

**Purpose:** Transfer ShelbyUSD tokens, emit purchase event

---

### **Delete Blob** (`delete_blob`)
```move
public entry fun delete_blob(
    owner: &signer,
    blob_name: String,
)
```

**Called when:** Creator deletes their video

**Purpose:** Remove blob metadata from chain

---

## Environment Variables

### **Shelby Network**
```env
NEXT_PUBLIC_SHELBYNET_NODE_URL=https://api.testnet.aptoslabs.com/v1
NEXT_PUBLIC_SHELBYNET_INDEXER_URL=https://api.testnet.aptoslabs.com/v1/graphql
SHELBY_API_KEY=aptoslabs_...
```

### **Smart Contracts**
```env
NEXT_PUBLIC_ACCESS_CONTROL_MODULE_ADDRESS=0x5211945b...
NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS=0x85fdb9a1...
NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS=0x1b18363a...
```

### **Supabase**
```env
NEXT_PUBLIC_SUPABASE_URL=https://gmxmjlpbxxyzkqtkchtc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci... (server-only!)
```

### **Access Backend Selection**
```env
NEXT_PUBLIC_ACCESS_BACKEND=move  # or "supabase"
```
- `move` = Read access policies from blockchain (authoritative)
- `supabase` = Read from database cache (faster, but trust DB)

---

## Summary

**ShelbyFlix uses a hybrid architecture:**

1. **Shelby Storage Network** (blockchain/decentralized):
   - Stores encrypted video files
   - Enforces access control policies
   - Provides ownership verification
   - Handles payments via ShelbyUSD tokens

2. **Supabase** (traditional database):
   - Stores video metadata for fast queries
   - Caches access control policies
   - Stores purchase receipts (verified on-chain)
   - Handles social features (comments, likes)

**Why both?**
- **Blockchain** ensures decentralization, immutability, and trust
- **Database** provides speed, convenience, and traditional features
- **Together** they create a practical decentralized video platform

The encryption key is stored in Supabase (with proper access control) so only authorized users can decrypt videos after downloading from Shelby storage.
