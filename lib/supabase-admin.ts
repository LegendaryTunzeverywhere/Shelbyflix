import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for server-only privileged writes.
 *
 * Used by routes that must bypass RLS to insert / update rows that clients
 * are not permitted to touch directly — notably `video_purchases` (RLS is on
 * with no policies) and `videos.access_mode` / `allowlist` / `unlock_at`
 * updates performed on behalf of the owner after server-side auth.
 *
 * Validates Requirements 10.5: `video_purchases` rows are inserted only via
 * the server-side service role key; clients have no direct write access.
 *
 * The client is:
 * - Lazily instantiated on first call so importing this module never crashes
 *   a build / bundle that doesn't actually use admin privileges.
 * - Cached at module scope so repeated calls within the same server runtime
 *   reuse a single client instance.
 * - Configured with `autoRefreshToken: false` and `persistSession: false`
 *   because it is server-only and never participates in a user session.
 *
 * Reads two env vars:
 * - `NEXT_PUBLIC_SUPABASE_URL` — reused from the existing anon client config.
 * - `SUPABASE_SERVICE_ROLE_KEY` — server-only, must NOT be prefixed with
 *   `NEXT_PUBLIC_` so Next.js does not ship it to the browser bundle.
 */

let cachedAdminClient: SupabaseClient | null = null;

/**
 * Returns the cached service-role Supabase client, instantiating it on first
 * call. Throws a descriptive error if either required env var is missing so
 * misconfiguration surfaces immediately at the call site rather than as a
 * silent auth failure deeper in the stack.
 *
 * @throws Error when `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`
 *   is not set. (Req 10.5)
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      'Supabase admin client unavailable: NEXT_PUBLIC_SUPABASE_URL is not set. ' +
        'Add it to your environment (e.g. .env.local) before invoking server routes ' +
        'that require service-role access.'
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      'Supabase admin client unavailable: SUPABASE_SERVICE_ROLE_KEY is not set. ' +
        'This is a server-only secret (no NEXT_PUBLIC_ prefix) required by routes ' +
        'that bypass RLS — e.g. /api/payments/verify and /api/videos/:id/access-config. ' +
        'Copy the service_role key from Supabase project settings into your server env.'
    );
  }

  cachedAdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedAdminClient;
}
