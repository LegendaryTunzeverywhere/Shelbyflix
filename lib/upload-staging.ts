/**
 * Shared between app/api/uploads/staging-token/route.ts and
 * app/api/uploads/route.ts — kept here rather than exported from a
 * route.ts file, since Next.js route handlers are only meant to export
 * HTTP method handlers.
 */
export const STAGING_BUCKET = 'uploads-staging';
