import { NextRequest, NextResponse } from 'next/server';
import { parseAllowedOrigins, isOriginAllowed, buildCorsHeaders } from '@/lib/cors';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_COOKIE_MAX_AGE,
  CSRF_EXEMPT_PATHS,
} from '@/lib/csrf-constants';
import {
  RATE_LIMITS,
  checkRateLimit,
  pruneRateLimitStore,
  RateLimitEntry,
} from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// Edge-compatible CSRF helpers (Web Crypto API — no Node.js crypto needed)
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random CSRF token using Web Crypto API.
 * Returns a 32-byte hex-encoded string (64 characters).
 */
function generateCsrfTokenEdge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time comparison of two strings to prevent timing attacks.
 * Edge-compatible (no Node.js Buffer or timingSafeEqual needed).
 */
function verifyCsrfTokenEdge(headerToken: string, cookieToken: string): boolean {
  if (!headerToken || !cookieToken) {
    return false;
  }
  if (headerToken.length !== cookieToken.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < headerToken.length; i++) {
    mismatch |= headerToken.charCodeAt(i) ^ cookieToken.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Check if a given pathname is exempt from CSRF validation.
 */
function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.includes(pathname);
}

// ---------------------------------------------------------------------------
// CORS allowlist (parsed once at module level for O(1) lookups)
// ---------------------------------------------------------------------------
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

// ---------------------------------------------------------------------------
// Rate limiting (in-memory — resets on server restart, good enough for Edge)
// ---------------------------------------------------------------------------
const rateLimitStore = new Map<string, RateLimitEntry>();

/** Timestamp of the last prune operation */
let lastPruneAt = Date.now();

/** Prune interval in milliseconds (~60 seconds) */
const PRUNE_INTERVAL_MS = 60_000;

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * Resolve the rate limit config for a given pathname and HTTP method.
 * Checks method-specific keys first (e.g. `/api/auth/check-access:POST`),
 * then pathname-only keys, then falls back to `default`.
 */
function resolveRateLimitConfig(pathname: string, method: string) {
  // Check method-specific key first (most specific)
  const methodKey = `${pathname}:${method}`;
  if (RATE_LIMITS[methodKey]) {
    return { config: RATE_LIMITS[methodKey], endpoint: methodKey };
  }

  // Check pathname-only keys, match longest prefix first
  const pathKeys = Object.keys(RATE_LIMITS).filter(
    (k) => k !== 'default' && !k.includes(':')
  );
  for (const key of pathKeys.sort((a, b) => b.length - a.length)) {
    if (pathname === key || pathname.startsWith(key + '/')) {
      return { config: RATE_LIMITS[key], endpoint: key };
    }
  }

  // Fall back to default
  return { config: RATE_LIMITS['default'], endpoint: 'default' };
}

// ---------------------------------------------------------------------------
// Security headers applied to ALL responses (not just /api)
// ---------------------------------------------------------------------------
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'X-XSS-Protection':          '1; mode=block',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Permissions-Policy':        'camera=(), microphone=(), geolocation=()',
  // Strict CSP — 'unsafe-eval' is required in development for Next.js Fast Refresh (HMR).
  // In production builds, it is omitted to prevent script injection.
  'Content-Security-Policy': [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''} https://accounts.google.com https://www.googletagmanager.com https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https: wss:",
    "font-src 'self' data:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; '),
  // HSTS with preload — ensures browsers always use HTTPS
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  // Cross-origin isolation headers
  // Use 'same-origin-allow-popups' so OAuth popups (e.g. Petra Web social login)
  // can postMessage back to the main window after completing auth.
  'Cross-Origin-Opener-Policy':   'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // Note: require-corp may break third-party resources (images, scripts from CDNs).
  // Change to 'credentialless' or remove if third-party resources fail to load.
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

function addSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // ── Rate-limit API routes ──────────────────────────────────────────────
  if (pathname.startsWith('/api')) {
    // Periodically prune stale entries to prevent unbounded memory growth
    const now = Date.now();
    if (now - lastPruneAt >= PRUNE_INTERVAL_MS) {
      lastPruneAt = now;
      pruneRateLimitStore(rateLimitStore);
    }

    const ip = getClientIp(req);
    const { config, endpoint } = resolveRateLimitConfig(pathname, req.method);

    // Build rate limit key as IP:endpoint (or just IP for default)
    const rateLimitKey = endpoint === 'default' ? ip : `${ip}:${endpoint}`;

    const result = checkRateLimit(rateLimitKey, config, rateLimitStore);
    if (!result.allowed) {
      const res = new NextResponse(
        JSON.stringify({ error: 'Too many requests. Please slow down.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(result.retryAfterSec ?? 60),
          },
        }
      );
      return addSecurityHeaders(res);
    }
  }

  // ── Enforce MAX_FILE_SIZE_BYTES for upload endpoint ──────────────────────
  if (pathname === '/api/uploads' && req.method === 'POST') {
    const contentLength = req.headers.get('content-length');
    const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
      const res = new NextResponse(
        JSON.stringify({ error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB` }),
        { status: 413, headers: { 'Content-Type': 'application/json' } }
      );
      return addSecurityHeaders(res);
    }
  }

  // ── CORS validation for API routes ──────────────────────────────────────
  if (pathname.startsWith('/api')) {
    const origin = req.headers.get('origin');
    const method = req.method;

    // Handle OPTIONS preflight requests
    if (method === 'OPTIONS' && origin) {
      if (isOriginAllowed(origin, allowedOrigins)) {
        const preflightRes = new NextResponse(null, {
          status: 204,
          headers: buildCorsHeaders(origin),
        });
        return addSecurityHeaders(preflightRes);
      }
      // Reject preflight from unauthorized origins
      const res = new NextResponse(
        JSON.stringify({ error: 'Origin not allowed' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
      return addSecurityHeaders(res);
    }

    // Validate Origin on state-changing methods (POST, PATCH, DELETE)
    if (['POST', 'PATCH', 'DELETE'].includes(method)) {
      if (!origin || !isOriginAllowed(origin, allowedOrigins)) {
        const res = new NextResponse(
          JSON.stringify({ error: 'Origin not allowed' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
        return addSecurityHeaders(res);
      }
    }
  }

  // ── CSRF validation for state-changing API requests ─────────────────────
  if (pathname.startsWith('/api') && ['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!isCsrfExempt(pathname)) {
      const headerToken = req.headers.get(CSRF_HEADER_NAME) ?? '';
      const cookieToken = req.cookies.get(CSRF_COOKIE_NAME)?.value ?? '';

      if (!verifyCsrfTokenEdge(headerToken, cookieToken)) {
        const res = new NextResponse(
          JSON.stringify({ error: 'CSRF validation failed', reason: 'csrf_invalid' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
        return addSecurityHeaders(res);
      }
    }
  }

  // ── Apply security headers to every response ───────────────────────────
  const response = NextResponse.next();

  // Add CORS headers for API routes when origin is present and allowed
  if (pathname.startsWith('/api')) {
    const origin = req.headers.get('origin');
    if (origin && isOriginAllowed(origin, allowedOrigins)) {
      const corsHeaders = buildCorsHeaders(origin);
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
    }
  }

  // ── Set CSRF cookie if not already present ─────────────────────────────
  if (!req.cookies.get(CSRF_COOKIE_NAME)) {
    const token = generateCsrfTokenEdge();
    response.cookies.set(CSRF_COOKIE_NAME, token, {
      path: '/',
      sameSite: 'strict',
      secure: true,
      httpOnly: false,
      maxAge: CSRF_COOKIE_MAX_AGE,
    });
  }

  return addSecurityHeaders(response);
}

// Run on every route (not just /api) so security headers are universal
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};