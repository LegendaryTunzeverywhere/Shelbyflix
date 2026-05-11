/**
 * Next.js Instrumentation Hook
 *
 * This file is automatically loaded by Next.js once when the server starts.
 * It validates that all required environment variables are present and correctly
 * formatted, causing the app to fail fast with clear error messages on
 * misconfiguration — before any traffic is served.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run environment validation on the server (Node.js runtime).
  // The instrumentation hook can also run in the Edge runtime, but
  // env validation only makes sense in the Node.js server context.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnvironment } = await import('./lib/env-validator');

    const mode: 'production' | 'development' =
      process.env.NODE_ENV === 'production' ? 'production' : 'development';

    // This will throw with a descriptive error listing all missing/invalid
    // variables if the environment is misconfigured, preventing the server
    // from starting and serving traffic.
    validateEnvironment(mode);
  }
}
