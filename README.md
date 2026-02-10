# Token-Gated Video Gallery

A decentralized video platform built on **Aptos blockchain** with **Shelby Protocol** storage, featuring NFT/token-gated access control.

![Powered by Aptos & Shelby](https://img.shields.io/badge/Powered%20by-Aptos%20%26%20Shelby-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## 🎯 Overview

This Web3 application allows users to:
- **Upload videos** to Shelby decentralized storage
- **Gate access** based on Shelby Faucet token ownership on Aptos
- **Stream videos** with sub-second loading times
- **Store metadata** on-chain for transparency and immutability

## ✨ Features

- ✅ **Token-Gated Access** - Only token holders can upload and watch videos
- ✅ **Decentralized Storage** - Videos stored on Shelby Protocol
- ✅ **Sub-second Streaming** - Lightning-fast video playback
- ✅ **Blockchain Verified** - Metadata stored on Aptos blockchain
- ✅ **Wallet Integration** - Petra & Martian wallet support
- ✅ **Responsive Design** - Works on desktop and mobile
- ✅ **Search & Sort** - Find videos easily with filters

## 🛠️ Tech Stack

### Frontend
- **Framework**: Next.js 14 (App Router) with TypeScript
- **Styling**: Tailwind CSS
- **Wallet**: Aptos Wallet Adapter
- **Video Player**: React Player
- **Icons**: Heroicons

### Backend/Blockchain
- **Blockchain**: Aptos (Testnet)
- **Smart Contract**: Move language
- **Token**: Shelby Faucet Token (Aptos Coin)

### Storage
- **Primary**: Shelby Protocol (placeholder functions - ready to swap)
- **Metadata**: On-chain (Aptos)

## 📋 Prerequisites

- Node.js 18+ and npm/pnpm
- Aptos CLI (for smart contract deployment)
- Petra or Martian wallet browser extension
- Test APT tokens from [Aptos Faucet](https://aptoslabs.com/testnet-faucet)

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd token-gated-videos
```

### 2. Install Dependencies

```bash
npm install
# or
pnpm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_APTOS_NETWORK=testnet
NEXT_PUBLIC_APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
NEXT_PUBLIC_TOKEN_ADDRESS=0x1::aptos_coin::AptosCoin
NEXT_PUBLIC_MODULE_ADDRESS=<YOUR_DEPLOYED_MODULE_ADDRESS>
```

### 4. Deploy Smart Contract

```bash
cd move-contracts

# Initialize Aptos CLI (first time only)
aptos init --profile testnet

# Compile the contract
aptos move compile --named-addresses video_gallery=<YOUR_ADDRESS>

# Deploy to testnet
aptos move publish --profile testnet --named-addresses video_gallery=<YOUR_ADDRESS>
```

Copy the deployed module address and update `NEXT_PUBLIC_MODULE_ADDRESS` in `.env.local`.

### 5. Run Development Server

```bash
npm run dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📖 Usage Guide

### For Users

1. **Connect Wallet**
   - Click "Connect Wallet" in the top right
   - Select Petra or Martian wallet
   - Approve the connection

2. **Get Test Tokens**
   - Visit [Aptos Faucet](https://aptoslabs.com/testnet-faucet)
   - Enter your wallet address
   - Request test APT tokens
   - Wait for confirmation (usually <1 minute)

3. **Upload Videos**
   - Navigate to "Upload" page
   - Drag and drop your video file (MP4, WebM, MOV)
   - Add title and description
   - Click "Upload Video"
   - Wait for upload to complete (~2-5 seconds)

4. **Watch Videos**
   - Browse the Gallery
   - Click on any unlocked video card
   - Enjoy sub-second streaming!

### For Developers

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation.

## 🔒 Security Features

- **Client-side validation**: File type and size checks
- **Token verification**: Server-side access control
- **On-chain metadata**: Immutable video records
- **Wallet signatures**: All transactions require user approval

## 🌐 Project Structure

```
token-gated-videos/
├── app/                    # Next.js app directory
│   ├── gallery/           # Gallery page
│   ├── upload/            # Upload page
│   ├── video/[id]/        # Video player page
│   └── page.tsx           # Homepage
├── components/            # React components
│   ├── VideoCard.tsx
│   ├── VideoPlayer.tsx
│   ├── UploadForm.tsx
│   └── WalletConnect.tsx
├── lib/                   # Utility libraries
│   ├── aptos.ts          # Aptos client
│   ├── shelby.ts         # Shelby integration (mock)
│   └── contract.ts       # Smart contract interactions
├── hooks/                 # Custom React hooks
│   ├── useWallet.ts
│   ├── useTokenAccess.ts
│   └── useNotification.ts
├── types/                 # TypeScript definitions
│   └── index.ts
├── move-contracts/        # Move smart contracts
│   └── sources/
│       └── video_gallery.move
└── public/               # Static assets
```

## 🔧 Configuration

### Shelby Integration

Currently, the app uses **placeholder functions** for Shelby storage. When Shelby API is available:

1. Get Shelby API credentials
2. Update `SHELBY_API_KEY` in `.env.local`
3. Replace mock functions in `lib/shelby.ts` with actual API calls

See detailed integration guide in `lib/shelby.ts` comments.

### Token Configuration

To use a different token:

1. Update `NEXT_PUBLIC_TOKEN_ADDRESS` in `.env.local`
2. Update `required_token` in Move contract
3. Redeploy the smart contract

## 📊 Smart Contract Functions

### View Functions
- `get_all_videos()` - Get list of all videos
- `get_video_count()` - Get total video count
- `get_video_by_id(video_id)` - Get specific video metadata
- `can_access_video(user)` - Check if user has access
- `get_min_balance()` - Get minimum required balance

### Entry Functions
- `initialize()` - Initialize video registry (one-time)
- `upload_video(...)` - Upload new video metadata
- `record_view(...)` - Increment view count

## 🧪 Testing

Run the Move contract tests:

```bash
cd move-contracts
aptos move test
```

## 🚢 Deployment

### Frontend (Vercel)

1. Push code to GitHub
2. Connect repository to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy automatically

### Smart Contract

```bash
cd move-contracts
aptos move publish --profile mainnet --named-addresses video_gallery=<YOUR_ADDRESS>
```

## 🐛 Troubleshooting

### Wallet Won't Connect
- Clear browser cache
- Try a different browser
- Ensure wallet extension is updated
- Check network is set to Testnet

### Video Upload Fails
- Check file size (<100MB)
- Verify file format (MP4, WebM, MOV)
- Ensure sufficient APT balance
- Check browser console for errors

### Smart Contract Errors
- Verify contract is deployed
- Check `MODULE_ADDRESS` is correct
- Ensure account has enough APT for gas

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📝 License

MIT License - see [LICENSE](./LICENSE) file

## 🔗 Links

- [Aptos Documentation](https://aptos.dev/)
- [Shelby Protocol](https://shelby.xyz)
- [Petra Wallet](https://petra.app/)
- [Move Language](https://move-language.github.io/move/)

## 💬 Support

For issues and questions:
- Open a GitHub issue
- Join the Aptos Discord
- Check Shelby community channels

## 🎉 Acknowledgments

- Built with ❤️ for the Aptos & Shelby ecosystem
- Powered by decentralized storage and blockchain technology
- Inspired by the Web3 community

---

**Note**: This is a testnet application. For production use, conduct thorough security audits and testing.
