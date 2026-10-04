import { NextRequest, NextResponse } from 'next/server';
import { normalizeAddress } from '@/lib/access-control';
import { hasWalletSession } from '@/lib/wallet-session';

// ---------------------------------------------------------------------------
// GET /api/auth/session?wallet=0x...
//
// Cheap status probe for the wallet UI's "Sign in" button: answers whether
// the caller's wallet-session cookie is present, unexpired, and bound to the
// given wallet. Read-only — it never creates or extends a session (that only
// happens via the signed challenge in POST /api/interactions, action
// 'session'). No caching headers, so a freshly-established session is
// reflected on the next poll.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const wallet = normalizeAddress(req.nextUrl.searchParams.get('wallet'));
    if (wallet.length === 0) {
      return NextResponse.json({ signedIn: false });
    }

    const signedIn = await hasWalletSession(req, wallet);
    return NextResponse.json({ signedIn });
  } catch (err) {
    console.error('[/api/auth/session] lookup failed:', err);
    return NextResponse.json({ signedIn: false }, { status: 500 });
  }
}
