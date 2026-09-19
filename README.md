# 🎬 ShelbyFlix

> A decentralized video sharing platform powered by Shelby Storage Network and Aptos blockchain

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Aptos](https://img.shields.io/badge/Aptos-Blockchain-green)](https://aptoslabs.com/)

ShelbyFlix combines the best of Web3 and traditional web architectures to deliver a fast, censorship-resistant video platform where creators truly own their content.

---

## ✨ Features

### 🔐 **Decentralized Storage**
- Videos encrypted client-side and stored on Shelby Storage Network
- Immutable ownership records on Aptos blockchain
- No single point of failure or censorship

### 💰 **Flexible Monetization**
- **Public** - Free for everyone
- **Purchasable** - One-time payment with ShelbyUSD tokens
- **Allowlist** - Whitelist specific wallet addresses
- **Time-locked** - Schedule automatic unlock dates

### ⚡ **Blazing Fast Performance**
- Hybrid architecture: blockchain for trust, database for speed
- PostgreSQL-powered search and filtering
- Netflix-like user experience

### 🎨 **Modern UI/UX**
- Responsive design with Tailwind CSS
- Support for long-form videos and vertical shorts
- Real-time upload progress
- Thumbnail generation and preview.

### 🔗 **Wallet Integration**
- Connect with Petra, Martian, Pontem, or any Aptos wallet
- Sign transactions for uploads, purchases, and access control
- Non-custodial - you control your keys

---

## 🏗️ Architecture

ShelbyFlix uses a **hybrid architecture** combining:

1. **Shelby Storage Network (Blockchain)**
   - Stores encrypted video files (decentralized)
   - Enforces access control policies via Move smart contracts
   - Processes payments with ShelbyUSD tokens
   - Provides cryptographic ownership proofs

2. **Supabase (Traditional Database)**
   - Indexes video metadata for fast queries
   - Caches blockchain state for performance
   - Stores verified purchase receipts
   - Powers social features (comments, likes)

**Result:** Users get Web2 speed with Web3 ownership.

For detailed architecture documentation, see:
- [SHELBY_ARCHITECTURE.md](./SHELBY_ARCHITECTURE.md) - System design overview
- [SHELBY_DATA_FLOW.md](./SHELBY_DATA_FLOW.md) - Complete data flows with diagrams

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Supabase** account ([signup](https://supabase.com))
- **Aptos wallet** (Petra recommended)
- **Shelby API key** (for testnet storage)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Legendarytunzeverywhere/shelbyflix.git
   cd shelbyflix
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` and configure:
   ```env
   # Shelby Network
   NEXT_PUBLIC_SHELBYNET_NODE_URL=https://api.testnet.aptoslabs.com/v1
   SHELBY_API_KEY=your_shelby_api_key
   
   # Smart Contracts
   NEXT_PUBLIC_ACCESS_CONTROL_MODULE_ADDRESS=0x5211945b...
   NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS=0x85fdb9a1...
   NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS=0x1b18363a...
   
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   # Access Backend
   NEXT_PUBLIC_ACCESS_BACKEND=move  # or "supabase"
   ```

4. **Set up Supabase database**
   
   Run the SQL migration in your Supabase SQL Editor:
   ```bash
   # See supabase/migrations/ folder for schema
   ```
   
   Configure RLS policies:
   ```bash
   # Run the SQL in SUPABASE_RLS_FIX.sql
   ```

5. **Run development server**
   ```bash
   npm run dev
   ```
   
   Open [http://localhost:3000](http://localhost:3000)

---

## 📖 Usage

### Uploading Videos

1. **Connect your wallet** (Petra, Martian, etc.)
2. Navigate to `/upload`
3. Select video file (MP4, WebM, MOV - up to 10GB)
4. Fill in metadata:
   - Title and description
   - Category and tags
   - Access mode and pricing
5. Click "Publish Video"
6. Approve wallet transaction to register on blockchain
7. Wait for upload to complete

### Watching Videos

1. Browse `/gallery` or `/shorts` feed
2. Click a video to watch
3. For purchasable videos:
   - Click "Purchase for X ShelbyUSD"
   - Approve payment transaction
   - Video unlocks instantly

### Managing Your Content

1. Navigate to `/channel/[your-address]`
2. View all your uploaded videos
3. Edit access settings, pricing, or allowlist
4. Delete videos (removes from blockchain and storage)

---

## 🛠️ Tech Stack

### Frontend
- **Framework:** Next.js 15 (React 19)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **State:** React Hooks + Context API
- **Wallet:** Aptos Wallet Adapter

### Backend
- **API Routes:** Next.js API routes
- **Database:** Supabase (PostgreSQL)
- **Authentication:** Wallet signatures + challenge-response

### Blockchain
- **Chain:** Aptos (Testnet)
- **Smart Contracts:** Move language
- **Storage:** Shelby Storage Network
- **Token:** ShelbyUSD (payment token)

### Encryption
- **Algorithm:** AES-256-GCM
- **Key Management:** Client-side generation, server-side storage (encrypted at rest)

---

## 📁 Project Structure

```
shelbyflix/
├── app/                          # Next.js app directory
│   ├── api/                      # API routes
│   │   ├── videos/               # Video CRUD operations
│   │   ├── payments/             # Purchase verification
│   │   └── auth/                 # Authentication
│   ├── gallery/                  # Video gallery page
│   ├── shorts/                   # Shorts feed page
│   ├── upload/                   # Upload page
│   ├── video/[id]/               # Video player page
│   └── channel/[address]/        # Channel page
├── components/                   # React components
│   ├── UploadForm.tsx            # Video upload form
│   ├── VideoPlayer.tsx           # Video playback
│   ├── PurchaseGate.tsx          # Payment flow
│   ├── CreatorVideoSettings.tsx  # Access control editor
│   └── ...
├── lib/                          # Core libraries
│   ├── shelby.ts                 # Shelby storage integration
│   ├── shelbynet-blob.ts         # Blob upload/download
│   ├── move-contract-backend.ts  # Blockchain access control
│   ├── move-bcs.ts               # Binary serialization
│   ├── video-service.ts          # Video metadata CRUD
│   ├── supabase.ts               # Supabase client
│   ├── supabase-admin.ts         # Service role client
│   ├── encryption.ts             # AES encryption utilities
│   └── aptos-client.ts           # Aptos SDK wrapper
├── types/                        # TypeScript type definitions
├── public/                       # Static assets
├── .env.local                    # Environment variables (gitignored)
├── .env.example                  # Example environment config
└── README.md                     # This file
```

---

## 🔐 Security

### Client-Side Encryption
- Videos are encrypted with AES-256-GCM before upload
- Encryption keys generated using `crypto.getRandomValues()`
- Only users with access can decrypt videos

### Access Control
- Enforced on-chain via Move smart contracts
- Access policies stored immutably on blockchain
- Server validates all transactions before granting access

### Row Level Security (RLS)
- Supabase tables protected with RLS policies
- Service role used for privileged operations
- Purchase receipts verified on-chain before storage

### Environment Variables
- Sensitive keys (service role, API keys) never exposed to client
- `NEXT_PUBLIC_` prefix only for safe, public variables

---

## 🧪 Testing

Run the test suite:

```bash
# Unit tests
npm run test

# E2E tests (if configured)
npm run test:e2e

# Type checking
npm run type-check

# Linting
npm run lint
```

---

## 🚢 Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Configure environment variables in Vercel dashboard
4. Deploy!

### Environment Variables Checklist

Ensure these are set in your deployment environment:

- ✅ `NEXT_PUBLIC_SUPABASE_URL`
- ✅ `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- ✅ `SUPABASE_SERVICE_ROLE_KEY` (server-only!)
- ✅ `SHELBY_API_KEY` (server-only!)
- ✅ `NEXT_PUBLIC_ACCESS_CONTROL_MODULE_ADDRESS`
- ✅ `NEXT_PUBLIC_BLOB_CONTRACT_ADDRESS`
- ✅ `NEXT_PUBLIC_SHELBYUSD_TOKEN_ADDRESS`
- ✅ `CRON_SECRET` (for cleanup jobs)

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes**
   - Follow existing code style
   - Add tests for new features
   - Update documentation
4. **Commit your changes**
   ```bash
   git commit -m "Add amazing feature"
   ```
5. **Push to your fork**
   ```bash
   git push origin feature/amazing-feature
   ```
6. **Open a Pull Request**

### Code Style
- TypeScript strict mode enabled
- ESLint and Prettier for formatting
- Meaningful variable names
- Comments for complex logic

### Commit Messages
- Use present tense ("Add feature" not "Added feature")
- Be descriptive but concise
- Reference issues when applicable

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2024 ShelbyFlix Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

- **[Aptos Labs](https://aptoslabs.com/)** - Blockchain infrastructure
- **[Shelby Storage Network](https://shelby.xyz/)** - Decentralized storage
- **[Supabase](https://supabase.com/)** - Database and authentication
- **[Next.js](https://nextjs.org/)** - React framework
- **[Tailwind CSS](https://tailwindcss.com/)** - Styling

---

## 📞 Support

- **Documentation:** [SHELBY_ARCHITECTURE.md](./SHELBY_ARCHITECTURE.md)
- **Issues:** [GitHub Issues](https://github.com/Legendarytunzeverywhere/shelbyflix/issues)
- **Discussions:** [GitHub Discussions](https://github.com/Legendarytunzeverywhere/shelbyflix/discussions)

---

## 🗺️ Roadmap

- [x] Video upload with encryption
- [x] Access control (public, purchasable, allowlist, timelock)
- [x] Shorts feed (vertical videos)
- [x] Purchase flow with ShelbyUSD
- [x] Comments and engagement features
- [x] User profiles and subscriptions
- [ ] Live streaming support
- [ ] Mobile apps (iOS/Android)
- [ ] Content moderation tools
- [ ] Creator analytics dashboard
- [ ] IPFS integration (decentralized metadata)
- [ ] Multi-chain support

---

## 🌟 Star History

If you find this project useful, please consider giving it a ⭐️ on GitHub!

---

<div align="center">
  <strong>Built with ❤️ by the ShelbyFlix team</strong>
  <br />
  <sub>Empowering creators with Web3 technology</sub>
</div>
