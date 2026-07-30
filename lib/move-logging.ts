/**
 * Structured logging helpers for Move-contract chain read / write
 * observability.
 *
 * Implements Requirement 14 of the move-contract-permissions spec:
 *
 *   - Req 14.1: `logChainViewFailure` emits a single-line JSON `console.warn`
 *     containing `level: "warn"`, an allow-listed `event`, an optional
 *     `videoId`, an optional truncated `wallet`, and a `message` clamped to
 *     500 characters with `"...[truncated]"` appended when the underlying
 *     string exceeds the limit.
 *   - Req 14.2: `logChainWriteSuccess` emits a single-line JSON
 *     `console.info` containing `level: "info"`, the invoked entry-function
 *     name as `event`, `videoId`, a truncated `txHash`, and `version`.
 *   - Req 14.3: Hard guardrail — these functions never accept or render raw
 *     policy bytes, raw `green_box_bytes`, private keys, signed transaction
 *     bytes, session cookies, access tokens, full allowlist entries, full
 *     wallet addresses, full transaction addresses, or email addresses. The
 *     exported function signatures admit only the fields enumerated above,
 *     and only those fields are ever emitted.
 *
 * Any caller that needs to attach additional context must encode it in the
 * allowed `message` field (subject to the 500-char clamp). This module is
 * intentionally minimal so that a human or automated audit can verify by
 * inspection that the guardrail holds.
 */

/** Allowed values for the `event` field of a view-failure warning (Req 14.1). */
export type ViewFailureEvent =
  | 'view_timeout'
  | 'view_decode_error'
  | 'view_error'
  | 'bcs_round_trip_failure';

/** Allowed values for the `event` field of a write-success info log (Req 14.2). */
export type WriteSuccessFn =
  | 'register_blob_v2'
  | 'force_update_policy_v2'
  | 'update_allowlist'
  | 'delete_blob'
  | 'init_new_buyer'
  | 'purchase';

/** Context accepted by {@link logChainViewFailure}. */
export interface ViewFailureContext {
  /** Opaque video identifier. Omitted from the log if `undefined`. */
  videoId?: string;
  /**
   * Canonical wallet address (0x-prefixed). Emitted in truncated form.
   * Omitted from the log if `undefined`.
   */
  wallet?: string;
  /**
   * Human-readable error message. Clamped to 500 characters with
   * `"...[truncated]"` appended when the source exceeds the limit.
   */
  message: string;
}

/** Context accepted by {@link logChainWriteSuccess}. */
export interface WriteSuccessContext {
  /** Opaque video identifier. */
  videoId: string;
  /** Transaction hash (0x-prefixed). Emitted in truncated form. */
  txHash: string;
  /** Unsigned integer version taken from the Move VM transaction receipt. */
  version: number | string;
}

/** Message-length limit per Req 14.1. */
const MAX_MESSAGE_LENGTH = 500;

/** Suffix appended to messages that exceed {@link MAX_MESSAGE_LENGTH}. */
const TRUNCATED_SUFFIX = '...[truncated]';

/**
 * Truncate a 0x-prefixed hex identifier (wallet address or transaction hash)
 * to the form `0x{8-hex}...{last-6-hex}`, i.e. the first ten characters
 * (the `0x` prefix plus eight hex chars) + `"..."` + the last six characters
 * of the input.
 *
 * Inputs of 16 characters or fewer are returned unchanged because the
 * truncated form would be longer than the input itself.
 */
function truncateHexId(value: string): string {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

/**
 * Clamp a message to at most {@link MAX_MESSAGE_LENGTH} characters, appending
 * `"...[truncated]"` when the input exceeds the limit (Req 14.1).
 */
function clampMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) {
    return message;
  }
  return message.slice(0, MAX_MESSAGE_LENGTH) + TRUNCATED_SUFFIX;
}

/**
 * Emit a single-line JSON `console.warn` for a chain-read, BCS-decode, or
 * view-timeout failure.
 *
 * The emitted object contains ONLY the following keys, in this order:
 *   - `level`: always the literal string `"warn"`
 *   - `event`: one of the {@link ViewFailureEvent} variants
 *   - `videoId`: included when `ctx.videoId` is defined
 *   - `wallet`: included when `ctx.wallet` is defined, truncated per Req 14.1
 *   - `message`: clamped to 500 characters per Req 14.1
 *
 * No other properties of `ctx` are read or emitted — this enforces Req 14.3
 * by construction.
 */
export function logChainViewFailure(
  event: ViewFailureEvent,
  ctx: ViewFailureContext
): void {
  const payload: Record<string, unknown> = {
    level: 'warn',
    event,
  };
  if (ctx.videoId !== undefined) {
    payload.videoId = ctx.videoId;
  }
  if (ctx.wallet !== undefined) {
    payload.wallet = truncateHexId(ctx.wallet);
  }
  payload.message = clampMessage(ctx.message);

  console.warn(JSON.stringify(payload));
}

/**
 * Emit a single-line JSON `console.info` for a successful Move entry-function
 * commit.
 *
 * The emitted object contains ONLY the following keys, in this order:
 *   - `level`: always the literal string `"info"`
 *   - `event`: the invoked entry-function name ({@link WriteSuccessFn})
 *   - `videoId`: the opaque video identifier
 *   - `txHash`: truncated per Req 14.2
 *   - `version`: the Move VM transaction version
 *
 * No other properties of `ctx` are read or emitted — this enforces Req 14.3
 * by construction.
 */
export function logChainWriteSuccess(
  fn: WriteSuccessFn,
  ctx: WriteSuccessContext
): void {
  const payload = {
    level: 'info',
    event: fn,
    videoId: ctx.videoId,
    txHash: truncateHexId(ctx.txHash),
    version: ctx.version,
  };

  console.info(JSON.stringify(payload));
}
