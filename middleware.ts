import { NextRequest, NextResponse } from 'next/server';

// In-memory rate limit store (resets on server restart — good enough for Next.js edge)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000;   // 1 minute window
const MAX_REQUESTS = 60;    // 60 requests per minute per IP

function getRateLimitKey(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only rate-limit API routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const key = getRateLimitKey(req);
  const now = Date.now();

  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count++;
    if (entry.count > MAX_REQUESTS) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests. Please slow down.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)),
          },
        }
      );
    }
  }

  // Security headers on all responses
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
