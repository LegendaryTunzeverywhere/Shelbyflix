# CSRF Protection Fix

## Problem

When deploying to production (Vercel), POST/PATCH/DELETE requests were failing with:

```
POST /api/videos 403 (Forbidden)
Error: CSRF validation failed
```

## Root Cause

ShelbyFlix uses **CSRF (Cross-Site Request Forgery) protection** via the **double-submit cookie pattern**:

1. Server sets a non-HttpOnly `csrf-token` cookie
2. Client must read this cookie and send it in the `x-csrf-token` header
3. Server validates that header matches cookie

The client code was **not including the CSRF token** in API requests.

---

## Solution

### Created `lib/csrf-client.ts`

New utility module for client-side CSRF handling:

```typescript
import { csrfFetch } from '@/lib/csrf-client';

// Automatically includes CSRF token
const response = await csrfFetch('/api/videos', {
  method: 'POST',
  body: JSON.stringify(data)
});
```

### Helper Functions

**`getCsrfToken()`** - Read CSRF token from cookie
```typescript
const token = getCsrfToken();
// Returns: "a1b2c3d4..." or undefined
```

**`getCsrfHeaders()`** - Get headers with CSRF token
```typescript
const headers = getCsrfHeaders();
// Returns: { 'Content-Type': 'application/json', 'x-csrf-token': '...' }
```

**`csrfFetch()`** - Fetch with CSRF token included
```typescript
await csrfFetch('/api/endpoint', {
  method: 'POST',
  body: JSON.stringify(data)
});
```

---

## Files Updated

### ✅ `lib/video-service.ts`
**Before:**
```typescript
const response = await fetch('/api/videos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});
```

**After:**
```typescript
import { csrfFetch } from './csrf-client';

const response = await csrfFetch('/api/videos', {
  method: 'POST',
  body: JSON.stringify(data)
});
```

### ✅ `hooks/usePurchase.ts`
**Before:**
```typescript
res = await fetch('/api/payments/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
```

**After:**
```typescript
import { csrfFetch } from '@/lib/csrf-client';

res = await csrfFetch('/api/payments/verify', {
  method: 'POST',
  body: JSON.stringify(body),
});
```

### ✅ `components/CreatorVideoSettings.tsx`
**Before:**
```typescript
const saveRes = await fetch(`/api/videos/${videoId}/access-config`, {
  method: 'PATCH',
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': document.cookie
      .split('; ')
      .find((c) => c.startsWith('csrf-token='))
      ?.split('=')[1] ?? '',
  },
  body: JSON.stringify(body),
});
```

**After:**
```typescript
const { csrfFetch } = await import('@/lib/csrf-client');

const saveRes = await csrfFetch(`/api/videos/${videoId}/access-config`, {
  method: 'PATCH',
  body: JSON.stringify(body),
});
```

---

## How CSRF Protection Works

### 1. Server Sets Cookie (middleware.ts)

When a user first visits the site, the middleware sets a CSRF cookie:

```typescript
const csrfToken = generateCsrfToken(); // Random 64-char hex string

response.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
  httpOnly: false,  // Client must read it
  secure: true,     // HTTPS only
  sameSite: 'strict',
  path: '/',
  maxAge: 86400     // 24 hours
});
```

### 2. Client Reads Cookie

The `csrfFetch()` function reads the cookie:

```typescript
const cookies = document.cookie.split(';');
for (const cookie of cookies) {
  const [name, value] = cookie.trim().split('=');
  if (name === 'csrf-token') {
    return decodeURIComponent(value);
  }
}
```

### 3. Client Sends Header

The token is included in the `x-csrf-token` header:

```typescript
headers['x-csrf-token'] = csrfToken;
```

### 4. Server Validates (middleware.ts)

For POST/PATCH/DELETE requests to `/api/*`, the middleware validates:

```typescript
const headerToken = req.headers.get('x-csrf-token') ?? '';
const cookieToken = req.cookies.get('csrf-token')?.value ?? '';

if (!verifyCsrfTokenEdge(headerToken, cookieToken)) {
  return new NextResponse(
    JSON.stringify({ error: 'CSRF validation failed' }),
    { status: 403 }
  );
}
```

**Validation uses constant-time comparison** to prevent timing attacks.

---

## Exempt Endpoints

Some endpoints don't require CSRF tokens (defined in `lib/csrf-constants.ts`):

```typescript
export const CSRF_EXEMPT_PATHS = [
  '/api/admin/cleanup-expired',  // Uses x-cron-secret header
  '/api/auth/challenge',          // Read-only nonce issuance
  '/api/auth/check-access',       // Wallet signature verification
];
```

---

## Testing

### Local Testing

1. Start dev server: `npm run dev`
2. Open browser DevTools → Application → Cookies
3. Verify `csrf-token` cookie is set
4. Try uploading a video
5. Check Network tab → Request Headers → `x-csrf-token` should be present

### Production Testing

After deploying to Vercel:

1. Visit your site: https://shelbyflix.vercel.app
2. Check cookies (DevTools)
3. Upload a video
4. Request should succeed with 200 status

---

## Why This Is Secure

### CSRF Protection Prevents:

**Attack Scenario Without CSRF:**
1. User logs into ShelbyFlix
2. User visits malicious site `evil.com`
3. `evil.com` makes a request to `shelbyflix.vercel.app/api/videos`
4. Browser automatically includes ShelbyFlix cookies
5. ❌ **Attack succeeds** - video uploaded without user consent

**With CSRF Protection:**
1. User logs into ShelbyFlix
2. User visits malicious site `evil.com`
3. `evil.com` tries to make request with header `x-csrf-token: fake-token`
4. Server rejects: token doesn't match cookie
5. ✅ **Attack blocked**

### Why `evil.com` Can't Read the Cookie:

- **Same-Origin Policy**: JavaScript on `evil.com` can't read cookies from `shelbyflix.vercel.app`
- **SameSite=Strict**: Cookie won't be sent on cross-site requests
- Even if the cookie were sent, `evil.com` can't read its value to put in the header

---

## Future Improvements

Consider these enhancements:

1. **Token Rotation**: Rotate CSRF tokens periodically
2. **Per-Session Tokens**: Tie tokens to user sessions
3. **Origin Header Validation**: Double-check request origin
4. **Rate Limiting**: Limit failed CSRF attempts per IP
5. **Audit Logging**: Log all CSRF validation failures

---

## Debugging CSRF Issues

### "CSRF validation failed" Error

**Check:**
1. ✅ Cookie `csrf-token` exists in browser
2. ✅ Header `x-csrf-token` sent in request
3. ✅ Both values match exactly
4. ✅ Cookie hasn't expired (24h lifetime)

**How to debug:**
```typescript
// In browser console:
console.log('Cookie:', document.cookie);
console.log('Token:', getCsrfToken());

// Before fetch:
const headers = getCsrfHeaders();
console.log('Headers:', headers);
```

### Cookie Not Set

If the cookie isn't being set:

1. Check middleware is running: `middleware.ts`
2. Verify `CSRF_COOKIE_NAME` constant: `'csrf-token'`
3. Check browser accepts cookies (not blocked)
4. Verify HTTPS in production (`secure: true` requires HTTPS)

### Token Mismatch

If cookie and header don't match:

1. Check for typos in constant names
2. Verify cookie encoding/decoding
3. Check for whitespace or newlines
4. Ensure constant-time comparison is working

---

## References

- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Double Submit Cookie Pattern](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#double-submit-cookie)
- [SameSite Cookies Explained](https://web.dev/samesite-cookies-explained/)

---

## Summary

✅ Created `lib/csrf-client.ts` with helper functions  
✅ Updated `lib/video-service.ts` to use `csrfFetch()`  
✅ Updated `hooks/usePurchase.ts` to use `csrfFetch()`  
✅ Updated `components/CreatorVideoSettings.tsx` to use `csrfFetch()`  
✅ All state-changing API requests now include CSRF tokens  
✅ Production deployment should work without 403 errors  

**Result:** CSRF protection is now properly implemented across the entire application.
