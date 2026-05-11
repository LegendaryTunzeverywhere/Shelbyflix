import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Clean up expired videos from the database
 *
 * POST /api/admin/cleanup-expired
 *
 * This endpoint is designed to be called by:
 * - Scheduled cron jobs (e.g., every 6 hours)
 * - Manual administrative triggers
 * - Serverless cleanup functions
 *
 * Returns:
 * - deletedCount: number of videos deleted
 * - errors: array of error messages for videos that failed to delete
 *
 * SECURITY: Protected by x-cron-secret header authentication.
 */

// ---------------------------------------------------------------------------
// Auth helper — validates x-cron-secret header using constant-time comparison
// ---------------------------------------------------------------------------
function authenticateCronRequest(req: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is not configured, the service cannot authenticate requests
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503 }
    );
  }

  const headerSecret = req.headers.get('x-cron-secret') ?? '';

  // Use constant-time comparison to prevent timing attacks.
  // Both buffers must be the same length for timingSafeEqual, so we compare
  // against the configured secret length. If lengths differ, reject.
  if (
    headerSecret.length !== cronSecret.length ||
    !timingSafeEqual(Buffer.from(headerSecret), Buffer.from(cronSecret))
  ) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Authentication passed
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/admin/cleanup-expired
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = authenticateCronRequest(req);
  if (authError) return authError;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const now = Date.now();

    // Step 1: Get all expired videos
    const { data: expiredVideos, error: fetchError } = await supabaseAdmin
      .from('videos')
      .select('id, video_id, blob_name')
      .lt('expiration_timestamp', now);

    if (fetchError) {
      console.error('[/api/admin/cleanup-expired] Failed to fetch expired videos:', JSON.stringify({ code: fetchError.code, message: fetchError.message }));
      return NextResponse.json(
        { error: 'Internal server error', deletedCount: 0, errors: [] },
        { status: 500 }
      );
    }

    if (!expiredVideos || expiredVideos.length === 0) {
      return NextResponse.json({
        message: 'No expired videos to clean up',
        deletedCount: 0,
        errors: [],
      });
    }

    console.info(JSON.stringify({ level: 'info', route: '/api/admin/cleanup-expired', event: 'expired_videos_found', count: expiredVideos.length, timestamp: new Date().toISOString() }));

    // Step 2: Delete expired videos
    const { error: deleteError } = await supabaseAdmin
      .from('videos')
      .delete()
      .lt('expiration_timestamp', now);

    if (deleteError) {
      console.error('[/api/admin/cleanup-expired] Failed to delete expired videos:', JSON.stringify({ code: deleteError.code, message: deleteError.message }));
      return NextResponse.json(
        { error: 'Internal server error', deletedCount: 0, errors: [] },
        { status: 500 }
      );
    }

    console.info(JSON.stringify({ level: 'info', route: '/api/admin/cleanup-expired', event: 'cleanup_completed', deletedCount: expiredVideos.length, timestamp: new Date().toISOString() }));

    return NextResponse.json({
      message: 'Cleanup completed successfully',
      deletedCount: expiredVideos.length,
      errors: [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[/api/admin/cleanup-expired] Cleanup endpoint error:', err);
    return NextResponse.json(
      { error: 'Internal server error', deletedCount: 0, errors: [] },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/cleanup-expired
// Returns status of expired videos (for monitoring)
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = authenticateCronRequest(req);
  if (authError) return authError;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const now = Date.now();

    // Count expired videos
    const { count: expiredCount } = await supabaseAdmin
      .from('videos')
      .select('id', { count: 'exact' })
      .lt('expiration_timestamp', now);

    // Count videos expiring soon (within 7 days)
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const { count: expiringSoonCount } = await supabaseAdmin
      .from('videos')
      .select('id', { count: 'exact' })
      .gt('expiration_timestamp', now)
      .lt('expiration_timestamp', now + sevenDaysMs);

    // Count total videos
    const { count: totalCount } = await supabaseAdmin
      .from('videos')
      .select('id', { count: 'exact' });

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      stats: {
        total: totalCount ?? 0,
        expired: expiredCount ?? 0,
        expiringSoon: expiringSoonCount ?? 0,
      },
    });
  } catch (err) {
    console.error('[/api/admin/cleanup-expired] Status check error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
