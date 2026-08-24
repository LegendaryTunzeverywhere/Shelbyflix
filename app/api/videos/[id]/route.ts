import { NextRequest, NextResponse } from 'next/server';
import { Ed25519PublicKey } from '@aptos-labs/ts-sdk';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { hexToBytes } from '@/lib/shared-utils';

const VIDEO_ID_REGEX = /^[\w-]+$/;

function getAdminWallets(): Set<string> {
  const raw = process.env.ADMIN_WALLET_ADDRESSES ?? '';
  return new Set(
    raw
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter((a) => a.length > 0),
  );
}

// ---------------------------------------------------------------------------
// DELETE /api/videos/:id
//
// FIX: this previously had NO authentication or authorization at all --
// any request with a valid videoId would delete the row, full stop. Anyone
// who knew (or guessed/enumerated) a videoId could delete any video on the
// platform.
//
// JSON body fields expected:
//   - walletAddress : 0x-prefixed Aptos address of the caller (string)
//   - publicKey     : hex Ed25519 public key (string)
//   - signature     : hex Ed25519 signature over the message below (string)
//   - signedMessage : the wallet's actual returned fullMessage, which must
//                      CONTAIN "ShelbyFlix delete: <videoId>" (string) --
//                      see app/api/uploads/route.ts for why containment
//                      rather than exact-equality: different wallets wrap
//                      signMessage() input in their own framing, and we
//                      verify against whatever the wallet actually signed
//                      rather than assuming a specific wire format.
//
// Authorized callers, either of:
//   (a) the video's original uploader (walletAddress === uploader_wallet)
//   (b) a platform admin wallet (ADMIN_WALLET_ADDRESSES env var) -- for
//       removing harmful/policy-violating content regardless of uploader
//
// On success: deletes the Shelby storage blob (via the platform account,
// which is the actual on-chain owner post-architecture-change -- see
// app/api/uploads/route.ts) and the Supabase video row. Does NOT touch
// the on-chain access_control policy entry for admin-initiated deletes --
// see ADMIN_WALLET_ADDRESSES in .env.example for why, and why that's
// harmless once the content itself is gone.
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id: videoId } = await params;
    if (!videoId || !VIDEO_ID_REGEX.test(videoId)) {
      return NextResponse.json({ error: 'Invalid video id' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const {
      walletAddress,
      publicKey,
      signature,
      signedMessage: fullMessage,
    } = body as Record<string, unknown>;

    if (
      typeof walletAddress !== 'string' || !walletAddress ||
      typeof publicKey !== 'string' || !publicKey ||
      typeof signature !== 'string' || !signature ||
      typeof fullMessage !== 'string' || !fullMessage
    ) {
      return NextResponse.json(
        { error: 'Missing required fields: walletAddress, publicKey, signature, signedMessage' },
        { status: 400 },
      );
    }

    if (!/^0x[a-fA-F0-9]{1,64}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    // ── Verify the signed content is bound to THIS delete request ────────
    const expectedMessage = `ShelbyFlix delete: ${videoId}`;
    if (!fullMessage.includes(expectedMessage)) {
      return NextResponse.json(
        { error: 'Signed message does not match this delete request' },
        { status: 401 },
      );
    }

    // ── Verify Ed25519 signature against the exact bytes the wallet signed ─
    let signatureValid = false;
    try {
      const pubKey = new Ed25519PublicKey(publicKey);
      const sigBytes = hexToBytes(signature.startsWith('0x') ? signature.slice(2) : signature);
      const messageBytes = new TextEncoder().encode(fullMessage);
      signatureValid = pubKey.verifySignature({ message: messageBytes, signature: sigBytes } as any);
    } catch (err) {
      console.error('Signature verification error:', err);
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
    }
    if (!signatureValid) {
      return NextResponse.json({ error: 'Invalid wallet signature' }, { status: 401 });
    }

    // ── Look up the video and authorize ──────────────────────────────────
    const supabaseAdmin = getSupabaseAdmin();
    const { data: video, error: fetchError } = await supabaseAdmin
      .from('videos')
      .select('video_id, uploader_wallet, blob_name')
      .eq('video_id', videoId)
      .maybeSingle();

    if (fetchError) {
      console.error('[/api/videos/:id] Supabase fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to look up video' }, { status: 500 });
    }
    if (!video) {
      // Already gone — treat as success rather than erroring, so a retry
      // (or a double-click) after a partially-completed prior delete
      // doesn't surface a confusing failure.
      return NextResponse.json({ success: true, alreadyDeleted: true });
    }

    const callerWallet = walletAddress.toLowerCase();
    const isUploader = callerWallet === (video.uploader_wallet ?? '').toLowerCase();
    const isAdmin = getAdminWallets().has(callerWallet);

    if (!isUploader && !isAdmin) {
      return NextResponse.json(
        { error: 'Not authorized to delete this video' },
        { status: 403 },
      );
    }

    if (isAdmin && !isUploader) {
      // Moderator-initiated removal of someone else's content — worth a
      // clear server-side audit trail even without a dedicated log table.
      console.warn(
        `[MODERATION] Admin ${callerWallet} deleted video ${videoId} ` +
        `(uploaded by ${video.uploader_wallet})`,
      );
    }

    // ── Delete the Shelby storage blob via the platform account ─────────
    // The platform account is the actual on-chain owner of storage blobs
    // post-architecture-change (see app/api/uploads/route.ts) — neither
    // the uploader's nor an admin's own wallet can do this directly, the
    // same reason retrieval URLs had to be rebuilt with the platform
    // account's address rather than the uploader's.
    if (video.blob_name) {
      try {
        const { getPlatformAccount, deleteShelbyBlob } = await import('@/lib/shelby-platform');
        const platformAccount = getPlatformAccount();
        await deleteShelbyBlob(platformAccount, video.blob_name);
      } catch (err) {
        // Log but don't block the Supabase deletion on this — an orphaned
        // Shelby blob (unreachable from the app either way, once the
        // Supabase row is gone) is a much smaller problem than a video
        // that can't be removed from the platform at all because Shelby's
        // API had a transient failure.
        console.error(`Failed to delete Shelby blob "${video.blob_name}" for video ${videoId}:`, err);
      }
    }

    // ── Delete the Supabase record ───────────────────────────────────────
    const { error: deleteError } = await supabaseAdmin
      .from('videos')
      .delete()
      .eq('video_id', videoId);

    if (deleteError) {
      console.error('[/api/videos/:id] Supabase delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete video metadata' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[/api/videos/:id] DELETE error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
