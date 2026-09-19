# Shelby API Key 401 Fix — Upload 502 Bad Gateway

## Symptom (reported)

```
POST https://shelbyflix.vercel.app/api/uploads 502 (Bad Gateway)
Upload failed: Error: Shelby upload failed: Request to [Fullnode]:
GET https://api.shelbynet.shelby.xyz/v1/accounts/0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a/module/blob_metadata
failed with status: Unauthorized(code:401) and response body:
{"error":"401","message":"Unauthorized: API key not found"}
```

## Root Cause

Shelbynet's fullnode (`https://api.shelbynet.shelby.xyz/v1`) now **requires** an API key for **all** requests — including the `GET /v1/accounts/.../module/blob_metadata` call the Aptos SDK makes automatically when building a transaction payload (to fetch the Move module ABI).

- `ShelbyNodeClient` from `@shelby-protocol/sdk/node` forwards `config.apiKey` to its internal `AptosConfig` as `clientConfig.API_KEY`, which the Aptos SDK sends as `Authorization: Bearer <key>`.
- In the Vercel deployment, `process.env.SHELBY_API_KEY` was **missing or empty**, so no `Authorization` header was sent.
- Fullnode responded `401 Unauthorized: API key not found`.
- `app/api/uploads/route.ts` caught that as a generic `Shelby upload failed: ...` and returned **502**, which is confusing.

Additionally, other `Aptos` clients in the codebase (`lib/aptos-client.ts`, `lib/aptos.ts`, `lib/shelbynet-blob.ts`) were **not** passing the API key at all, so even if the upload route had a key, other read paths would still 401.

## Fix Applied

### 1. Centralized env helper — `lib/shelby-env.ts`

New module that:

- Reads `SHELBY_API_KEY` **or** `NEXT_PUBLIC_SHELBY_API_KEY` (fallback, allowed by `env-validator`).
- Provides `getShelbyApiKey()`, `requireShelbyApiKey()`, `getAptosClientConfigWithApiKey()`.

### 2. All Aptos clients now include API key

- `lib/aptos-client.ts`: `new AptosConfig({ ..., clientConfig: { API_KEY } })`
- `lib/aptos.ts`: same
- `lib/shelbynet-blob.ts`: `shelbynetAptos` + verification `ShelbyBlobClient` now include API key
- `lib/shelby-platform.ts`: `deleteShelbyBlob` now requires API key and throws clear error if missing
- `app/api/uploads/route.ts`: resolves key via helper, returns **503** with actionable message if missing

### 3. Improved error handling in `/api/uploads`

- If env var missing → **503** with message: "SHELBY_API_KEY is missing... Get a key at https://shelby.xyz/api-keys"
- If error message contains `401` + `api key` → **503** with message explaining the 401 and how to fix it
- Previously both cases were **502** with raw SDK message, which was confusing

### 4. Documentation

- `.env.example` now explicitly warns that `SHELBY_API_KEY` is **REQUIRED** and that missing it causes 401 → 502.

## How to Fix Deployment

1. Get API key: https://shelby.xyz/api-keys
2. In Vercel Dashboard → Project → Settings → Environment Variables, add:
   - `SHELBY_API_KEY` = `<your key>` (Production, Preview, Development)
   - Optionally also `NEXT_PUBLIC_SHELBY_API_KEY` same value for client-side fallback
3. Redeploy.

After redeploy, uploads should succeed (assuming platform account has ShelbyUSD/gas).

## Verification

- `npx tsc --noEmit` passes (no type errors)
- Manual test: without `SHELBY_API_KEY`, `POST /api/uploads` now returns:
  ```json
  {
    "error": "Shelby storage is not configured: SHELBY_API_KEY is missing on the server..."
  }
  ```
  with status 503, not 502 with raw fullnode 401.

## Related Files

- `lib/shelby-env.ts` (new)
- `lib/aptos-client.ts`
- `lib/aptos.ts`
- `lib/shelbynet-blob.ts`
- `lib/shelby-platform.ts`
- `app/api/uploads/route.ts`
- `.env.example`
