/**
 * Environment variable validator for ShelbyFlix.
 * Runs at server initialization to fail fast on misconfiguration.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface EnvVarSpec {
  name: string;
  required: boolean;
  format: 'url' | 'secret' | 'string';
  minLength?: number;
}

/**
 * Keys that SHOULD be declared in `.env.example` as operator documentation.
 * Their absence is a documentation gap — warn once per missing key, never block startup.
 * See Requirements 1.7, 1.8.
 */
const EXAMPLE_KEYS_REQUIRED = [
  'NEXT_PUBLIC_ACCESS_CONTROL_MODULE_ADDRESS',
  'NEXT_PUBLIC_ACCESS_BACKEND',
] as const;

/**
 * Process-lifetime dedupe so each missing key warns exactly once,
 * even if `validateEnvironment` is invoked multiple times (e.g. dev rebuilds).
 */
const warnedExampleKeys = new Set<string>();

/**
 * Reset the per-process dedupe cache. Intended for tests only.
 *
 * @internal
 */
export function __resetEnvValidatorStateForTests(): void {
  warnedExampleKeys.clear();
}

/**
 * Read `.env.example` from disk and warn (never throw) once per key in
 * `EXAMPLE_KEYS_REQUIRED` that is absent from the file.
 *
 * A key is considered declared when the file contains a line matching
 * `^\s*KEY\s*=` (leading whitespace allowed; value and trailing content ignored).
 * Lines where the key appears only inside a comment are ignored.
 *
 * If `.env.example` cannot be read (missing, permission denied, etc.) the
 * function silently returns — the soft check is about documentation, not runtime env.
 *
 * Per Requirement 1.8: emits exactly one single-line `console.warn` per missing key,
 * and SHALL NOT throw or otherwise block process startup.
 */
export function checkEnvExampleHasKeys(): void {
  let contents: string;
  try {
    contents = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
  } catch {
    // `.env.example` not present / unreadable — this is a soft check, skip silently.
    return;
  }

  for (const key of EXAMPLE_KEYS_REQUIRED) {
    if (warnedExampleKeys.has(key)) continue;

    // Match a declaration line: start-of-line (optional ws) + KEY + (optional ws) + `=`.
    // The required `\s*=` after the key name prevents a longer name such as
    // `NEXT_PUBLIC_ACCESS_BACKEND_EXTRA` from matching the shorter key.
    const declaration = new RegExp(
      String.raw`^\s*` + escapeRegex(key) + String.raw`\s*=`,
      'm',
    );
    if (!declaration.test(contents)) {
      // Single-line warn naming the missing key; no stack trace, no throw.
      console.warn(
        `[env-validator] .env.example is missing declared key: ${key}`,
      );
      warnedExampleKeys.add(key);
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REQUIRED_ENV_VARS: EnvVarSpec[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', required: true, format: 'url' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, format: 'secret' },
  { name: 'NEXT_PUBLIC_SHELBYNET_NODE_URL', required: true, format: 'url' },
  { name: 'NEXT_PUBLIC_SHELBYNET_INDEXER_URL', required: true, format: 'url' },
  { name: 'SHELBY_API_KEY', required: true, format: 'secret' },
  { name: 'CRON_SECRET', required: true, format: 'secret', minLength: 32 },
  { name: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', required: true, format: 'string' },
];

/**
 * Validate that a string is a well-formed HTTPS URL.
 * Returns true if the string parses as a URL with the `https:` protocol.
 */
export function isValidHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate all required environment variables.
 * Throws a descriptive error naming ALL missing or invalid variables.
 *
 * @param mode - 'production' or 'development'. URL format validation is only enforced in production.
 */
export function validateEnvironment(mode: 'production' | 'development'): void {
  // Soft documentation check for .env.example — warn-only, never blocks startup.
  // Runs before the hard required-var loop so operators see the warn even when
  // a later required-var failure throws. Per Requirements 1.7, 1.8.
  checkEnvExampleHasKeys();

  const errors: string[] = [];

  for (const spec of REQUIRED_ENV_VARS) {
    const value = process.env[spec.name];

    // Check presence
    if (!value) {
      errors.push(`Missing required environment variable: ${spec.name}`);
      continue;
    }

    // Validate SUPABASE_SERVICE_ROLE_KEY does not start with NEXT_PUBLIC_
    if (spec.name === 'SUPABASE_SERVICE_ROLE_KEY' && value.startsWith('NEXT_PUBLIC_')) {
      errors.push(
        `${spec.name} must not start with "NEXT_PUBLIC_" — this key should never be exposed to the client`
      );
    }

    // Validate URL format in production mode
    if (spec.format === 'url' && mode === 'production') {
      if (!isValidHttpsUrl(value)) {
        errors.push(
          `${spec.name} must be a valid HTTPS URL, got: "${value}"`
        );
      }
    }

    // Validate minimum length for secrets
    if (spec.minLength && value.length < spec.minLength) {
      errors.push(
        `${spec.name} must be at least ${spec.minLength} characters long (got ${value.length})`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }
}
