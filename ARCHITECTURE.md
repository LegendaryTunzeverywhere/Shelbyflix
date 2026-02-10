# Architecture Documentation

Detailed technical architecture of the Token-Gated Video Gallery application.

## System Overview

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Browser   │─────▶│   Next.js    │─────▶│   Aptos     │
│  (User UI)  │      │   Frontend   │      │ Blockchain  │
└─────────────┘      └──────────────┘      └─────────────┘
       │                     │                     │
       │                     │                     │
       ▼                     ▼                     ▼
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Wallet    │      │    Shelby    │      │    Smart    │
│  (Petra/    │      │   Storage    │      │  Contract   │
│  Martian)   │      │  (Videos)    │      │ (Metadata)  │
└─────────────┘      └──────────────┘      └─────────────┘
```

## Component Architecture

### Frontend Layer

#### 1. Pages (Next.js App Router)
- **Homepage** (`app/page.tsx`)
  - Landing page with features
  - CTA buttons based on wallet status
  - How it works section

- **Gallery** (`app/gallery/page.tsx`)
  - Grid of video cards
  - Search and sort functionality
  - Access status indicators

- **Upload** (`app/upload/page.tsx`)
  - File upload form
  - Token access verification
  - Progress tracking

- **Video Player** (`app/video/[id]/page.tsx`)
  - Dynamic route for each video
  - Video streaming interface
  - Metadata display

#### 2. Components

**Core Components**:
- `Header.tsx` - Navigation and wallet button
- `WalletConnect.tsx` - Wallet connection UI
- `VideoCard.tsx` - Individual video preview
- `VideoPlayer.tsx` - Video streaming player
- `UploadForm.tsx` - Upload interface
- `NotificationToast.tsx` - User feedback

**Component Hierarchy**:
```
App Layout
├── Header
│   ├── Logo
│   ├── Navigation Links
│   └── WalletConnect
│       ├── Connect Button (disconnected)
│       └── Wallet Info (connected)
│           ├── Address Display
│           ├── Balance Display
│           └── Disconnect Button
└── Page Content
    ├── Gallery Page
    │   ├── Search/Sort Controls
    │   └── VideoCard Grid
    │       └── VideoCard (multiple)
    ├── Upload Page
    │   └── UploadForm
    │       ├── File Dropzone
    │       ├── Form Inputs
    │       └── Progress Indicator
    └── Video Page
        ├── VideoPlayer
        └── Video Metadata
```

#### 3. Custom Hooks

- **useWallet** - Wallet connection state
  - Wraps Aptos Wallet Adapter
  - Provides address, connected status
  - Handles connection/disconnection

- **useTokenAccess** - Token ownership verification
  - Checks user's token balance
  - Returns hasAccess boolean
  - Auto-updates on wallet change

- **useNotification** - Toast notification system
  - Success/error/info/warning messages
  - Auto-dismiss functionality
  - Queue management

### Library Layer

#### 1. Aptos Integration (`lib/aptos.ts`)

```typescript
// Key Functions:
- aptos: Aptos client instance
- checkTokenOwnership(address): Check token balance
- formatAddress(address): Truncate address for display
- waitForTransaction(hash): Wait for confirmation
- stringToHexBytes(): Convert for Move
```

#### 2. Shelby Integration (`lib/shelby.ts`)

**Current State**: Placeholder/Mock Implementation

```typescript
// Mock Functions (Replace with Real API):
- uploadToShelby(file, metadata): Upload video
- getVideoStreamUrl(id, wallet): Get stream URL
- verifyShelbyAccess(id, wallet): Check access
- validateVideoFile(file): Validate upload
```

**Future Integration**:
```typescript
// Real Shelby API:
POST /v1/upload
  - multipart/form-data
  - Authorization: Bearer <API_KEY>
  - Returns: { videoId, shelbyUrl }

GET /v1/video/{id}
  - X-Wallet-Address header
  - Returns: { streamUrl, accessToken }
```

#### 3. Smart Contract Interface (`lib/contract.ts`)

```typescript
// On-chain Functions:
- storeVideoMetadataOnChain(): Upload metadata
- getAllVideosFromChain(): Fetch all videos
- getVideoMetadata(id): Get specific video
- checkVideoAccess(id, wallet): Verify access
```

### Blockchain Layer

#### Smart Contract (`video_gallery.move`)

**Data Structures**:
```move
struct VideoMetadata {
    video_id: String,
    title: String,
    description: String,
    shelby_url: String,
    uploader: address,
    timestamp: u64,
    required_token: address,
    views: u64,
}

struct VideoRegistry {
    videos: vector<VideoMetadata>,
    video_count: u64,
}
```

**Entry Functions**:
- `initialize()` - One-time setup
- `upload_video(...)` - Store new video
- `record_view(...)` - Increment views

**View Functions**:
- `get_all_videos()` - Return all videos
- `get_video_by_id(id)` - Get specific video
- `can_access_video(user)` - Check access
- `get_min_balance()` - Get requirement

**Access Control**:
```move
const MIN_TOKEN_BALANCE: u64 = 100000000; // 1 APT

// Checks in upload_video():
assert!(
    coin::balance<AptosCoin>(uploader) >= MIN_TOKEN_BALANCE,
    E_INSUFFICIENT_BALANCE
);
```

### Storage Layer

#### Shelby Protocol Integration

**Video Storage Flow**:
1. User selects file
2. Frontend validates file
3. Upload to Shelby storage
4. Receive shelbyUrl
5. Store metadata on-chain
6. Return video ID to user

**Streaming Flow**:
1. User requests video
2. Verify token ownership
3. Generate signed access token
4. Request stream URL from Shelby
5. Return authenticated stream URL
6. Browser plays video

## Data Flow Diagrams

### Upload Flow

```
User                Frontend              Shelby            Blockchain
│                      │                    │                    │
│  Select File         │                    │                    │
├─────────────────────▶│                    │                    │
│                      │  Validate File     │                    │
│                      │───────────────────▶│                    │
│                      │                    │                    │
│  Confirm Upload      │  Upload Video      │                    │
├─────────────────────▶├───────────────────▶│                    │
│                      │                    │  Return URL        │
│                      │◀───────────────────┤                    │
│                      │                    │                    │
│                      │  Store Metadata    │                    │
│                      ├────────────────────────────────────────▶│
│                      │                    │  Confirm TX        │
│                      │◀────────────────────────────────────────┤
│                      │                    │                    │
│  Success Message     │                    │                    │
│◀─────────────────────┤                    │                    │
```

### Watch Flow

```
User                Frontend              Shelby            Blockchain
│                      │                    │                    │
│  Click Video         │                    │                    │
├─────────────────────▶│                    │                    │
│                      │  Check Token       │                    │
│                      ├────────────────────────────────────────▶│
│                      │                    │  Return hasAccess  │
│                      │◀────────────────────────────────────────┤
│                      │                    │                    │
│  (if authorized)     │  Request Stream    │                    │
│                      ├───────────────────▶│                    │
│                      │                    │  Return Stream URL │
│                      │◀───────────────────┤                    │
│                      │                    │                    │
│  Stream Video        │                    │                    │
│◀─────────────────────┤◀─ ─ ─ ─ ─ ─ ─ ─ ─ ┤                    │
│                      │    (Video Data)    │                    │
```

## Security Architecture

### Access Control Layers

1. **Client-Side** (First Line)
   - UI elements hidden/disabled
   - File validation
   - User feedback
   - NOT security boundary

2. **Smart Contract** (Primary Security)
   - Token balance verification
   - Transaction signatures
   - Immutable access rules
   - MAIN security layer

3. **Shelby Storage** (Secondary)
   - Signed access tokens
   - Time-limited URLs
   - Wallet verification
   - Content protection

### Token Verification Flow

```
1. User connects wallet
   ↓
2. Frontend queries Aptos for balance
   ↓
3. Check balance >= MIN_TOKEN_BALANCE
   ↓
4. Update UI state (hasAccess)
   ↓
5. On upload/view: Smart contract re-verifies
   ↓
6. Shelby confirms with own verification
```

### Attack Mitigation

| Attack Vector | Mitigation |
|--------------|------------|
| Fake wallet balance | Smart contract verifies on-chain |
| Direct URL access | Shelby requires signed tokens |
| Replay attacks | Transaction nonces |
| XSS | React auto-escaping, CSP headers |
| File upload abuse | Size limits, type validation |
| Rate limiting | Smart contract gas costs |

## Performance Optimization

### Frontend
- **Code Splitting**: Automatic by Next.js
- **Image Optimization**: next/image component
- **Lazy Loading**: Videos load on demand
- **Caching**: SWR for data fetching

### Blockchain
- **Batch Operations**: Group transactions
- **View Functions**: Read without gas costs
- **Event Indexing**: Off-chain event listeners

### Storage
- **CDN**: Shelby global distribution
- **Streaming**: Progressive video loading
- **Compression**: Video encoding optimization

## Scalability Considerations

### Current Limitations
- Videos stored in single registry
- Linear search for video lookup
- All metadata on-chain (storage costs)

### Future Improvements
- **Sharding**: Multiple registries
- **Indexing**: Off-chain database for queries
- **IPFS**: Alternative/backup storage
- **Layer 2**: Reduce transaction costs

## Environment Configuration

```
Development:
- Local Next.js server
- Aptos testnet
- Mock Shelby functions
- Test wallets

Staging:
- Vercel preview deployment
- Aptos testnet
- Real Shelby integration
- Test tokens

Production:
- Vercel production
- Aptos mainnet
- Shelby mainnet
- Real tokens
```

## Technology Decisions

### Why Next.js?
- SSR/SSG capabilities
- API routes for backend logic
- Excellent TypeScript support
- Vercel deployment integration

### Why Aptos?
- Fast transaction finality
- Low gas fees
- Move language safety
- Growing ecosystem

### Why Shelby?
- Decentralized storage
- Sub-second streaming
- Web3 native
- Complements Aptos

### Why Petra/Martian?
- Best Aptos wallet support
- User-friendly interfaces
- Wide adoption
- Good documentation

## Future Architecture

### Planned Enhancements
1. **Multi-token Support**: Different tiers
2. **NFT Integration**: Video as NFTs
3. **Social Features**: Comments, likes
4. **Creator Profiles**: User pages
5. **Monetization**: Tips, subscriptions

### Microservices Evolution
```
Current: Monolithic Next.js
Future:
├── Frontend (Next.js)
├── API Gateway (GraphQL)
├── Video Service (Processing)
├── Auth Service (Wallet verification)
├── Analytics Service (Views, stats)
└── Notification Service (Alerts)
```

---

This architecture provides a solid foundation for a decentralized, token-gated video platform while remaining flexible for future enhancements.
