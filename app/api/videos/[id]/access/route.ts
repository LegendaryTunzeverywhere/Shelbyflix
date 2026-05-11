import { NextRequest, NextResponse } from 'next/server';
import { normalizeAddress, resolveAccess } from '@/lib/access-control';

// ---------------------------------------------------------------------------
// GET /api/videos/:id/access?wallet=0x...
//
// The single access-resolution endpoint. Every gate in the UI
// (VideoPlayer, PurchaseGate, creator settings) routes through this
// so the decision lives in exactly one place (Req 7.1, 11.1).
//
// Behaviour:
//  - `wallet` query param is optional. When omitted or blank the caller is
//    treated as anonymous: Public videos return hasAccess:true, every other
//    mode returns hasAccess:false with the appropriate reason (Req 7.2).
//  - The wallet is normalised (lowercased, trimmed) before resolution so a
//    mixed-case address supplied by the client still matches the lowercase
//    owner/allowlist entries persisted in Supabase (Req 3.1, 3.2).
//  - The response mirrors the AccessResult surface directly. That type is
//    intentionally a boolean + metadata surface only — it never includes
//    encryption_key or any other sensitive column, so there is nothing to
//    strip at this layer (Req 7.5). The shape matches
//    `{ hasAccess, reason, accessMode, ownerIsViewer, unlockAt?, priceBaseUnits? }`
//    from the AccessResult type in types/index.ts (Req 7.1).
//  - No caching headers are set. Dev-mode access flips (e.g. an owner
//    editing the allowlist) must be reflected on the next request, and
//    Next's default `no-store` for dynamic route handlers is exactly what
//    we want here (Req 7.6).
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Same sanitisation pattern used by `getVideoById` in video-service.ts
    // and `supabaseBackend.getConfig` — video IDs are alphanumeric plus
    // `_` / `-`. Anything else can only come from a client attempting
    // injection, and rejecting early avoids a pointless DB round trip.
    if (!id || !/^[\w-]+$/.test(id)) {
      return NextResponse.json(
        { error: 'Invalid video id' },
        { status: 400 },
      );
    }

    // Req 7.2: `wallet` is optional. `normalizeAddress` returns '' for
    // null/undefined/whitespace-only input, so we can collapse every
    // "no wallet provided" case to a single `null` that `resolveAccess`
    // already handles uniformly.
    const walletRaw = _req.nextUrl.searchParams.get('wallet');
    const normalizedWallet = normalizeAddress(walletRaw);
    const wallet = normalizedWallet.length > 0 ? normalizedWallet : null;

    const result = await resolveAccess(id, wallet);

    // AccessResult is already the exact response shape required by Req 7.1.
    // No mapping or field stripping is needed — the type was designed so
    // that every field is safe to expose to unauthenticated callers.
    return NextResponse.json(result);
  } catch (err) {
    console.error('GET /api/videos/:id/access error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
