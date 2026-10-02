import { NextRequest, NextResponse } from 'next/server';
import { issueNonce } from '@/lib/nonce-store';

// ---------------------------------------------------------------------------
// POST /api/auth/challenge
// Body: { walletAddress: string }
// Returns: { nonce: string }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  let walletAddress: unknown;
  try {
    ({ walletAddress } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (!walletAddress || typeof walletAddress !== 'string') {
    return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 });
  }
  if (!/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
  }

  return issueChallenge(walletAddress, req);
}

// ---------------------------------------------------------------------------
// GET /api/auth/challenge?walletAddress=0x...
// Convenience endpoint to retrieve a nonce (same logic, GET variant)
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  const walletAddress = req.nextUrl.searchParams.get('walletAddress');

  if (!walletAddress) {
    return NextResponse.json({ error: 'walletAddress query param is required' }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
    return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
  }

  return issueChallenge(walletAddress, req);
}

async function issueChallenge(walletAddress: string, req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';

  try {
    const nonce = await issueNonce(walletAddress, ip);
    if (nonce === null) {
      return NextResponse.json(
        { error: 'Too many outstanding challenges. Please wait.' },
        { status: 429, headers: { 'Retry-After': '300' } },
      );
    }
    return NextResponse.json({ nonce });
  } catch (error) {
    console.error('Failed to persist wallet challenge:', error);
    return NextResponse.json({ error: 'Could not create wallet challenge' }, { status: 500 });
  }
}
