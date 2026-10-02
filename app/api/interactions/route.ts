import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { hasNonce, verifyAndConsumeNonce } from '@/lib/nonce-store';
import { createWalletSession, hasWalletSession, setWalletSessionCookie } from '@/lib/wallet-session';
import { WALLET_SESSION_PURPOSE } from '@/lib/wallet-session-constants';
import { resolveWalletInteractionMessage } from '@/lib/wallet-standard-message';
import { checkPublicKeyAddressBinding, verifyWalletSignature } from '@/lib/wallet-signature';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{1,64}$/.test(value);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let walletSessionToken: string | null = null;
  const successResponse = (body: unknown, status = 200): NextResponse => {
    const response = NextResponse.json(body, { status });
    if (walletSessionToken) setWalletSessionCookie(response, walletSessionToken);
    return response;
  };

  try {
    const body = await request.json();
    const {
      walletAddress,
      publicKey,
      signature,
      signedMessage,
      signedContent,
      nonce,
      action,
      payload,
    } = body ?? {};

    if (
      !isAddress(walletAddress) ||
      !['comment', 'comment-delete', 'comment-like', 'engagement', 'session', 'subscription', 'subscription-status'].includes(action) ||
      payload === null || typeof payload !== 'object' || Array.isArray(payload)
    ) {
      return NextResponse.json({ error: 'Invalid wallet interaction request' }, { status: 400 });
    }

    const normalizedWallet = walletAddress.toLowerCase();
    const hasSession = await hasWalletSession(request, normalizedWallet);

    if (!hasSession) {
      if (
        typeof publicKey !== 'string' || !publicKey ||
        typeof signature !== 'string' || !signature ||
        typeof signedMessage !== 'string' || !signedMessage ||
        typeof nonce !== 'string' || !nonce
      ) {
        return NextResponse.json(
          {
            error: 'Wallet signature required',
            code: 'wallet_signature_required',
            requiresSignature: true,
          },
        );
      }

      const expectedMessage = `ShelbyFlix ${action}: ${nonce}\n${stableStringify(payload)}`;
      const key = normalizedWallet;
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'unknown';
      if (!(await hasNonce(key, nonce, ip))) {
        return NextResponse.json({ error: 'Nonce not found or expired; request a new challenge' }, { status: 401 });
      }
      if (!(await verifyAndConsumeNonce(key, nonce, ip))) {
        return NextResponse.json({ error: 'Nonce expired or IP does not match' }, { status: 401 });
      }
      const messageToVerify = resolveWalletInteractionMessage(
        signedMessage,
        expectedMessage,
        nonce,
      );
      if (!messageToVerify) {
        const normalizedFullMessage = signedMessage.replace(/\r\n?/g, '\n');
        const normalizedExpectedMessage = expectedMessage.replace(/\r\n?/g, '\n');
        const expectedAction = `ShelbyFlix ${action}: ${nonce}`;
        const expectedPayload = stableStringify(payload);
        const diagnostics = {
          actionIncluded: normalizedFullMessage.includes(expectedAction),
          payloadIncluded: normalizedFullMessage.includes(expectedPayload),
          fullMessageLength: signedMessage.length,
          signedContentLength: typeof signedContent === 'string' ? signedContent.length : null,
          nonceIncluded: normalizedFullMessage.includes(nonce),
          expectedMessageIncluded: normalizedFullMessage.includes(normalizedExpectedMessage),
        };
        console.warn('Wallet interaction fullMessage did not include the expected action:', {
          action,
          ...diagnostics,
        });
        return NextResponse.json({
          error: 'Signature does not match this action',
          code: 'wallet_signed_message_mismatch',
          diagnostics,
        }, { status: 401 });
      }

      const verification = await verifyWalletSignature({
        publicKey,
        signature,
        message: messageToVerify,
      });
      if (!verification.valid) {
        console.error('Wallet interaction signature verification failed:', {
          scheme: verification.scheme,
          reason: verification.reason,
          detail: verification.detail,
          messageBytes: Buffer.byteLength(messageToVerify, 'utf8'),
          publicKeyHexLength: publicKey.length,
          signatureHexLength: signature.length,
        });
        if (verification.reason === 'unavailable') {
          return NextResponse.json({ error: 'Wallet signature verification is temporarily unavailable' }, { status: 503 });
        }
        if (verification.reason === 'unsupported') {
          return NextResponse.json({ error: 'Unsupported wallet signature format' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Invalid wallet signature' }, { status: 401 });
      }

      const binding = checkPublicKeyAddressBinding({ publicKey, walletAddress });
      if (!binding.bound) {
        return NextResponse.json({ error: 'The signing key does not match this wallet address' }, { status: 401 });
      }

      walletSessionToken = await createWalletSession(normalizedWallet);
    }

    if (action === 'session' && payload.purpose !== WALLET_SESSION_PURPOSE) {
      return NextResponse.json({ error: 'Invalid wallet session authorization purpose' }, { status: 400 });
    }

    if (action === 'session') {
      return successResponse({ authorized: true });
    }

    const admin = getSupabaseAdmin();

    if (action === 'comment') {
      const { videoId, text, parentCommentId } = payload as Record<string, unknown>;
      if (typeof videoId !== 'string' || !videoId || typeof text !== 'string' || !text.trim()) {
        return NextResponse.json({ error: 'A video and comment text are required' }, { status: 400 });
      }
      const { data: profile, error: profileError } = await admin
        .from('users')
        .select('username, avatar_url')
        .eq('wallet_address', normalizedWallet)
        .maybeSingle();
      if (profileError) throw profileError;
      const { data, error } = await admin.from('comments').insert({
        comment_id: `comment_${Date.now()}_${crypto.randomUUID()}`,
        video_id: videoId,
        user_wallet: normalizedWallet,
        user_name: profile?.username ?? normalizedWallet,
        text: text.trim(),
        likes: 0,
        timestamp: Date.now(),
        parent_comment_id: typeof parentCommentId === 'string' ? parentCommentId : null,
      }).select().single();
      if (error) throw error;
      return successResponse(data, 201);
    }

    if (action === 'comment-delete') {
      const { commentId } = payload as Record<string, unknown>;
      if (typeof commentId !== 'string' || !commentId) {
        return NextResponse.json({ error: 'A comment ID is required' }, { status: 400 });
      }
      const { data: comment, error: lookupError } = await admin
        .from('comments').select('user_wallet').eq('comment_id', commentId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!comment || comment.user_wallet.toLowerCase() !== normalizedWallet) {
        return NextResponse.json({ error: 'Comment not found or not owned by this wallet' }, { status: 403 });
      }
      const { error: repliesError } = await admin.from('comments').delete().eq('parent_comment_id', commentId);
      if (repliesError) throw repliesError;
      const { error } = await admin.from('comments').delete().eq('comment_id', commentId);
      if (error) throw error;
      return successResponse({ success: true });
    }

    if (action === 'comment-like') {
      const { commentId } = payload as Record<string, unknown>;
      if (typeof commentId !== 'string' || !commentId) {
        return NextResponse.json({ error: 'A comment ID is required' }, { status: 400 });
      }
      const { data: comment, error: lookupError } = await admin
        .from('comments').select('likes').eq('comment_id', commentId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
      const { error } = await admin.from('comments')
        .update({ likes: comment.likes + 1 }).eq('comment_id', commentId);
      if (error) throw error;
      return successResponse({ success: true });
    }

    if (action === 'engagement') {
      const { videoId, liked, disliked } = payload as Record<string, unknown>;
      if (
        typeof videoId !== 'string' || !videoId ||
        typeof liked !== 'boolean' || typeof disliked !== 'boolean' ||
        (liked && disliked)
      ) {
        return NextResponse.json({ error: 'Invalid engagement values' }, { status: 400 });
      }
      const { error } = await admin.rpc('set_video_engagement', {
        video_id_param: videoId,
        user_wallet_param: normalizedWallet,
        liked_param: liked,
        disliked_param: disliked,
      });
      if (error) throw error;
      return successResponse({ success: true });
    }

    const { channelId } = payload as Record<string, unknown>;
    if (!isAddress(channelId)) {
      return NextResponse.json({ error: 'A valid channel wallet is required' }, { status: 400 });
    }
    const channelWallet = channelId.toLowerCase();

    if (action === 'subscription-status') {
      const { data: existing, error } = await admin
        .from('subscriptions')
        .select('subscriber_wallet')
        .eq('subscriber_wallet', normalizedWallet)
        .eq('channel_wallet', channelWallet)
        .maybeSingle();
      if (error) throw error;
      return successResponse({ subscribed: Boolean(existing) });
    }

    const { data: existing, error: fetchError } = await admin
      .from('subscriptions').select('subscriber_wallet')
      .eq('subscriber_wallet', normalizedWallet).eq('channel_wallet', channelWallet).maybeSingle();
    if (fetchError) throw fetchError;
    if (existing) {
      const { error } = await admin.from('subscriptions').delete()
        .eq('subscriber_wallet', normalizedWallet).eq('channel_wallet', channelWallet);
      if (error) throw error;
      return successResponse({ subscribed: false });
    }
    const { error } = await admin.from('subscriptions').insert({
      subscriber_wallet: normalizedWallet,
      channel_wallet: channelWallet,
      timestamp: Date.now(),
    });
    if (error) throw error;
    return successResponse({ subscribed: true });
  } catch (error) {
    console.error('Failed to process wallet interaction:', error);
    return NextResponse.json({ error: 'Wallet interaction failed' }, { status: 500 });
  }
}
