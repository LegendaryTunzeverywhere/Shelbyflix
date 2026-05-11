import { NextRequest, NextResponse } from 'next/server';
import { Ed25519PublicKey } from '@aptos-labs/ts-sdk';
import { nonceStore, verifyAndConsumeNonce } from '@/lib/nonce-store';
import { hexToBytes } from '@/lib/shared-utils';
// import { checkTokenOwnership } from '@/lib/aptos'; // Available for opt-in token-gating

// ---------------------------------------------------------------------------
// POST /api/auth/check-access
// Body: { walletAddress, publicKey, signature, nonce, fullMessage? }
// Returns: { hasAccess: boolean }
//
// Flow:
//  1. Client calls GET /api/auth/challenge?walletAddress=... to get a nonce
//  2. Client signs the nonce via the Aptos Wallet Adapter (signMessage)
//  3. Wallet Standard returns { signature, fullMessage, ... } where
//     fullMessage is the ACTUAL bytes that were signed (includes APTOS\n
//     prefix, application/domain, nonce, etc.). Verification must use
//     fullMessage, not the caller-supplied plain text.
//  4. Server verifies the Ed25519 signature over fullMessage.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { walletAddress, publicKey, signature, nonce, fullMessage } =
      await req.json();

    // ── Input validation ─────────────────────────────────────────────────
    if (!walletAddress || !publicKey || !signature || !nonce) {
      return NextResponse.json(
        { error: 'walletAddress, publicKey, signature, and nonce are required' },
        { status: 400 }
      );
    }

    if (!/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    // ── Verify nonce is known and not expired ────────────────────────────
    const storeKey = walletAddress.toLowerCase();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';

    // Check that the wallet has at least one outstanding nonce before
    // attempting signature verification (fast-fail for unknown wallets)
    const entries = nonceStore.get(storeKey);
    if (!entries || entries.length === 0) {
      return NextResponse.json(
        { error: 'Nonce not found or expired. Request a new challenge.' },
        { status: 401 }
      );
    }

    // ── Verify Ed25519 signature ──────────────────────────────────────────
    // Aptos Wallet Standard returns `fullMessage` — the exact bytes the
    // wallet actually signed (includes APTOS\n prefix + domain + nonce).
    // When present we MUST verify against that; otherwise fall back to the
    // raw "ShelbyFlix login: <nonce>" we asked the wallet to sign.
    const plainMessage = `ShelbyFlix login: ${nonce}`;
    const messageToVerify: string =
      typeof fullMessage === 'string' && fullMessage.length > 0
        ? fullMessage
        : plainMessage;

    // Extra safety: if client claims a fullMessage, it must contain the
    // nonce we issued. Prevents reuse of a signature over an attacker-chosen
    // message.
    if (!messageToVerify.includes(nonce)) {
      return NextResponse.json(
        { error: 'Signed message does not contain issued nonce' },
        { status: 401 }
      );
    }

    const messageBytes = new TextEncoder().encode(messageToVerify);

    let signatureValid = false;
    try {
      const pubKey = new Ed25519PublicKey(publicKey);
      const sigHex = String(signature);
      const sigBytes = hexToBytes(sigHex.startsWith('0x') ? sigHex.slice(2) : sigHex);
      signatureValid = pubKey.verifySignature({
        message: messageBytes,
        signature: sigBytes,
      } as any);
    } catch (err) {
      console.error('Signature verification error:', err);
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
    }

    if (!signatureValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Consume nonce — one-time use — only after a verified signature so a
    // failed attempt doesn't force the user to re-request a challenge.
    const consumed = verifyAndConsumeNonce(storeKey, nonce, ip);
    if (!consumed) {
      return NextResponse.json(
        { error: 'Nonce not found, expired, or IP mismatch. Request a new challenge.' },
        { status: 401 }
      );
    }

    return NextResponse.json({ hasAccess: true, walletAddress });
  } catch (err) {
    console.error('check-access error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/auth/check-access
// Simple public check — no signature required
// Query: ?wallet=0x...
// Header: x-wallet-address: 0x...
// Returns: { hasAccess: boolean, walletAddress: string, balance: string }
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Get wallet address from query or header
    const walletFromQuery = req.nextUrl.searchParams.get('wallet');
    const walletFromHeader = req.headers.get('x-wallet-address');
    const walletAddress = walletFromQuery || walletFromHeader;

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address required (query param or x-wallet-address header)' },
        { status: 400 }
      );
    }

    if (!/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    // Access policy: All connected wallets with a valid address have access.
    // Token-gating (checkTokenOwnership) is available for per-video access
    // control via the purchasable/allowlist modes, but the platform itself
    // does not require a minimum token balance for basic access.
    //
    // If you want to re-enable platform-wide token-gating in the future,
    // uncomment the on-chain check below:
    // const result = await checkTokenOwnership(walletAddress);
    // return NextResponse.json({ hasAccess: result.hasAccess, ... });

    return NextResponse.json({
      hasAccess: true,
      walletAddress: walletAddress.toLowerCase(),
      balance: '0',
    });
  } catch (err) {
    // Fail closed: any unexpected error denies access
    console.error('check-access GET error:', err);
    return NextResponse.json({
      hasAccess: false,
      walletAddress: '',
      balance: '0',
    });
  }
}


