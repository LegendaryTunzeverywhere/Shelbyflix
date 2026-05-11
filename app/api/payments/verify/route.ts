import { NextRequest, NextResponse } from 'next/server';
import {
  AccountAddress,
  isUserTransactionResponse,
  type TransactionResponse,
  type UserTransactionResponse,
} from '@aptos-labs/ts-sdk';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { supabaseBackend } from '@/lib/access-control';
import { aptos, SHELBYUSD_TOKEN } from '@/lib/aptos';
import { PLATFORM_TREASURY, splitPrice } from '@/lib/payments';
import { checkRateLimit } from '@/lib/payments-rate-limit';

// ---------------------------------------------------------------------------
// POST /api/payments/verify
// Body: { videoId, txHash, walletAddress }
//
// The single server-side authority for translating an on-chain Shelbynet
// transaction hash into a persisted `video_purchases` receipt. Every claim
// is re-verified against the chain here; the client cannot forge a receipt.
//
// Scope of this file after tasks 3.4 + 3.5 + 3.6 + 3.7:
//   - Request shape validation (videoId / walletAddress / txHash)
//   - Task 3.7: sliding-window rate limit (5 req / 10 min per
//     (wallet, video)) applied before any chain / DB read (Req 12.2)
//   - Service-role Supabase client bootstrap
//   - Video-config lookup (video_not_found, not_purchasable)
//   - Idempotent short-circuit: return 200 `already_purchased` when a
//     receipt already exists for (video_id, wallet_address) (Req 6.6)
//   - Task 3.5: on-chain verification (fetch tx with 15s timeout,
//     confirm success, match sender case-insensitively, walk
//     fungible_asset::Deposit events and compare creator + platform
//     amounts against `splitPrice` using `>=`)
//   - Task 3.6: persist the receipt via
//     `INSERT ... ON CONFLICT (video_id, wallet_address) DO NOTHING` +
//     the orthogonal UNIQUE(tx_hash) constraint. A Postgres 23505 error
//     referencing `tx_hash` maps to the documented `tx_hash_reused` 400
//     rejection (Req 6.5); a PK conflict is treated as `already_purchased`
//     so concurrent verifies stay idempotent (Req 6.6). The block
//     `version` returned by the node is persisted as `block_version` for
//     downstream reconciliation (Req 6.7).
//   - Task 3.8: every rejection path emits a single-line structured JSON
//     warn log via `logRejection(event, context)` with the documented
//     reason code as `event` and a truncated tx hash + wallet address in
//     context (Req 12.1). A successful receipt insert emits a structured
//     info log via `logReceiptInsert(context)` that carries the recorded
//     total / creator / platform amounts and the block version so
//     revenue can be reconciled from logs alone if the DB is ever
//     restored from a stale snapshot (Req 12.4). `console.error` lines
//     covering unexpected server errors are deliberately left untouched
//     by this task — they aren't a documented rejection surface and
//     carry full error objects that are more useful un-serialised.
//
// Response shape convention:
//   - 200 on `already_purchased` → `{ hasAccess: true, reason: 'already_purchased' }`
//   - 200 on successful first-time insert →
//     `{ hasAccess: true, reason: 'purchased' }`
//   - 4xx on validation / config / verification failures →
//     `{ hasAccess: false, reason: '<code>' }`
//   - 429 on rate-limited wallets → `{ hasAccess: false, reason: 'rate_limited' }`
//     with a `Retry-After` header (Req 12.2)
//   - 503 on node timeout → `{ hasAccess: false, reason: 'tx_fetch_timeout' }`
//
// Requirements covered by this file today: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
// 6.7, 8.4, 12.1, 12.2, 12.3.
// ---------------------------------------------------------------------------

// Same shape as every other route in this repo: 0x-prefixed, 1-64 hex chars.
// Matches `isValidAptosAddress` in lib/aptos.ts and the input validators
// in app/api/auth/check-access/route.ts so a single canonical regex governs
// every address check on the server.
const APTOS_ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

// Aptos transaction hashes are the SHA3-256 digest of the signed
// transaction bytes — exactly 32 bytes, always rendered as 64 lowercase
// or uppercase hex chars prefixed with `0x`. Unlike addresses, the
// length is fixed — no short-hash form — so this regex is stricter than
// APTOS_ADDRESS_REGEX on purpose.
const APTOS_TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

// Same sanitisation used by `getVideoById` in lib/video-service.ts and by
// `supabaseBackend.getConfig` in lib/access-control.ts — video IDs are
// alphanumeric plus `_` / `-`. Rejecting anything else early avoids both
// a pointless DB round trip and any injection risk into downstream queries.
const VIDEO_ID_REGEX = /^[\w-]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // ── 1. Parse body ────────────────────────────────────────────────────
    // A malformed JSON body is a programmer error on the client — treat it
    // the same as missing fields so the caller gets a single stable error
    // taxonomy to handle.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { hasAccess: false, reason: 'missing_fields' },
        { status: 400 },
      );
    }

    const { videoId, txHash, walletAddress } =
      (body ?? {}) as { videoId?: unknown; txHash?: unknown; walletAddress?: unknown };

    // ── 2. Shape validation ─────────────────────────────────────────────
    // `missing_fields` covers both absent keys and non-string values so
    // the client never has to differentiate the two. The design's error
    // taxonomy lists `missing_fields` and `invalid_address` separately —
    // we emit the former when anything is absent/non-string/videoId-or-txHash
    // shape, and the latter only when the wallet fails its address regex.
    // This matches the convention the UI hook (task 5.3) expects.
    if (
      typeof videoId !== 'string' ||
      typeof txHash !== 'string' ||
      typeof walletAddress !== 'string' ||
      videoId.length === 0 ||
      txHash.length === 0 ||
      walletAddress.length === 0
    ) {
      return NextResponse.json(
        { hasAccess: false, reason: 'missing_fields' },
        { status: 400 },
      );
    }

    if (!VIDEO_ID_REGEX.test(videoId)) {
      // A malformed videoId can only come from a buggy client or an
      // attacker. Surface it under `missing_fields` rather than inventing
      // a new code — the design taxonomy deliberately keeps the rejection
      // surface narrow to simplify client-side handling.
      return NextResponse.json(
        { hasAccess: false, reason: 'missing_fields' },
        { status: 400 },
      );
    }

    if (!APTOS_TX_HASH_REGEX.test(txHash)) {
      // Same reasoning as the videoId case — we don't need a dedicated
      // `invalid_tx_hash` code because the client has no legitimate path
      // that produces a malformed hash. Bucket it under `missing_fields`.
      return NextResponse.json(
        { hasAccess: false, reason: 'missing_fields' },
        { status: 400 },
      );
    }

    if (!APTOS_ADDRESS_REGEX.test(walletAddress)) {
      return NextResponse.json(
        { hasAccess: false, reason: 'invalid_address' },
        { status: 400 },
      );
    }

    // Canonical lowercase form used for every DB comparison. Matches the
    // normalization done by `supabaseBackend.hasPurchased` and by
    // `saveVideo` when persisting owner addresses. We intentionally keep
    // the original `walletAddress` string around for task 3.5's case-
    // insensitive sender comparison against the on-chain tx sender.
    const walletLc = walletAddress.toLowerCase();

    // ── 2a. Rate limit (Req 12.2) ───────────────────────────────────────
    // Sliding-window limiter keyed by (walletAddress, videoId): 5 requests
    // per 10 minutes. Applied AFTER shape validation so malformed clients
    // can't consume their own budget via garbage input, but BEFORE the
    // video-config lookup or any chain read so a flood of bogus hashes
    // can't exhaust the node quota. On rejection we surface the
    // `Retry-After` header (RFC 9110 §10.2.3) alongside the JSON reason
    // so polite clients back off at the right time.
    const rl = checkRateLimit(walletLc, videoId);
    if (!rl.allowed) {
      const retryAfterSec = rl.retryAfterSec ?? 1;
      logRejection('rate_limited', {
        videoId,
        walletAddress: truncateHash(walletLc),
        retryAfterSec,
      });
      return NextResponse.json(
        { hasAccess: false, reason: 'rate_limited' },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSec) },
        },
      );
    }

    // ── 3. Bootstrap the service-role client ────────────────────────────
    // `getSupabaseAdmin` throws with a descriptive message when
    // SUPABASE_SERVICE_ROLE_KEY is missing. We catch that here and map to
    // a 500 rather than letting the thrown error bubble as an opaque
    // "Internal server error" from the outer catch, so misconfiguration
    // is obvious in logs from day one.
    let admin: ReturnType<typeof getSupabaseAdmin>;
    try {
      admin = getSupabaseAdmin();
    } catch (err) {
      console.error('[/api/payments/verify] service-role client unavailable:', err);
      return NextResponse.json(
        { hasAccess: false, reason: 'server_error' },
        { status: 500 },
      );
    }

    // ── 4. Confirm the video exists and is actually purchasable ─────────
    // We route through `supabaseBackend.getConfig` rather than a raw query
    // so this route sees the same access config the rest of the app does
    // (lowercased owner, normalized allowlist, default access mode, etc.).
    // A read through the anon-key client here is fine — the config fields
    // are already public (every Public video exposes them via the access
    // endpoint in task 3.3) and we're not mutating anything yet.
    const config = await supabaseBackend.getConfig(videoId);
    if (!config) {
      return NextResponse.json(
        { hasAccess: false, reason: 'video_not_found' },
        { status: 404 },
      );
    }

    // Req 5.7 + 6.3 alignment: a Purchasable video with a non-positive
    // price is treated as Public by `resolveAccess`, which means there is
    // nothing to purchase — any claimed receipt for such a video is
    // nonsensical. Same for videos whose current mode isn't `purchasable`
    // at all. In both cases the client should refetch the access config
    // and stop presenting a purchase gate.
    if (
      config.accessMode !== 'purchasable' ||
      config.priceBaseUnits == null ||
      config.priceBaseUnits <= 0
    ) {
      return NextResponse.json(
        { hasAccess: false, reason: 'not_purchasable' },
        { status: 400 },
      );
    }

    // ── 5. Idempotent short-circuit (Req 6.6) ───────────────────────────
    // If a receipt already exists for (video_id, wallet_address) the
    // viewer has already paid and should be granted access without
    // re-running the on-chain verification pipeline. The PK on
    // (video_id, wallet_address) guarantees at most one row, so
    // `maybeSingle` is the right fetcher here. We query through the
    // service-role client because `video_purchases` has RLS on with no
    // policies — the anon client cannot read it.
    const { data: existingReceipt, error: receiptLookupError } = await admin
      .from('video_purchases')
      .select('video_id, wallet_address, tx_hash')
      .eq('video_id', videoId)
      .eq('wallet_address', walletLc)
      .maybeSingle();

    if (receiptLookupError) {
      console.error(
        '[/api/payments/verify] receipt lookup failed:',
        receiptLookupError,
      );
      return NextResponse.json(
        { hasAccess: false, reason: 'server_error' },
        { status: 500 },
      );
    }

    if (existingReceipt) {
      // Req 6.6: return 200 so the client treats this as the success
      // branch, not an error. The UI in task 5.3 uses `hasAccess: true`
      // to clear the purchase gate regardless of whether the current
      // call or a prior call wrote the receipt.
      return NextResponse.json(
        { hasAccess: true, reason: 'already_purchased' },
        { status: 200 },
      );
    }

    // ── 6. On-chain verification (task 3.5) ─────────────────────────────
    // Everything below re-derives the payment truth from the chain, not
    // the client. The client's only trusted input is `txHash`; sender,
    // token identity, and transferred amounts all come from the fetched
    // transaction. Task 3.6 will replace the final placeholder below
    // with the actual INSERT into `video_purchases`.

    // Fetch the transaction with a hard 15s timeout (Req 12.3). We race
    // the SDK call against a `setTimeout` because `AbortController` is
    // wired through AptosConfig's fetch, but the SDK's own type surface
    // doesn't expose `signal` on `getTransactionByHash` directly — a
    // manual timeout keeps this working regardless of SDK internals.
    const TX_FETCH_TIMEOUT_MS = 15_000;
    let tx: TransactionResponse;
    try {
      tx = await withTimeout(
        aptos.getTransactionByHash({ transactionHash: txHash }),
        TX_FETCH_TIMEOUT_MS,
      );
    } catch (err: unknown) {
      if (isTimeoutError(err)) {
        logRejection('tx_fetch_timeout', {
          videoId,
          txHash: truncateHash(txHash),
          walletAddress: truncateHash(walletLc),
          timeoutMs: TX_FETCH_TIMEOUT_MS,
        });
        return NextResponse.json(
          { hasAccess: false, reason: 'tx_fetch_timeout' },
          { status: 503 },
        );
      }
      // Any other failure (malformed hash, 404 from the node, transport
      // error) collapses to `tx_failed` — the chain doesn't know about
      // the hash the client claimed, so there is nothing to verify.
      logRejection('tx_failed', {
        videoId,
        txHash: truncateHash(txHash),
        walletAddress: truncateHash(walletLc),
        stage: 'fetch',
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { hasAccess: false, reason: 'tx_failed' },
        { status: 400 },
      );
    }

    // Narrow the union to UserTransactionResponse before touching
    // user-tx-specific fields (`sender`, `events`, `success`, `version`).
    // Pending / genesis / block-metadata transactions cannot represent a
    // user-initiated transfer, so any non-user response is rejected with
    // `tx_failed`.
    if (!isUserTransactionResponse(tx)) {
      logRejection('tx_failed', {
        videoId,
        txHash: truncateHash(txHash),
        walletAddress: truncateHash(walletLc),
        stage: 'shape',
        reason: 'not_a_user_transaction',
      });
      return NextResponse.json(
        { hasAccess: false, reason: 'tx_failed' },
        { status: 400 },
      );
    }

    const userTx: UserTransactionResponse = tx;

    // Req 6.2 / 6.3: the transaction must have actually succeeded
    // on-chain. A failed tx doesn't move funds, so anything claiming
    // one as proof of payment is either a client bug or a forgery.
    if (userTx.success !== true) {
      logRejection('tx_failed', {
        videoId,
        txHash: truncateHash(txHash),
        walletAddress: truncateHash(walletLc),
        stage: 'onchain',
        reason: 'success_false',
        vmStatus: userTx.vm_status,
      });
      return NextResponse.json(
        { hasAccess: false, reason: 'tx_failed' },
        { status: 400 },
      );
    }

    // Req 6.2 / 6.3: sender match. Addresses are compared via
    // `AccountAddress.from(...).toStringLong()` so different valid
    // renderings (with/without leading zeros, mixed case) normalize to
    // the same canonical 64-hex form. `tx.sender` is returned by the
    // node, `walletAddress` arrives from the client.
    let canonicalTxSender: string;
    let canonicalWallet: string;
    try {
      canonicalTxSender = AccountAddress.from(userTx.sender).toStringLong();
      canonicalWallet = AccountAddress.from(walletAddress).toStringLong();
    } catch (err) {
      // Should never happen — we already regex-checked walletAddress and
      // the node produced `userTx.sender`. If it does, treat it as
      // `wrong_sender` so we fail closed rather than silently accept.
      logRejection('wrong_sender', {
        videoId,
        txHash: truncateHash(txHash),
        walletAddress: truncateHash(walletLc),
        stage: 'address_parse',
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { hasAccess: false, reason: 'wrong_sender' },
        { status: 400 },
      );
    }

    if (canonicalTxSender !== canonicalWallet) {
      logRejection('wrong_sender', {
        videoId,
        txHash: truncateHash(txHash),
        walletAddress: truncateHash(walletLc),
        expectedSender: truncateHash(canonicalWallet),
        actualSender: truncateHash(canonicalTxSender),
      });
      return NextResponse.json(
        { hasAccess: false, reason: 'wrong_sender' },
        { status: 400 },
      );
    }

    // Resolve the expected creator + treasury primary-fungible-store
    // addresses so we can match deposit events to the intended
    // recipient. The FA Deposit event's `store` field is the recipient's
    // primary_fungible_store object address — NOT their wallet. We use
    // the SDK's `createObjectAddress`-based derivation via a view call to
    // `0x1::primary_fungible_store::primary_store_address`, which is the
    // canonical way to obtain it. See the helper below for details and
    // the documented fallback behavior.
    const canonicalCreator = canonicalizeAddress(config.ownerWallet);
    const canonicalTreasury = canonicalizeAddress(PLATFORM_TREASURY);
    const canonicalShelbyUsd = canonicalizeAddress(SHELBYUSD_TOKEN);
    if (!canonicalCreator || !canonicalTreasury || !canonicalShelbyUsd) {
      // The server's own config is malformed — this is a misconfiguration
      // bug, not a client error. Log and return server_error so the
      // operator can fix the env/DB state.
      console.error(
        `[/api/payments/verify] unable to canonicalize expected recipients: creator=${config.ownerWallet} treasury=${PLATFORM_TREASURY} token=${SHELBYUSD_TOKEN}`,
      );
      return NextResponse.json(
        { hasAccess: false, reason: 'server_error' },
        { status: 500 },
      );
    }

    const expectedSplit = splitPrice(config.priceBaseUnits);

    // Derive primary_fungible_store addresses for (creator, SHELBYUSD)
    // and (treasury, SHELBYUSD). If the view call fails for either, we
    // fall back to aggregating deposits by `store` and requiring that
    // SOME store received at least the expected amount — this is strictly
    // less precise but keeps the endpoint functional if the node rejects
    // the view call. Every fallback path is logged so the operator can
    // spot it.
    const creatorStore = await resolvePrimaryStoreAddress(
      canonicalCreator,
      canonicalShelbyUsd,
      { videoId, txHash },
    );
    const treasuryStore =
      expectedSplit.platform > 0
        ? await resolvePrimaryStoreAddress(
            canonicalTreasury,
            canonicalShelbyUsd,
            { videoId, txHash },
          )
        : null;

    // Walk the transaction's events. We are looking for
    // `0x1::fungible_asset::Deposit` events whose `store` field matches
    // either the creator's FA store or the treasury's FA store. Any
    // deposit event with a different fungible-asset metadata is ignored
    // (a tx may move unrelated tokens alongside our transfer, e.g. gas
    // rebates in a multi-action script). If NO FA deposit events are
    // present at all, we reject with `wrong_token` because the claimed
    // payment didn't actually transfer any fungible asset.
    const FA_DEPOSIT_TYPE = '0x1::fungible_asset::Deposit';

    let creatorReceived = 0;
    let treasuryReceived = 0;
    let sawAnyFaDeposit = false;

    for (const ev of userTx.events ?? []) {
      if (!ev || typeof ev.type !== 'string') continue;
      if (!ev.type.endsWith('fungible_asset::Deposit')) continue;
      // Accept the canonical module path above, but tolerate a differing
      // 0x-prefix rendering (`0x1::...` vs `0x01::...`) by checking the
      // suffix. Strict check first to avoid an accidental false positive.
      if (ev.type !== FA_DEPOSIT_TYPE && !ev.type.endsWith('::fungible_asset::Deposit')) {
        continue;
      }
      sawAnyFaDeposit = true;

      const data = ev.data as { store?: unknown; amount?: unknown } | undefined;
      if (!data || typeof data.store !== 'string') continue;

      const storeAddr = canonicalizeAddress(data.store);
      if (!storeAddr) continue;

      const amount = toBaseUnits(data.amount);
      if (amount == null || amount <= 0) continue;

      if (creatorStore && storeAddr === creatorStore) {
        creatorReceived += amount;
      } else if (
        treasuryStore &&
        storeAddr === treasuryStore &&
        expectedSplit.platform > 0
      ) {
        treasuryReceived += amount;
      }
      // Unmatched FA deposits are ignored — they belong to some other
      // recipient (e.g. a refund path or unrelated token) and must not
      // satisfy the creator/treasury checks.
    }

    if (!sawAnyFaDeposit) {
      // No FA Deposit events at all — either the tx didn't transfer a
      // fungible asset or the node response was unexpectedly empty.
      // Either way the claimed payment didn't move SHELBYUSD.
      logRejection('wrong_token', {
        videoId,
        txHash: truncateHash(txHash),
        walletAddress: truncateHash(walletLc),
        reason: 'no_fa_deposit_events',
      });
      return NextResponse.json(
        { hasAccess: false, reason: 'wrong_token' },
        { status: 400 },
      );
    }

    // Req 6.2 / 8.4: creator share must be at least the expected floor.
    // Using `>=` rather than `===` tolerates users who tip above the
    // price — underpayment by even 1 base unit fails.
    if (creatorReceived < expectedSplit.creator) {
      logRejection('creator_share_too_low', {
        videoId,
        txHash: truncateHash(txHash),
        walletAddress: truncateHash(walletLc),
        expected: expectedSplit.creator,
        received: creatorReceived,
      });
      return NextResponse.json(
        { hasAccess: false, reason: 'creator_share_too_low' },
        { status: 400 },
      );
    }

    // Req 8.4 edge case: when the floor'd platform fee is 0 (dust-level
    // prices) we skip the platform check entirely — `buildPurchaseTransaction`
    // omits the platform transfer in that case, so requiring a deposit
    // event would incorrectly fail an otherwise-valid purchase.
    if (expectedSplit.platform > 0 && treasuryReceived < expectedSplit.platform) {
      logRejection('platform_share_too_low', {
        videoId,
        txHash: truncateHash(txHash),
        walletAddress: truncateHash(walletLc),
        expected: expectedSplit.platform,
        received: treasuryReceived,
      });
      return NextResponse.json(
        { hasAccess: false, reason: 'platform_share_too_low' },
        { status: 400 },
      );
    }

    // ── 7. Persist the receipt (task 3.6, Req 6.4/6.5/6.7) ──────────────
    // All on-chain checks have passed: the tx succeeded, the sender
    // matched the caller's wallet, and SHELBYUSD deposits to the creator
    // (and treasury, when applicable) meet or exceed the expected split.
    // Now write the verified receipt with two layered guarantees:
    //
    //   - PK (video_id, wallet_address): upserting with `ignoreDuplicates`
    //     translates to `INSERT ... ON CONFLICT (video_id, wallet_address)
    //     DO NOTHING`. A concurrent verify that lost the race (Req 6.6) is
    //     silently absorbed — we return `already_purchased` so the viewer
    //     still gets access without the client seeing an error.
    //
    //   - UNIQUE(tx_hash): orthogonal to the PK, and NOT suppressed by
    //     `ignoreDuplicates` (which only targets the declared onConflict
    //     column set). A tx hash submitted against a DIFFERENT
    //     (video_id, wallet_address) pair surfaces as Postgres error code
    //     `23505`, which we map to `tx_hash_reused` (Req 6.5).
    //
    // `tx_hash` is normalised to lowercase before writing. The UNIQUE
    // constraint is case-sensitive, and while Aptos tx hashes are
    // canonically lowercase, the APTOS_TX_HASH_REGEX above accepts both
    // cases — lowercasing here guarantees we never accept a mixed-case
    // duplicate of an existing receipt.
    const txHashLc = txHash.toLowerCase();
    const blockVersion = parseBigIntLike(userTx.version);

    const receiptRow = {
      video_id: videoId,
      wallet_address: walletLc,
      tx_hash: txHashLc,
      amount_total: config.priceBaseUnits,
      amount_creator: creatorReceived,
      amount_platform: treasuryReceived,
      block_version: blockVersion,
    };

    const { data: insertedRows, error: insertError } = await admin
      .from('video_purchases')
      .upsert(receiptRow, {
        onConflict: 'video_id,wallet_address',
        ignoreDuplicates: true,
      })
      .select();

    if (insertError) {
      // Postgres `unique_violation` is code `23505`. With
      // `ignoreDuplicates: true` on (video_id, wallet_address), any 23505
      // we actually observe must be the ORTHOGONAL UNIQUE(tx_hash)
      // constraint — the hash has already been used to unlock some OTHER
      // (video_id, wallet_address) pair. Map that to the documented
      // `tx_hash_reused` rejection (Req 6.5).
      //
      // We still check the error message / details for `tx_hash` as a
      // belt-and-braces guard: if some future migration adds a new UNIQUE
      // constraint, the wrong code path shouldn't silently return 400
      // `tx_hash_reused` for an unrelated conflict.
      const code = (insertError as { code?: string }).code;
      const message = insertError.message ?? '';
      const details = (insertError as { details?: string }).details ?? '';
      if (
        code === '23505' &&
        (/tx_hash/i.test(message) || /tx_hash/i.test(details))
      ) {
        logRejection('tx_hash_reused', {
          videoId,
          txHash: truncateHash(txHash),
          walletAddress: truncateHash(walletLc),
        });
        return NextResponse.json(
          { hasAccess: false, reason: 'tx_hash_reused' },
          { status: 400 },
        );
      }

      console.error(
        `[/api/payments/verify] receipt insert failed video=${videoId} tx=${truncateHash(
          txHash,
        )}:`,
        insertError,
      );
      return NextResponse.json(
        { hasAccess: false, reason: 'server_error' },
        { status: 500 },
      );
    }

    // With `ignoreDuplicates: true`, a PK conflict produces no error but
    // returns an empty `data` array — the row already existed. Treat that
    // as the idempotent success branch (Req 6.6). The earlier step-5
    // short-circuit catches the common case, but a concurrent verify that
    // raced past the lookup lands here; the viewer still has access.
    const insertedNewRow = Array.isArray(insertedRows) && insertedRows.length > 0;
    if (!insertedNewRow) {
      return NextResponse.json(
        { hasAccess: true, reason: 'already_purchased' },
        { status: 200 },
      );
    }

    // Successful first-time receipt insert. Emit a structured info log
    // with the recorded amounts so revenue can be reconciled from logs
    // alone if the DB is ever restored from a stale snapshot (Req 12.4).
    logReceiptInsert({
      videoId,
      txHash: truncateHash(txHash),
      walletAddress: truncateHash(walletLc),
      amountTotal: config.priceBaseUnits,
      amountCreator: creatorReceived,
      amountPlatform: treasuryReceived,
      blockVersion,
    });

    return NextResponse.json(
      { hasAccess: true, reason: 'purchased' },
      { status: 200 },
    );
  } catch (err) {
    console.error('[/api/payments/verify] unexpected error:', err);
    return NextResponse.json(
      { hasAccess: false, reason: 'server_error' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers (task 3.5)
// ---------------------------------------------------------------------------

/**
 * Structured logger for rejection paths (task 3.8, Req 12.1).
 *
 * Every documented rejection code — `tx_failed`, `wrong_sender`,
 * `wrong_token`, `creator_share_too_low`, `platform_share_too_low`,
 * `tx_hash_reused`, `rate_limited`, `tx_fetch_timeout` — routes through
 * here so log shipping can parse a single line as JSON without regex
 * gymnastics. The record always carries `level`, `route`, `event`, and
 * `timestamp`; callers supply `videoId`, `txHash`, `walletAddress`
 * (already truncated via `truncateHash`) and any rejection-specific
 * context (expected vs actual amounts, vm_status, parse errors, etc.).
 *
 * We intentionally emit a single-line `console.warn(JSON.stringify(...))`
 * rather than pulling in pino/winston — the handler runs on Next.js
 * Node runtime where stdout is already shipped to whatever aggregator
 * the operator points at, and keeping the dependency surface at zero
 * avoids another upgrade path.
 */
function logRejection(
  event: string,
  context: Record<string, unknown>,
): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      route: '/api/payments/verify',
      event,
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Structured logger for the successful receipt-insert path (task 3.8,
 * Req 12.4). Emits an `info`-level record carrying the persisted
 * amounts (`amountTotal`, `amountCreator`, `amountPlatform`) plus the
 * on-chain `blockVersion` so revenue can be reconciled from logs alone
 * if the DB is ever restored from a stale snapshot. Same single-line
 * JSON shape as `logRejection` for parser consistency.
 */
function logReceiptInsert(context: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      level: 'info',
      route: '/api/payments/verify',
      event: 'receipt_inserted',
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Sentinel error thrown by `withTimeout` when its inner promise doesn't
 * settle within the budget. Kept as a brand so we can distinguish timeout
 * failures from other fetch errors in the outer catch without string-
 * matching error messages.
 */
class TxFetchTimeoutError extends Error {
  readonly isTxFetchTimeout = true;
  constructor(ms: number) {
    super(`tx fetch timed out after ${ms}ms`);
    this.name = 'TxFetchTimeoutError';
  }
}

function isTimeoutError(err: unknown): err is TxFetchTimeoutError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { isTxFetchTimeout?: boolean }).isTxFetchTimeout === true
  );
}

/**
 * Race `p` against a timeout. The SDK's `getTransactionByHash` doesn't
 * accept an `AbortSignal` on its public surface, so we bound the wait
 * here. The underlying fetch continues in the background on timeout
 * (we can't cancel it), but the handler returns to the client within the
 * 15s budget (Req 12.3). The node's own response will be ignored.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TxFetchTimeoutError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Canonicalize an Aptos address to its long (0x + 64 hex, lowercase)
 * form so string equality is safe. Returns empty string when the input
 * fails to parse — callers treat that as a non-match rather than
 * throwing because the caller's logging context is more useful than a
 * generic parse error.
 */
function canonicalizeAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  try {
    return AccountAddress.from(addr).toStringLong();
  } catch {
    return '';
  }
}

/**
 * Truncate a hex hash/address to its first 10 and last 4 chars for
 * logging. Matches the existing `formatAddress` helper in lib/aptos.ts
 * so log lines across the codebase read consistently.
 */
function truncateHash(hex: string): string {
  if (!hex) return '';
  if (hex.length <= 14) return hex;
  return `${hex.slice(0, 10)}...${hex.slice(-4)}`;
}

/**
 * Parse an event's `amount` field into a number of base units. FA
 * deposit events emit `amount` as a string (Move u64), though some
 * responses surface numbers. We accept both and reject anything else.
 * Returns null when the value isn't a finite non-negative integer, so
 * the caller can skip the malformed event without aborting the walk.
 */
function toBaseUnits(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.floor(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    // Numbers above MAX_SAFE_INTEGER would silently lose precision here.
    // Realistic SHELBYUSD prices fit comfortably; if we ever approach
    // that bound we should switch to BigInt arithmetic end-to-end.
    if (!Number.isSafeInteger(n)) return null;
    return n;
  }
  return null;
}

/**
 * Parse a numeric-string ("version") field into a plain number. Same
 * safe-integer caveat as `toBaseUnits`. Returns null when the value
 * can't be represented so task 3.6 can persist NULL rather than a lossy
 * integer.
 */
function parseBigIntLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n)) return n;
  }
  return null;
}

/**
 * Resolve the primary_fungible_store object address that receives FA
 * deposits for `(owner, metadata)`. The FA `Deposit` event's `store`
 * field is the store object address, NOT the owner's wallet, so we must
 * derive it to correlate deposits with the intended recipient.
 *
 * Uses the chain view `0x1::primary_fungible_store::primary_store_address`
 * (the canonical way to obtain it). If the view call fails — e.g. the
 * node doesn't support this view, or the caller doesn't have a primary
 * store yet — we log a warn and return null. The caller treats null as
 * "no deposits can match this recipient", which in practice forces a
 * `creator_share_too_low` / `platform_share_too_low` rejection. This is
 * a pragmatic fail-closed: we never grant access off an unverifiable
 * deposit mapping.
 */
async function resolvePrimaryStoreAddress(
  owner: string,
  metadata: string,
  ctx: { videoId: string; txHash: string },
): Promise<string | null> {
  try {
    const result = await aptos.view<[string]>({
      payload: {
        function:
          '0x1::primary_fungible_store::primary_store_address' as `${string}::${string}::${string}`,
        typeArguments: ['0x1::fungible_asset::Metadata'],
        functionArguments: [owner, metadata],
      },
    });
    const store = Array.isArray(result) ? result[0] : undefined;
    if (typeof store !== 'string') {
      logRejection('primary_store_view_non_string', {
        videoId: ctx.videoId,
        txHash: truncateHash(ctx.txHash),
        owner: truncateHash(owner),
      });
      return null;
    }
    return canonicalizeAddress(store) || null;
  } catch (err) {
    logRejection('primary_store_view_failed', {
      videoId: ctx.videoId,
      txHash: truncateHash(ctx.txHash),
      owner: truncateHash(owner),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
