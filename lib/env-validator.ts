/**
 * Environment variable validator for ShelbyFlix.
 * Runs at server initialization to fail fast on misconfiguration.
 */

export interface EnvVarSpec {
  name: string;
  required: boolean;
  format: 'url' | 'secret' | 'string';
  minLength?: number;
}

const REQUIRED_ENV_VARS: EnvVarSpec[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', required: true, format: 'url' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, format: 'secret' },
  { name: 'NEXT_PUBLIC_SHELBYNET_NODE_URL', required: true, format: 'url' },
  { name: 'NEXT_PUBLIC_SHELBYNET_INDEXER_URL', required: true, format: 'url' },
  { name: 'NEXT_SHELBY_API_KEY', required: true, format: 'string' },
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
