import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { STAGING_BUCKET } from '@/lib/upload-staging';

// ---------------------------------------------------------------------------
// POST /api/uploads/staging-token
//
// FIX: this was previously built on Vercel Blob's client-upload flow
// (handleUpload from @vercel/blob/client). That hit a confirmed, currently
// unresolved bug on Vercel's own infrastructure — the actual PUT to
// https://vercel.com/api/blob/ returns a response with no
// Access-Control-Allow-Origin header, which the browser blocks as a CORS
// failure. Reported independently by another developer with an identical
// environment (Next.js App Router, Hobby plan) and identical symptoms;
// Vercel's own support confirmed it needs internal investigation with no
// fix available (community.vercel.com/t/46967). Not something fixable in
// application code.
//
// Replaced with the equivalent pattern using Supabase Storage instead,
// which this project already has a client for and isn't affected by that
// Vercel-specific bug:
//   1. Server ensures a private "uploads-staging" bucket exists (created
//      programmatically here — no manual dashboard step needed, unlike
//      Vercel Blob).
//   2. Server issues a signed upload URL + token (createSignedUploadUrl),
//      valid for 2 hours (Supabase's fixed TTL for these).
//   3. Browser uploads the encrypted blob directly to Supabase Storage
//      using that token (bypasses our own functions' body limit entirely,
//      same as the Vercel Blob approach was meant to).
//   4. /api/uploads fetches the bytes server-to-server from Supabase
//      Storage and cleans up the staged file afterward — same shape as
//      before, just pointed at a different (working) vendor.
// ---------------------------------------------------------------------------

const MAX_STAGED_BLOB_SIZE_BYTES = 100 * 1024 * 1024; // matches validateVideoFile's cap

let bucketEnsured = false;

async function ensureStagingBucket(): Promise<void> {
  if (bucketEnsured) return;

  const admin = getSupabaseAdmin();
  const { error } = await admin.storage.createBucket(STAGING_BUCKET, {
    public: false,
    fileSizeLimit: MAX_STAGED_BLOB_SIZE_BYTES,
    allowedMimeTypes: ['application/octet-stream'],
  });

  // "already exists"-style errors are expected on every call after the
  // first — this isn't a one-time setup step, it's checked (cheaply, once
  // per server instance via bucketEnsured) on every token request so a
  // fresh deployment/instance never requires a manual dashboard step.
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }

  bucketEnsured = true;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    const pathname = body?.pathname;

    if (typeof pathname !== 'string' || pathname.trim().length === 0) {
      return NextResponse.json({ error: 'Missing required field: pathname' }, { status: 400 });
    }
    // Same sanitisation as blob names elsewhere in this app — alphanumeric,
    // underscore, hyphen, dot only. Prevents path traversal into the bucket.
    if (!/^[\w.-]+$/.test(pathname)) {
      return NextResponse.json({ error: 'Invalid pathname' }, { status: 400 });
    }

    await ensureStagingBucket();

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.storage
      .from(STAGING_BUCKET)
      .createSignedUploadUrl(pathname, { upsert: true });

    if (error || !data) {
      console.error('Failed to create signed upload URL:', error);
      return NextResponse.json({ error: 'Failed to create staging upload URL' }, { status: 500 });
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      bucket: STAGING_BUCKET,
    });
  } catch (err) {
    console.error('Staging token generation failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate staging token' },
      { status: 500 },
    );
  }
}
