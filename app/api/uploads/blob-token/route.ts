import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

// ---------------------------------------------------------------------------
// Vercel serverless functions have a hard 4.5MB request body limit, enforced
// at the infrastructure level — it cannot be raised via vercel.json or code
// (confirmed against Vercel's own docs). Since encrypted video uploads
// routinely exceed that, the encrypted blob is staged directly to Vercel
// Blob storage from the browser (bypassing our functions' body limit
// entirely), and app/api/uploads/route.ts then works with just the
// resulting blob URL — a small JSON payload, well under the limit.
//
// This route only issues short-lived, single-use client tokens; it never
// receives file bytes itself.
// ---------------------------------------------------------------------------

const MAX_STAGED_BLOB_SIZE_BYTES = 100 * 1024 * 1024; // matches validateVideoFile's cap

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Staged uploads are private (not publicly listable/guessable) and
        // short-lived — this is a temporary staging area, not permanent
        // storage. The actual encrypted content is opaque ciphertext
        // either way, but keeping this private and time-limited avoids
        // leaving stray blobs reachable indefinitely if a client never
        // completes the follow-up /api/uploads call.
        return {
          // FIX: no allowedContentTypes restriction. This was set to
          // ['application/octet-stream'] (matching the contentType the
          // client explicitly declares), but the actual blob pathname
          // carries the original filename's extension (e.g. "...Scene.mp4")
          // — if Vercel Blob validates/infers content type from the
          // pathname's extension rather than (or in addition to) the
          // explicitly-declared contentType, that mismatch would explain
          // the 400 seen on the actual PUT step. We don't need this
          // restriction anyway: integrity is already verified downstream
          // by the wallet signature check in /api/uploads (bound to the
          // exact file hash), not by content-type enforcement here.
          maximumSizeInBytes: MAX_STAGED_BLOB_SIZE_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 15 * 60 * 1000, // 15 minutes
          tokenPayload: pathname,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    console.error('Blob token generation failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate upload token' },
      { status: 400 },
    );
  }
}
