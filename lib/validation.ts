/**
 * Input validation schemas and sanitizers
 */

// ---------------------------------------------------------------------------
// EXPIRATION VALIDATION
// ---------------------------------------------------------------------------

/**
 * Validate availability period (in days)
 * @param days - Requested availability period
 * @returns { valid: boolean; error?: string; days?: number }
 */
export function validateAvailabilityPeriod(days: unknown):
  | { valid: true; days: number }
  | { valid: false; error: string } {
  if (!Number.isInteger(days) || typeof days !== 'number') {
    return { valid: false, error: 'Availability period must be a number' };
  }

  const MIN_DAYS = 1;
  const MAX_DAYS = 365;

  if (days < MIN_DAYS) {
    return {
      valid: false,
      error: `Availability period must be at least ${MIN_DAYS} day`,
    };
  }

  if (days > MAX_DAYS) {
    return {
      valid: false,
      error: `Availability period cannot exceed ${MAX_DAYS} days`,
    };
  }

  return { valid: true, days };
}

/**
 * Validate expiration timestamp
 * @param timestamp - Unix timestamp in milliseconds
 * @returns { valid: boolean; error?: string }
 */
export function validateExpirationTimestamp(timestamp: unknown): {
  valid: boolean;
  error?: string;
} {
  if (!Number.isInteger(timestamp) || typeof timestamp !== 'number') {
    return { valid: false, error: 'Expiration timestamp must be a number' };
  }

  const now = Date.now();
  const MAX_FUTURE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

  if (timestamp <= now) {
    return { valid: false, error: 'Expiration timestamp must be in the future' };
  }

  if (timestamp > now + MAX_FUTURE_MS) {
    return {
      valid: false,
      error: 'Expiration timestamp cannot exceed 1 year in the future',
    };
  }

  return { valid: true };
}

/**
 * Check if a video has expired
 * @param expirationTimestamp - Unix timestamp in milliseconds
 * @returns true if expired, false otherwise
 */
export function isVideoExpired(expirationTimestamp: number): boolean {
  return expirationTimestamp < Date.now();
}

// ---------------------------------------------------------------------------
// METADATA VALIDATION
// ---------------------------------------------------------------------------

/**
 * Validate video title
 */
export function validateTitle(title: unknown):
  | { valid: true; title: string }
  | { valid: false; error: string } {
  if (typeof title !== 'string') {
    return { valid: false, error: 'Title must be a string' };
  }

  const trimmed = title.trim();
  const MIN_LENGTH = 3;
  const MAX_LENGTH = 200;

  if (trimmed.length < MIN_LENGTH) {
    return {
      valid: false,
      error: `Title must be at least ${MIN_LENGTH} characters`,
    };
  }

  if (trimmed.length > MAX_LENGTH) {
    return {
      valid: false,
      error: `Title cannot exceed ${MAX_LENGTH} characters`,
    };
  }

  // Check for malicious patterns (basic XSS prevention)
  if (/<script|javascript:|onerror|onclick/i.test(trimmed)) {
    return { valid: false, error: 'Title contains invalid characters' };
  }

  return { valid: true, title: trimmed };
}

/**
 * Validate video description
 */
export function validateDescription(description: unknown):
  | { valid: true; description: string }
  | { valid: false; error: string } {
  if (typeof description !== 'string' && description !== undefined) {
    return { valid: false, error: 'Description must be a string' };
  }

  if (description === undefined || description === '') {
    return { valid: true, description: '' };
  }

  const trimmed = description.trim();
  const MAX_LENGTH = 5000;

  if (trimmed.length > MAX_LENGTH) {
    return {
      valid: false,
      error: `Description cannot exceed ${MAX_LENGTH} characters`,
    };
  }

  // Check for malicious patterns
  if (/<script|javascript:|onerror|onclick/i.test(trimmed)) {
    return { valid: false, error: 'Description contains invalid characters' };
  }

  return { valid: true, description: trimmed };
}

/**
 * Validate tags array
 */
export function validateTags(tags: unknown):
  | { valid: true; tags: string[] }
  | { valid: false; error: string } {
  if (!Array.isArray(tags)) {
    return { valid: false, error: 'Tags must be an array' };
  }

  const MAX_TAGS = 20;
  const MAX_TAG_LENGTH = 50;

  if (tags.length > MAX_TAGS) {
    return {
      valid: false,
      error: `Maximum ${MAX_TAGS} tags allowed`,
    };
  }

  const validatedTags: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      return { valid: false, error: 'All tags must be strings' };
    }

    const trimmed = tag.trim();
    if (trimmed.length === 0) continue; // Skip empty tags

    if (trimmed.length > MAX_TAG_LENGTH) {
      return {
        valid: false,
        error: `Tag cannot exceed ${MAX_TAG_LENGTH} characters`,
      };
    }

    // Only allow alphanumeric, hyphens, underscores
    if (!/^[a-zA-Z0-9\-_]+$/.test(trimmed)) {
      return {
        valid: false,
        error: `Tag contains invalid characters: "${trimmed}"`,
      };
    }

    validatedTags.push(trimmed.toLowerCase());
  }

  return { valid: true, tags: validatedTags };
}

/**
 * Validate price (in smallest unit of token)
 */
export function validatePrice(price: unknown):
  | { valid: true; price: number }
  | { valid: false; error: string } {
  if (!Number.isInteger(price) || typeof price !== 'number') {
    return { valid: false, error: 'Price must be an integer' };
  }

  const MIN_PRICE = 0;
  const MAX_PRICE = 1000000000; // Adjust based on token decimals

  if (price < MIN_PRICE) {
    return {
      valid: false,
      error: `Price cannot be negative`,
    };
  }

  if (price > MAX_PRICE) {
    return {
      valid: false,
      error: `Price exceeds maximum allowed value`,
    };
  }

  return { valid: true, price };
}

// ---------------------------------------------------------------------------
// GENERIC ERRORS - Don't leak system details
// ---------------------------------------------------------------------------

/**
 * Convert detailed error to generic user-facing message
 */
export function getGenericError(
  error: unknown,
  context: 'upload' | 'download' | 'playback' | 'api'
): string {
  const messages: Record<string, string> = {
    upload: 'Upload failed. Please try again.',
    download: 'This video is no longer available.',
    playback: 'Unable to play video. Please refresh and try again.',
    api: 'Request failed. Please try again.',
  };

  return messages[context] || 'An error occurred. Please try again.';
}
