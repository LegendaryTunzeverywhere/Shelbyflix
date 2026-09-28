/**
 * Clean up expired videos from the database AND reclaim their Shelby storage.
 *
 * POST /api/admin/cleanup-expired
 *
 * This endpoint is designed to be called by:
 * - Scheduled cron jobs (e.g., every 6 hours)
 * - Manual administrative triggers
 * - Serverless cleanup functions
 *
 * Returns:
 * - deletedCount: number of video rows removed
 * - blobsDeletedCount: number of Shelby blobs reclaimed
 * - errors: array of error messages for videos that failed to delete
 *
 * WHY THIS DELETES BLOBS, NOT JUST ROWS
 * -------------------------------------
 * This route used to do a single bulk
 *
 *     DELETE FROM videos WHERE expiration_timestamp < now()
 *
 * and throw `blob_name` away with everything else, leaving the encrypted
 * Shelby blob registered on chain forever. That was a silent leak before, and
 * a much worse one now: the deployed `register_blob` no longer accepts an
 * expiry argument (there is no `extend_blob_expiration` or
 * `set_blob_expiration` entry function on the current contracts), so Shelby
 * can never reclaim a blob on its own. This job is the only reclamation path.
 *
 * Expiry itself is still enforced correctly without the storage-layer
 * backstop: listings filter on `expiration_timestamp`, and `resolveAccess()`
 * returns `reason: 'expired'` so `/api/videos/:id/decryption-key` withholds
 * the AES key. The ciphertext is useless; this route is what stops it costing
 * money forever.
 *
 * ORDERING AND FAILURE BEHAVIOUR
 * ------------------------------
 * Blob first, row second. If the blob delete fails for a recoverable reason we
 * deliberately KEEP the row, so the next run retries instead of destroying the
 * only record of which blob to reclaim. Deleting the row after a failed blob
 * delete would make the leak permanent and unrecoverable.
 *
 * Fails closed: if the platform account cannot be loaded (missing
 * SHELBY_PLATFORM_PRIVATE_KEY or SHELBY_API_KEY) nothing is deleted at all,
 * because those credentials are the only way to sign the on-chain
 * `delete_object`. Deleting rows in that state would orphan storage with no
 * way back.
 *
 * SECURITY: Protected by x-cron-secret header authentication.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getPlatformAccount, deleteShelbyBlob } from '@/lib/shelby-platform';

/**
 * Blobs are reclaimed with one on-chain transaction each, so this job is
 * deliberately bounded. The cron runs every few hours and each run makes
 * forward progress; an unbounded loop could hit a serverless timeout partway
 * through and leave the remaining rows for the next run anyway.
 */
const MAX_BATCH_SIZE = 25;

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
    !timingSafeEqual(new Uint8Array(Buffer.from(headerSecret)), new Uint8Array(Buffer.from(cronSecret)))
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

    // Step 1: Get expired videos, bounded to one batch.
    const { data: expiredVideos, error: fetchError } = await supabaseAdmin
      .from('videos')
      .select('id, video_id, blob_name')
      .lt('expiration_timestamp', now)
      .limit(MAX_BATCH_SIZE);

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
        blobsDeletedCount: 0,
        errors: [],
      });
    }

    console.info(JSON.stringify({ level: 'info', route: '/api/admin/cleanup-expired', event: 'expired_videos_found', count: expiredVideos.length, timestamp: new Date().toISOString() }));

    // Step 2: Resolve the platform account ONCE, before deleting anything.
    //
    // Fail closed. The platform account is the on-chain owner of every blob
    // and the only account that can sign `delete_object`. If it cannot be
    // loaded we must not remove the rows: doing so would destroy the only
    // record of which blob belongs to which video and orphan that storage
    // with no way to reclaim it.
    let platformAccount;
    try {
      platformAccount = getPlatformAccount();
    } catch (err) {
      console.error(
        '[/api/admin/cleanup-expired] platform account unavailable, refusing to delete rows:',
        err,
      );
      return NextResponse.json(
        {
          error:
            'Storage reclamation is not configured on this server, so expired rows were ' +
            'left intact rather than orphaning their Shelby blobs. Set ' +
            'SHELBY_PLATFORM_PRIVATE_KEY and SHELBY_API_KEY.',
          deletedCount: 0,
          blobsDeletedCount: 0,
          errors: [],
        },
        { status: 503 },
      );
    }

    // Step 3: Reclaim each blob, then drop its row.
    const errors: string[] = [];
    const deletedVideoIds: string[] = [];
    let blobsDeletedCount = 0;
    let rowsWithoutBlob = 0;

    for (const video of expiredVideos) {
      const videoId = video.video_id as string;
      const blobName =
        typeof video.blob_name === 'string' ? video.blob_name.trim() : '';

      if (blobName.length > 0) {
        try {
          await deleteShelbyBlob(platformAccount, blobName);
          blobsDeletedCount++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);

          // An already-absent blob is the desired end state, not a failure —
          // a previous run may have reclaimed it and died before the row
          // delete. Treat it as success so the row can finally go.
          if (isAlreadyDeleted(message)) {
            blobsDeletedCount++;
            console.info(
              `[/api/admin/cleanup-expired] blob "${blobName}" already gone; removing row only`,
            );
          } else {
            // Keep the row so the next run can retry the reclamation.
            errors.push(`${videoId}: blob delete failed — ${message}`);
            console.error(
              `[/api/admin/cleanup-expired] blob delete failed for "${blobName}" (${videoId}); keeping row for retry:`,
              message,
            );
            continue;
          }
        }
      } else {
        // No blob on file (legacy row, or never-completed upload). There is
        // nothing to reclaim, so the row can go.
        rowsWithoutBlob++;
      }

      const { error: rowDeleteError } = await supabaseAdmin
        .from('videos')
        .delete()
        .eq('video_id', videoId);

      if (rowDeleteError) {
        errors.push(
          `${videoId}: row delete failed — ${JSON.stringify({ code: rowDeleteError.code, message: rowDeleteError.message })}`,
        );
        continue;
      }

      deletedVideoIds.push(videoId);
    }

    console.info(
      JSON.stringify({
        level: errors.length > 0 ? 'warn' : 'info',
        route: '/api/admin/cleanup-expired',
        event: 'cleanup_completed',
        deletedCount: deletedVideoIds.length,
        blobsDeletedCount,
        rowsWithoutBlob,
        errorCount: errors.length,
        timestamp: new Date().toISOString(),
      }),
    );

    return NextResponse.json({
      message:
        errors.length > 0
          ? 'Cleanup completed with errors'
          : 'Cleanup completed successfully',
      deletedCount: deletedVideoIds.length,
      blobsDeletedCount,
      rowsWithoutBlob,
      // True when the batch was full, i.e. there is likely more to do. The
      // cron can treat this as a signal to run again immediately.
      moreRemaining: expiredVideos.length === MAX_BATCH_SIZE,
      errors,
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

/**
 * Does this error mean the blob was already gone?
 *
 * `delete_object` on a blob that no longer exists aborts on chain, and the
 * exact vm_status varies by contract version, so match loosely but only on
 * phrases that unambiguously indicate absence — never on a generic "error".
 */
function isAlreadyDeleted(message: string): boolean {
  const m = message.toLowerCase();
  return (
    /e_blob_not_found/.test(m) ||
    /blob[_ ]not[_ ]found/.test(m) ||
    /blob does not exist/.test(m) ||
    /no such blob/.test(m) ||
    /object not found/.test(m) ||
    /e_not_found/.test(m) ||
    /unknown blob/.test(m)
  );
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
