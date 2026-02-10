# 🚀 Quick Start Guide

Get your Token-Gated Video Gallery running in 5 minutes!

## Step 1: Install Dependencies (2 minutes)

```bash
cd token-gated-videos
npm install
```

## Step 2: Setup Environment (1 minute)

```bash
cp .env.example .env.local
```

**For testing, you can use these default values:**
```env
NEXT_PUBLIC_APTOS_NETWORK=testnet
NEXT_PUBLIC_APTOS_NODE_URL=https://fullnode.testnet.aptoslabs.com/v1
NEXT_PUBLIC_TOKEN_ADDRESS=0x1::aptos_coin::AptosCoin
NEXT_PUBLIC_MODULE_ADDRESS=0x1
```

## Step 3: Run Development Server (30 seconds)

```bash
npm run dev
```

Open http://localhost:3000

## Step 4: Test the App (1 minute)

1. **Install Petra Wallet** (if you don't have it)
   - Visit https://petra.app/
   - Add to your browser
   - Create a new wallet

2. **Get Test Tokens**
   - Visit https://aptoslabs.com/testnet-faucet
   - Enter your wallet address
   - Click "Mint"

3. **Connect & Test**
   - Click "Connect Wallet" in the app
   - Browse the gallery
   - Try uploading a video

## What You'll See

### Homepage
- Feature showcase
- Connect wallet button
- Navigation to gallery/upload

### Gallery
- 6 mock videos (for testing)
- Search and sort functionality
- Token access indicators

### Upload Page
- Drag-and-drop interface
- Form for title/description
- Upload simulation (mock)

### Video Player
- Sample video playback
- Metadata display
- Share functionality

## Next Steps

### To Deploy Smart Contract:

```bash
cd move-contracts

# Install Aptos CLI first
# https://aptos.dev/cli-tools/aptos-cli-tool/install-aptos-cli

aptos init --profile testnet
aptos move compile --named-addresses video_gallery=<YOUR_ADDRESS>
aptos move publish --profile testnet --named-addresses video_gallery=<YOUR_ADDRESS>
```

### To Integrate Real Shelby:

1. Get Shelby API credentials
2. Update `SHELBY_API_KEY` in `.env.local`
3. Replace mock functions in `lib/shelby.ts`

### To Deploy to Vercel:

```bash
# Push to GitHub
git init
git add .
git commit -m "Initial commit"
git remote add origin <YOUR_REPO>
git push -u origin main

# Then deploy on vercel.com
```

## Troubleshooting

**Issue: npm install fails**
→ Use Node.js 18+ : `node --version`

**Issue: Wallet won't connect**
→ Make sure Petra is set to Testnet network

**Issue: Upload doesn't work**
→ Normal! It's a mock function. See lib/shelby.ts to integrate real API

**Issue: Videos won't play**
→ Using sample video for testing. Works with real Shelby integration

## Architecture Overview

```
Frontend (Next.js + React)
    ↓
Wallet (Petra/Martian)
    ↓
Blockchain (Aptos Testnet)
    ↓
Storage (Shelby - currently mocked)
```

## File Structure

```
token-gated-videos/
├── app/              → Pages (Next.js 14)
├── components/       → React components
├── lib/              → Utilities & integrations
├── hooks/            → Custom React hooks
├── types/            → TypeScript definitions
├── move-contracts/   → Smart contracts (Move)
└── README.md         → Full documentation
```

## Need Help?

📖 Read the full [README.md](./README.md)
🏗️ Check [ARCHITECTURE.md](./ARCHITECTURE.md)
🚢 See [DEPLOYMENT.md](./DEPLOYMENT.md)

## What's Included?

✅ Complete Next.js application
✅ Aptos wallet integration
✅ Token-gating logic
✅ Video upload interface
✅ Video player component
✅ Smart contract (Move)
✅ Mock Shelby integration
✅ Full TypeScript support
✅ Responsive design
✅ Comprehensive docs

---

**You're all set!** 🎉 Start building your Web3 video platform!
