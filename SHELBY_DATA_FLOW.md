# ShelbyFlix Complete Data Flow

## 🎬 Video Upload Journey

```
┌──────────────┐
│   Browser    │  User selects video file + fills metadata
│ UploadForm   │  (title, description, category, access mode, price)
└──────┬───────┘
       │
       │ uploadToShelby(file, metadata, wallet)
       ↓
┌──────────────────────────────────────────────────────────────┐
│                    lib/shelby.ts                              │
│                                                                │
│  1. Generate encryption key (AES-256)                         │
│     const key = crypto.getRandomValues(new Uint8Array(32))    │
│                                                                │
│  2. Encrypt video file (client-side)                          │
│     const encrypted = await encryptData(videoBuffer, key)     │
│                                                                │
│  3. Generate thumbnail from video                             │
│     const thumbnail = await generateThumbnail(file)           │
│                                                                │
│  4. Upload encrypted video to Shelby Storage                  │
│     POST https://api.testnet.shelby.xyz/upload                │
│     Headers: { "shelby-api-key": "aptoslabs_..." }            │
│     Body: encrypted video bytes                               │
│     ← Response: { blobId, shelbyUrl }                         │
│                                                                │
│  5. Map access mode to Move AccessPolicy                      │
│     public     → PayToDownload { price: 0 }                   │
│     purchasable→ PayToDownload { price: X }                   │
│     allowlist  → Allowlist { addresses: [...] }               │
│     timelock   → TimeLock { locked_until: timestamp }         │
│                                                                │
│  6. Sign & submit blockchain transaction                      │
│     ┌────────────────────────────────────────────┐            │
│     │  Aptos Wallet (Petra, Martian, etc.)      │            │
│     │  User approves transaction signature      │            │
│     └────────────────────────────────────────────┘            │
│     ↓                                                          │
│     Entry function: register_blob_v2                          │
│     Module: 0x5211945b...::access_control                     │
│     Arguments: [videoId, blobName, accessPolicy]              │
│     ← Response: { txHash, version }                           │
│                                                                │
│  7. Return result                                             │
│     { videoId, blobId, shelbyUrl, encryptionKey, ... }        │
└──────┬───────────────────────────────────────────────────────┘
       │
       │ Upload successful, now save metadata
       ↓
┌──────────────────────────────────────────────────────────────┐
│              lib/video-service.ts                             │
│                                                                │
│  saveVideo(metadata) {                                        │
│    await fetch('/api/videos', {                               │
│      method: 'POST',                                          │
│      body: JSON.stringify({                                   │
│        video_id,                                              │
│        blob_id,           ← From Shelby                       │
│        blob_name,         ← From Shelby                       │
│        shelby_url,        ← From Shelby                       │
│        encryption_key,    ← Generated client-side             │
│        title,                                                 │
│        description,                                           │
│        category,                                              │
│        tags,                                                  │
│        price,                                                 │
│        access_mode,       ← public/allowlist/timelock/...     │
│        allowlist,                                             │
│        unlock_at,                                             │
│        uploader_wallet,                                       │
│        ...                                                    │
│      })                                                       │
│    })                                                         │
│  }                                                            │
└──────┬───────────────────────────────────────────────────────┘
       │
       │ HTTP POST /api/videos
       ↓
┌──────────────────────────────────────────────────────────────┐
│           app/api/videos/route.ts (Server-side)               │
│                                                                │
│  1. Get service role Supabase client                          │
│     const supabaseAdmin = getSupabaseAdmin()                  │
│     Uses: SUPABASE_SERVICE_ROLE_KEY env var                   │
│                                                                │
│  2. Insert video metadata into database                       │
│     const { data, error } = await supabaseAdmin               │
│       .from('videos')                                         │
│       .insert({                                               │
│         video_id,                                             │
│         blob_id,                                              │
│         shelby_url,                                           │
│         encryption_key,                                       │
│         title,                                                │
│         description,                                          │
│         category,                                             │
│         price,                                                │
│         access_mode,                                          │
│         ...                                                   │
│       })                                                      │
│                                                                │
│  3. Return success                                            │
│     return NextResponse.json({ success: true })               │
└──────┬───────────────────────────────────────────────────────┘
       │
       │ RLS Policy: "Service role full access" allows insert
       ↓
┌──────────────────────────────────────────────────────────────┐
│               Supabase PostgreSQL Database                    │
│                                                                │
│  Table: videos                                                │
│  ┌────────────────────────────────────────────────────┐      │
│  │ video_id         │ "vid_abc123"                    │      │
│  │ blob_id          │ "blob_xyz789"                   │      │
│  │ blob_name        │ "blob_vid_abc123_1234567890"    │      │
│  │ shelby_url       │ "https://storage.shelby.xyz..." │      │
│  │ encryption_key   │ "base64_encoded_key..."         │      │
│  │ title            │ "My Awesome Video"              │      │
│  │ description      │ "This is a great video about..."│      │
│  │ category         │ "EDUCATION"                     │      │
│  │ tags             │ ["tutorial", "coding"]          │      │
│  │ price            │ 1000000000 (10 ShelbyUSD)       │      │
│  │ access_mode      │ "purchasable"                   │      │
│  │ uploader_wallet  │ "0x1234..."                     │      │
│  │ upload_timestamp │ 1738206660000                   │      │
│  │ views            │ 0                               │      │
│  │ likes            │ 0                               │      │
│  └────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘

SIMULTANEOUSLY stored on Aptos blockchain:

┌──────────────────────────────────────────────────────────────┐
│          Aptos Blockchain (Shelby Access Control)            │
│                                                                │
│  Module: 0x5211945b...::access_control                        │
│                                                                │
│  Resource: BlobRegistry                                       │
│  ┌────────────────────────────────────────────────────┐      │
│  │ blob_name: "blob_vid_abc123_1234567890"            │      │
│  │ BlobMetadataV2 {                                   │      │
│  │   owner: 0x1234...,                                │      │
│  │   size: 157286400,                                 │      │
│  │   creation_timestamp_us: 1738206660000000,         │      │
│  │   access_policy: PayToDownload {                   │      │
│  │     price: 1000000000                              │      │
│  │   },                                               │      │
│  │   green_box_scheme: 0,                             │      │
│  │   green_box_bytes: []                              │      │
│  │ }                                                  │      │
│  └────────────────────────────────────────────────────┘      │
│                                                                │
│  Events emitted:                                              │
│  - BlobRegistered { blob_name, owner, size, ... }             │
└──────────────────────────────────────────────────────────────┘

          ✅ Upload Complete!
          Video is now:
          - Encrypted & stored on Shelby network
          - Registered on blockchain with access policy
          - Metadata indexed in Supabase for fast queries
```

---

## 📺 Video Playback Journey

```
┌──────────────┐
│   Browser    │  User navigates to /gallery
└──────┬───────┘
       │
       │ GET /gallery
       ↓
┌──────────────────────────────────────────────────────────────┐
│             app/gallery/page.tsx                              │
│                                                                │
│  const videos = await getAllVideos()                          │
└──────┬───────────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────────┐
│           lib/video-service.ts                                │
│                                                                │
│  getAllVideos() {                                             │
│    return supabase                                            │
│      .from('videos')                                          │
│      .select('*')                                             │
│      .gt('expiration_timestamp', Date.now())  ← Not expired   │
│      .order('upload_timestamp', { ascending: false })         │
│  }                                                            │
└──────┬───────────────────────────────────────────────────────┘
       │
       ↓ Query Supabase (fast!)
┌──────────────────────────────────────────────────────────────┐
│                    Supabase Database                          │
│                                                                │
│  Returns list of videos:                                      │
│  [{ video_id, title, thumbnail_url, views, ... }, ...]        │
└──────┬───────────────────────────────────────────────────────┘
       │
       │ Render gallery
       ↓
┌──────────────┐
│   Browser    │  User clicks on a video
│   Gallery    │  Navigate to /video/[id]
└──────┬───────┘
       │
       ↓
┌──────────────────────────────────────────────────────────────┐
│          app/video/[id]/page.tsx                              │
│                                                                │
│  1. Fetch video metadata                                      │
│     const video = await getVideoById(videoId)                 │
│                                                                │
│  2. Check access permissions                                  │
│     - If access_mode === 'public' → Allow                     │
│     - If access_mode === 'purchasable' → Check purchase       │
│     - If access_mode === 'allowlist' → Check allowlist        │
│     - If access_mode === 'timelock' → Check unlock_at         │
└──────┬───────────────────────────────────────────────────────┘
       │
       │ If access_mode === 'purchasable' && not purchased yet
       ↓
┌──────────────────────────────────────────────────────────────┐
│          components/PurchaseGate.tsx                          │
│                                                                │
│  1. Show purchase UI                                          │
│     "Purchase for 10 ShelbyUSD"                               │
│                                                                │
│  2. User clicks "Purchase"                                    │
│                                                                │
│  3. Call blockchain purchase function                         │
│     const tx = await signAndSubmitTransaction({               │
│       function: `${MODULE}::purchase_access`,                 │
│       arguments: [blobName, price]                            │
│     })                                                        │
│     ← Response: { hash: "0xabc..." }                          │
│                                                                │
│  4. Verify purchase on backend                                │
│     await fetch('/api/payments/verify', {                     │
│       method: 'POST',                                         │
│       body: JSON.stringify({ txHash, videoId, wallet })       │
│     })                                                        │
└──────┬───────────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────────┐
│        app/api/payments/verify/route.ts                       │
│                                                                │
│  1. Fetch transaction from blockchain                         │
│     const tx = await aptosClient.getTransactionByHash(hash)   │
│                                                                │
│  2. Verify transaction details                                │
│     - Correct contract function                               │
│     - Correct video (blob_name)                               │
│     - Correct price paid                                      │
│     - Buyer wallet matches                                    │
│                                                                │
│  3. Save purchase receipt to Supabase                         │
│     await supabaseAdmin.from('video_purchases').insert({      │
│       video_id,                                               │
│       wallet_address,                                         │
│       tx_hash,                                                │
│       amount_total: price,                                    │
│       ...                                                     │
│     })                                                        │
│                                                                │
│  4. Return success                                            │
└──────┬───────────────────────────────────────────────────────┘
       │
       │ Purchase verified & saved
       ↓
┌──────────────────────────────────────────────────────────────┐
│          Supabase video_purchases table                       │
│                                                                │
│  ┌───────────────────────────────────────────────────┐       │
│  │ video_id: "vid_abc123"                            │       │
│  │ wallet_address: "0x1234..."                       │       │
│  │ tx_hash: "0xabc..."                               │       │
│  │ amount_total: 1000000000                          │       │
│  │ created_at: "2026-07-30T02:31:00Z"                │       │
│  └───────────────────────────────────────────────────┘       │
│                                                                │
│  Future checks: Fast DB lookup instead of blockchain query!   │
└──────────────────────────────────────────────────────────────┘
       │
       │ Access granted!
       ↓
┌──────────────────────────────────────────────────────────────┐
│            components/VideoPlayer.tsx                         │
│                                                                │
│  1. Download encrypted video from Shelby                      │
│     const response = await fetch(video.shelby_url)            │
│     const encryptedBlob = await response.blob()               │
│                                                                │
│  2. Decrypt video using stored key                            │
│     const key = base64ToUint8Array(video.encryption_key)      │
│     const decrypted = await decryptData(encryptedBlob, key)   │
│                                                                │
│  3. Create object URL                                         │
│     const url = URL.createObjectURL(decrypted)                │
│                                                                │
│  4. Play video                                                │
│     <video src={url} controls />                              │
└──────────────────────────────────────────────────────────────┘
       │
       │ Video playing!
       ↓
┌──────────────┐
│   Browser    │  🎬 User watches video
│ Video Player │
└──────────────┘
```

---

## 🔐 Access Control Decision Tree

```
User requests to watch video_id="vid_abc123"
       │
       ↓
1. Fetch video metadata from Supabase
   const video = await getVideoById("vid_abc123")
       │
       ↓
2. Check access_mode
       │
       ├─► access_mode === 'public'
       │   └─► ✅ ALLOW (anyone can watch)
       │
       ├─► access_mode === 'purchasable'
       │   └─► Check purchase receipt in Supabase
       │       ├─► Receipt exists? ✅ ALLOW
       │       └─► No receipt? ❌ SHOW PURCHASE UI
       │
       ├─► access_mode === 'allowlist'
       │   └─► Check if user wallet in allowlist array
       │       ├─► In allowlist? ✅ ALLOW
       │       └─► Not in allowlist? ❌ DENY
       │
       └─► access_mode === 'timelock'
           └─► Check if current time >= unlock_at
               ├─► Time unlocked? ✅ ALLOW
               └─► Still locked? ❌ SHOW COUNTDOWN
```

---

## 🔄 Access Mode Update Flow

```
Creator changes access mode from "public" to "purchasable"
       │
       ↓
┌──────────────────────────────────────────────────────────────┐
│       components/CreatorVideoSettings.tsx                     │
│                                                                │
│  1. User selects new access mode + price                      │
│  2. Click "Update Settings"                                   │
│  3. Call updateAccessConfig()                                 │
└──────┬───────────────────────────────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────────────────────────────┐
│       app/api/videos/[id]/access-config/route.ts              │
│                                                                │
│  PATCH /api/videos/[id]/access-config                         │
│                                                                │
│  1. Verify user owns the video                                │
│     const video = await getVideoById(videoId)                 │
│     if (video.uploader !== walletAddress) return 403          │
│                                                                │
│  2. Map new access mode to Move AccessPolicy                  │
│     const newPolicy = mapFormToAccessPolicy({                 │
│       accessMode: 'purchasable',                              │
│       price: 1000000000                                       │
│     })                                                        │
│                                                                │
│  3. Update on blockchain FIRST                                │
│     const tx = await signAndSubmitTransaction({               │
│       function: `${MODULE}::force_update_policy_v2`,          │
│       arguments: [blobName, newPolicy]                        │
│     })                                                        │
│                                                                │
│  4. Then update Supabase cache                                │
│     await supabaseAdmin.from('videos').update({               │
│       access_mode: 'purchasable',                             │
│       price: 1000000000,                                      │
│       allowlist: [],                                          │
│       unlock_at: null                                         │
│     }).eq('video_id', videoId)                                │
│                                                                │
│  5. Return success                                            │
└───────────────────────────────────────────────────────────────┘
       │
       │ ✅ Access mode updated on both blockchain & database
       ↓
Future viewers now see purchase gate instead of public access
```

---

## 📊 Query Performance Comparison

### ❌ **Without Supabase (Blockchain Only)**

```
User opens /gallery → Need to list 100 videos
  ↓
For each video:
  1. Call blockchain RPC (50-200ms per call)
  2. Deserialize BlobMetadataV2
  3. Parse access policy
  ↓
Total time: 100 videos × 100ms = 10 seconds! 😱
```

### ✅ **With Supabase (Hybrid)**

```
User opens /gallery → Need to list 100 videos
  ↓
Single SQL query:
  SELECT * FROM videos 
  WHERE expiration_timestamp > now()
  ORDER BY upload_timestamp DESC
  LIMIT 100
  ↓
Total time: ~50ms ⚡
```

---

## 🎯 Why This Architecture Works

| Challenge | Solution |
|-----------|----------|
| **Slow blockchain queries** | Cache metadata in Supabase |
| **Complex SQL queries** | Store structured data in PostgreSQL |
| **Centralization risk** | Source of truth is blockchain, DB is cache |
| **Purchase verification** | Verify on-chain once, cache receipt in DB |
| **Access control** | Enforce on blockchain, mirror in DB |
| **Video storage** | Decentralized on Shelby network |
| **Fast listing/search** | PostgreSQL full-text search |

**Result:** 
- Users get Netflix-like speed ⚡
- Creators get blockchain ownership 🔐
- Platform remains decentralized 🌐
