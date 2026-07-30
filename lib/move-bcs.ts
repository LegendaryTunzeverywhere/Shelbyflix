/**
 * lib/move-bcs.ts
 *
 * BCS (Binary Canonical Serialization) encoders / decoders for the Move
 * structs exposed by the deployed `access_control` module, plus the
 * centralized unit-conversion helpers every write and read path shares.
 *
 * Only the skeleton is in place here (task 2.1): the exported TypeScript
 * types mirror the Move structs character-for-character (Req 3.6), the
 * `ChainDeserializationError` class carries structured failure metadata
 * (Req 3.7), and the unit-conversion helpers (`msToMicros`, `microsToMs`,
 * `assertSafeU64`) implement the BigInt arithmetic / safe-integer guards /
 * u64 range checks demanded by Req 11.1 - 11.7.
 *
 * The actual serialize / deserialize function implementations are the
 * responsibility of tasks 2.2 and 2.4 — they are intentionally not
 * included in this file yet. Stubbed signatures are NOT exported so the
 * type system does not advertise functions that throw at runtime.
 *
 * Why a single module owns unit conversion (Req 11.7):
 *   - The app stores `unlockAt` as epoch milliseconds and `priceBaseUnits`
 *     as 8-decimal SHELBYUSD base units in a JS `number`.
 *   - The Move module stores `locked_until` as epoch MICROSECONDS and
 *     `price` as a raw `u64`, both wider than `Number.MAX_SAFE_INTEGER`.
 *   - A single source of truth for the ms<->µs conversion and the
 *     u64-to-safe-integer guard prevents silent authorization bugs from
 *     ad-hoc arithmetic at each boundary crossing.
 *
 * Requirements covered by this file at task 2.1:
 *   3.6 (exported TS type shapes),
 *   3.7 (ChainDeserializationError structure),
 *   11.1 - 11.7 (unit-conversion helpers).
 *
 * Later tasks extend this file with:
 *   - serializeAccessPolicy / deserializeAccessPolicy (task 2.2)
 *   - serializeRegistrationInfoV2[Vec] / deserializeBlobMetadataV2 (task 2.4)
 */

// ---------------------------------------------------------------------------
// TypeScript mirrors of the Move struct shapes (Req 3.6).
//
// Field names match the Move declarations character-for-character so the
// serializer can be audited field-by-field against the on-chain
// definitions without name translation. `tests/arbs.ts` carries an
// identically-shaped mirror — that harness may be migrated to import from
// this module in a follow-up without a shape change.
// ---------------------------------------------------------------------------

/**
 * Discriminated union of every `AccessPolicy` variant the Move module
 * stores inside `BlobMetadataV2`. Variant-tag ordering (used by the BCS
 * encoder in task 2.2) follows the Move declaration order:
 *
 *     Allowlist     = 0
 *     TimeLock      = 1
 *     PayToDownload = 2
 *     CustomModule  = 3
 *
 * Numeric fields are typed as `bigint` — the Aptos TS SDK reads / writes
 * u64 values as BigInt, and keeping them as BigInt through the pipeline
 * avoids silent precision loss when the underlying value exceeds
 * `Number.MAX_SAFE_INTEGER` (Req 11.3 / 11.5).
 */
export type AccessPolicy =
  | { kind: 'Allowlist';     addresses: string[] }
  | { kind: 'TimeLock';      locked_until: bigint }
  | { kind: 'PayToDownload'; price: bigint }
  | { kind: 'CustomModule';  module_addr: string; module_name: string };

/**
 * Move `RegistrationInfoV2`. Field order matches the Move declaration and
 * MUST NOT be reordered — the BCS encoder relies on declaration order to
 * produce byte-identical output to the module's
 * `registration_info_from_bytes` helper.
 */
export interface RegistrationInfoV2 {
  blob_name: string;
  /** u8; always 0 in the current upload path (no green box). */
  green_box_scheme: number;
  green_box_bytes: Uint8Array;
  access_policy: AccessPolicy;
}

/**
 * Move `BlobMetadataV2` — the payload returned by
 * `get_maybe_blob_metadata_bcs` wrapped in an outer `Option<T>`. Field
 * order again matches the Move declaration.
 *
 * `owner` is always a Canonical_Address (0x-prefixed, 64 lowercase hex,
 * length 66). The deserializer in task 2.4 will canonicalize incoming
 * bytes via `AccountAddress.from(bytes).toStringLong()`.
 */
export interface BlobMetadataV2 {
  owner: string;
  green_box_scheme: number;
  green_box_bytes: Uint8Array;
  access_policy: AccessPolicy;
}

// ---------------------------------------------------------------------------
// ChainDeserializationError (Req 3.7, 11.5).
//
// The single failure class every BCS decode path in this file throws.
// Separate from `ChainUnavailableError` in `lib/move-contract-backend.ts`:
// the backend re-wraps the deserialization failure as a `ChainUnavailable`
// with `code: "decode"` so upstream consumers only ever see one error
// surface. Keeping the BCS-layer error distinct lets unit tests assert
// on the exact reason / offset without loading the backend module.
// ---------------------------------------------------------------------------

/**
 * Canonical set of failure reasons the BCS layer can produce. Each value
 * corresponds to a specific clause of Req 3.7 or Req 11.5 so that
 * property-test assertions can be precise:
 *
 *   - `unknown_variant` — a variant tag outside the declared range
 *     (>= 4 for `AccessPolicy`, >= 2 for `Option<BlobMetadataV2>`).
 *   - `truncated`        — input bytes end before the current field's
 *     required bytes have been consumed.
 *   - `trailing_bytes`   — decode completes but `deserializer.remaining()`
 *     is non-zero.
 *   - `invalid_uleb128`  — malformed Uleb128 length prefix or tag.
 *   - `unit_overflow`    — a u64 value converts to a JS number that is
 *     not `Number.isSafeInteger` (Req 11.5), or a ms->µs / µs->ms
 *     conversion overflows the BigInt->Number boundary.
 */
export type ChainDeserializationReason =
  | 'unknown_variant'
  | 'truncated'
  | 'trailing_bytes'
  | 'invalid_uleb128'
  | 'unit_overflow';

/**
 * Structured error thrown by the deserializers (and by the unit-conversion
 * helpers with `reason: 'unit_overflow'`). Carries enough context for
 * Property 10 (`tests` task 2.5) to assert on `reason`, `offset`, and
 * `inputLength` without string parsing.
 *
 * `blobName` and `field` are optional because not every throw site has
 * access to them — unit-conversion helpers know the field name but not
 * the blob, while low-level BCS primitive failures know the offset but
 * neither the blob nor a specific struct field.
 */
export class ChainDeserializationError extends Error {
  public readonly reason: ChainDeserializationReason;
  public readonly offset: number;
  public readonly inputLength: number;
  public readonly blobName?: string;
  public readonly field?: string;

  constructor(args: {
    reason: ChainDeserializationReason;
    offset: number;
    inputLength: number;
    blobName?: string;
    field?: string;
  }) {
    const parts = [`BCS decode failed: ${args.reason}`];
    parts.push(`offset=${args.offset}/${args.inputLength}`);
    if (args.field !== undefined) parts.push(`field=${args.field}`);
    if (args.blobName !== undefined) parts.push(`blob=${args.blobName}`);
    super(parts.join(' '));
    this.name = 'ChainDeserializationError';
    this.reason = args.reason;
    this.offset = args.offset;
    this.inputLength = args.inputLength;
    this.blobName = args.blobName;
    this.field = args.field;
    // Preserve prototype chain when transpiled to older targets so
    // `instanceof ChainDeserializationError` still works through a
    // Promise rejection boundary.
    Object.setPrototypeOf(this, ChainDeserializationError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Unit-conversion helpers (Req 11.1 - 11.7).
//
// Centralized here so every boundary crossing between JS numbers (epoch
// ms, SHELBYUSD base units as `number`) and Move u64 BigInts goes through
// the same guards. Ad-hoc arithmetic outside this module is explicitly
// prohibited by Req 11.7.
// ---------------------------------------------------------------------------

/** Move u64 max (2^64 - 1), precomputed as a BigInt for range checks. */
const U64_MAX: bigint = (1n << 64n) - 1n;

/** BigInt conversion factor between epoch milliseconds and microseconds. */
const MICROS_PER_MS: bigint = 1000n;

/**
 * Convert epoch milliseconds (JS `number`) to epoch microseconds
 * (`bigint`) for Move `TimeLock.locked_until` serialization.
 *
 * Guards (Req 11.3, 11.6):
 *   - `ms` must be a finite `Number.isSafeInteger` value.
 *   - `ms` must be non-negative (Move `u64` cannot carry negative time).
 *   - The product `ms * 1000n` is computed in BigInt space so it cannot
 *     overflow `Number.MAX_SAFE_INTEGER`.
 *   - The product must still fit in Move `u64` range (0 ..= 2^64 - 1);
 *     any `ms` value up to `Number.MAX_SAFE_INTEGER` (~9e15) multiplied
 *     by 1000 is well inside u64 (~1.8e19), so this is effectively
 *     guaranteed by the safe-integer guard — the u64 check is still
 *     performed defensively so a future change to the input type does
 *     not silently produce an out-of-range BigInt.
 *
 * @throws Error naming the `unlockAt` field and the rejected value when
 *   the input is not a finite non-negative safe integer (Req 11.6). This
 *   is a plain `Error`, not a `ChainDeserializationError`, because
 *   serialization-layer input validation is not a decode failure — the
 *   caller is a write path that has not started serializing yet.
 */
export function msToMicros(ms: number): bigint {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    throw new Error(
      `msToMicros: field="unlockAt" value must be a finite number, got ${String(ms)}`,
    );
  }
  if (!Number.isSafeInteger(ms)) {
    throw new Error(
      `msToMicros: field="unlockAt" value must be Number.isSafeInteger, got ${ms}`,
    );
  }
  if (ms < 0) {
    throw new Error(
      `msToMicros: field="unlockAt" value must be non-negative, got ${ms}`,
    );
  }
  const micros = BigInt(ms) * MICROS_PER_MS;
  if (micros < 0n || micros > U64_MAX) {
    // Defensive — unreachable for any SafeInteger `ms`, but an explicit
    // guard documents the u64 bound Req 11.3 / 11.6 prescribes.
    throw new Error(
      `msToMicros: field="unlockAt" microseconds out of u64 range, got ${micros.toString()}`,
    );
  }
  return micros;
}

/**
 * Convert epoch microseconds (Move u64, delivered here as `bigint`) to
 * epoch milliseconds (JS `number`) for population of
 * `AccessConfig.unlockAt`.
 *
 * Arithmetic rules (Req 11.4):
 *   - Division performed in BigInt space (`us / 1000n`) so no precision
 *     is lost before the safe-integer check.
 *   - Sub-millisecond remainder is truncated toward zero — BigInt `/`
 *     already truncates toward zero for non-negative operands; the guard
 *     below rejects negative inputs explicitly so the truncation rule is
 *     unambiguous.
 *
 * Failure rule (Req 11.5):
 *   - If the truncated quotient does not fit `Number.isSafeInteger`, the
 *     helper throws `ChainDeserializationError({ reason: 'unit_overflow',
 *     field: 'locked_until', blobName })` with the raw BigInt value in
 *     the message so operators can confirm the Move-side value verbatim.
 *   - The error is emitted even when the caller did not supply a
 *     `blobName` — the field name alone is enough for triage.
 */
export function microsToMs(us: bigint, blobName?: string): number {
  if (typeof us !== 'bigint') {
    throw new Error(
      `microsToMs: field="locked_until" value must be a bigint, got ${typeof us}`,
    );
  }
  if (us < 0n) {
    // A negative Move u64 is impossible on-chain; reaching here means
    // something upstream (a signed-int path, a manual test fixture)
    // produced an invalid value. Treat as a decode-style failure.
    throw new ChainDeserializationError({
      reason: 'unit_overflow',
      offset: 0,
      inputLength: 0,
      field: 'locked_until',
      blobName,
    });
  }
  if (us > U64_MAX) {
    throw new ChainDeserializationError({
      reason: 'unit_overflow',
      offset: 0,
      inputLength: 0,
      field: 'locked_until',
      blobName,
    });
  }
  const ms = us / MICROS_PER_MS; // BigInt truncating division, toward zero for >= 0.
  // `Number.MAX_SAFE_INTEGER` is 2^53 - 1; a BigInt in that range is
  // exactly representable as a `number`. Reject anything above it so the
  // caller never sees a silently rounded value.
  if (ms > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ChainDeserializationError({
      reason: 'unit_overflow',
      offset: 0,
      inputLength: 0,
      field: 'locked_until',
      blobName,
    });
  }
  return Number(ms);
}

/**
 * Assert a numeric value lies inside the Move `u64` range AND fits inside
 * `Number.MAX_SAFE_INTEGER`, then return it as `bigint`.
 *
 * Accepts either `bigint` or `number` so callers can use the same helper
 * at the BCS-decode boundary (where the SDK produces BigInt) and at the
 * validation-before-serialize boundary (where the UI supplies a JS
 * `number`). The returned value is always a `bigint` so downstream code
 * has a single canonical representation.
 *
 * Guard rules (Req 11.1, 11.5, 11.6):
 *   - `number` inputs must be `Number.isSafeInteger` and non-negative.
 *   - `bigint` inputs must be non-negative.
 *   - The resulting BigInt must be within `[0n, U64_MAX]`.
 *   - The resulting BigInt must not exceed `Number.MAX_SAFE_INTEGER`
 *     because every call site currently assigns the result (or its
 *     Number() projection) into a JS `number` field of `AccessConfig`;
 *     failing this guard throws `ChainDeserializationError` with
 *     `reason: 'unit_overflow'` and the supplied `field` / `blobName`.
 *
 * The split between "range check" and "safe-integer check" mirrors the
 * two distinct failure modes Req 11.5 / 11.6 describe: a Move value that
 * breaks the u64 contract (malformed chain data) versus a Move value
 * that is legal u64 but too wide for the JS `number` the app uses to
 * represent it downstream. Both surface as `unit_overflow` so upstream
 * consumers have a single code to branch on, but the message
 * distinguishes the two for operator diagnostics.
 */
export function assertSafeU64(
  n: bigint | number,
  field: string,
  blobName?: string,
): bigint {
  let value: bigint;
  if (typeof n === 'number') {
    if (!Number.isFinite(n)) {
      throw new Error(
        `assertSafeU64: field="${field}" value must be finite, got ${String(n)}`,
      );
    }
    if (!Number.isSafeInteger(n)) {
      throw new Error(
        `assertSafeU64: field="${field}" value must be Number.isSafeInteger, got ${n}`,
      );
    }
    if (n < 0) {
      throw new Error(
        `assertSafeU64: field="${field}" value must be non-negative, got ${n}`,
      );
    }
    value = BigInt(n);
  } else if (typeof n === 'bigint') {
    value = n;
  } else {
    throw new Error(
      `assertSafeU64: field="${field}" value must be bigint or number, got ${typeof n}`,
    );
  }

  if (value < 0n) {
    throw new Error(
      `assertSafeU64: field="${field}" value must be non-negative, got ${value.toString()}`,
    );
  }
  if (value > U64_MAX) {
    // Out of u64 range — malformed Move payload (Req 11.5 first clause)
    // or an invalid serializer input (Req 11.6). Treat as an overflow
    // so the caller can re-wrap into `ChainUnavailableError('decode')`.
    throw new ChainDeserializationError({
      reason: 'unit_overflow',
      offset: 0,
      inputLength: 0,
      field,
      blobName,
    });
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    // Legal u64 but too wide for a JS `number` downstream (Req 11.5
    // second clause). Fail closed rather than hand the caller a lossy
    // value.
    throw new ChainDeserializationError({
      reason: 'unit_overflow',
      offset: 0,
      inputLength: 0,
      field,
      blobName,
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// AccessPolicy BCS (Req 3.1, 3.2, 3.5, 3.6, 3.7, 11.6) — task 2.2.
//
// Wire format mirrors the Move `AccessPolicy` enum declaration order:
//
//   Allowlist     { addresses: vector<address> }           tag = 0
//   TimeLock      { locked_until: u64 }                    tag = 1
//   PayToDownload { price: u64 }                           tag = 2
//   CustomModule  { module_addr: address, module_name: String } tag = 3
//
// Variant-tag bytes are produced with `serializeU32AsUleb128(tag)`, the
// same encoding the Move VM applies to enum discriminants. Reading the
// tag with `deserializeUleb128AsU32()` keeps us byte-compatible with the
// Move helper `access_policy_from_bytes`.
//
// Address bytes (allowlist entries, CustomModule.module_addr) are always
// 32 bytes written with `serializeFixedBytes` — a Move `address` is a
// fixed-width 32-byte type, NOT a `vector<u8>` with a length prefix.
// `AccountAddress.from(x).toUint8Array()` produces those 32 bytes for
// any accepted input (full-length, short-form `0x1`, Canonical_Address).
//
// Every call site validates u64 inputs against the Move `u64` range
// (`[0n, 2^64 - 1]`) before emitting bytes (Req 11.6). Negative,
// non-finite, or over-range values are rejected with a plain `Error` —
// serialization-input validation is not a decode failure, so
// `ChainDeserializationError` is reserved for the decode path.
// ---------------------------------------------------------------------------

import { Serializer, Deserializer, AccountAddress } from '@aptos-labs/ts-sdk';

const TAG_ALLOWLIST = 0;
const TAG_TIMELOCK = 1;
const TAG_PAYTODOWNLOAD = 2;
const TAG_CUSTOMMODULE = 3;

/** Fixed byte width of a Move `address` on Aptos. */
const ADDRESS_BYTES = 32;

/**
 * Validate a u64-carrying `bigint` input to a serializer. Returns the
 * value unchanged on success; throws a plain `Error` naming the field
 * and the rejected value on failure (Req 11.6).
 *
 * We do NOT delegate to `assertSafeU64` here because the caller's value
 * is intentionally allowed to exceed `Number.MAX_SAFE_INTEGER` — the
 * downstream consumer (the Move VM) carries the full u64 range, and the
 * encoder has no reason to downcast to a JS `number`. `assertSafeU64`'s
 * extra safe-integer guard exists for the decode path where values
 * eventually populate a `number`-typed `AccessConfig` field.
 */
function validateU64(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error(
        `serializeAccessPolicy: field="${field}" value must be non-negative, got ${value.toString()}`,
      );
    }
    if (value > U64_MAX) {
      throw new Error(
        `serializeAccessPolicy: field="${field}" value exceeds u64 max, got ${value.toString()}`,
      );
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `serializeAccessPolicy: field="${field}" value must be finite, got ${String(value)}`,
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `serializeAccessPolicy: field="${field}" value must be Number.isSafeInteger, got ${value}`,
      );
    }
    if (value < 0) {
      throw new Error(
        `serializeAccessPolicy: field="${field}" value must be non-negative, got ${value}`,
      );
    }
    return BigInt(value);
  }
  throw new Error(
    `serializeAccessPolicy: field="${field}" value must be bigint or number, got ${typeof value}`,
  );
}

/**
 * Serialize a canonical address to 32 fixed bytes via the SDK's
 * `AccountAddress` parser. Rejects inputs that are not hex-parseable
 * addresses with a plain `Error` naming the field (Req 11.6).
 *
 * Accepts full-length Canonical_Address (`0x` + 64 hex), short-form
 * (`0x1`), and bytes-shaped inputs — everything `AccountAddress.from`
 * accepts. The output is byte-for-byte equal to the Move VM's
 * `bcs::to_bytes(&addr)` on a 32-byte `address`.
 */
function serializeAddress(
  serializer: Serializer,
  addr: string,
  field: string,
): void {
  let bytes: Uint8Array;
  try {
    bytes = AccountAddress.from(addr).toUint8Array();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `serializeAccessPolicy: field="${field}" value is not a valid address ("${addr}"): ${cause}`,
    );
  }
  if (bytes.length !== ADDRESS_BYTES) {
    // Defensive — `AccountAddress.from(...).toUint8Array()` always
    // produces 32 bytes. A mismatch here would indicate an SDK change
    // we must catch before the wrong payload ships to chain.
    throw new Error(
      `serializeAccessPolicy: field="${field}" address encoded to ${bytes.length} bytes, expected ${ADDRESS_BYTES}`,
    );
  }
  serializer.serializeFixedBytes(bytes);
}

/**
 * BCS-encode a Move `AccessPolicy` into a byte vector suitable for
 * passing to `force_update_policy_v2` (as the `bcs_bytes` argument) or
 * embedded inside a `RegistrationInfoV2` payload.
 *
 * Emits variant-tag-first (Uleb128), then the variant-specific fields
 * in Move declaration order per Req 3.1. All u64 fields are validated
 * against the Move u64 range before bytes are emitted (Req 11.6), so a
 * caller can never accidentally produce an out-of-range payload that
 * the Move VM would abort on.
 *
 * @throws Error — for an unknown `policy.kind`, an invalid u64 field,
 *   or an unparseable address in an allowlist entry / CustomModule
 *   `module_addr`. A thrown error means the caller has supplied an
 *   invalid domain object; it is NOT a `ChainDeserializationError`
 *   because no decode has occurred.
 */
export function serializeAccessPolicy(policy: AccessPolicy): Uint8Array {
  const s = new Serializer();
  switch (policy.kind) {
    case 'Allowlist': {
      s.serializeU32AsUleb128(TAG_ALLOWLIST);
      const n = policy.addresses.length;
      // `serializeU32AsUleb128` validates the u32 range; an allowlist
      // above 2^32 entries is physically impossible in the UI, but the
      // SDK guard is our backstop.
      s.serializeU32AsUleb128(n);
      for (let i = 0; i < n; i++) {
        serializeAddress(s, policy.addresses[i]!, `Allowlist.addresses[${i}]`);
      }
      break;
    }
    case 'TimeLock': {
      s.serializeU32AsUleb128(TAG_TIMELOCK);
      const u = validateU64(policy.locked_until, 'TimeLock.locked_until');
      s.serializeU64(u);
      break;
    }
    case 'PayToDownload': {
      s.serializeU32AsUleb128(TAG_PAYTODOWNLOAD);
      const p = validateU64(policy.price, 'PayToDownload.price');
      s.serializeU64(p);
      break;
    }
    case 'CustomModule': {
      s.serializeU32AsUleb128(TAG_CUSTOMMODULE);
      serializeAddress(s, policy.module_addr, 'CustomModule.module_addr');
      if (typeof policy.module_name !== 'string') {
        throw new Error(
          `serializeAccessPolicy: field="CustomModule.module_name" must be a string, got ${typeof policy.module_name}`,
        );
      }
      s.serializeStr(policy.module_name);
      break;
    }
    default: {
      // Exhaustiveness guard — a new Move variant must update this
      // switch AND the deserializer below. TypeScript never exercises
      // this branch for a well-typed `AccessPolicy`; it is reachable
      // only via an `as AccessPolicy` cast of an unrelated shape.
      const exhaustive: never = policy;
      throw new Error(
        `serializeAccessPolicy: unknown variant kind=${JSON.stringify((exhaustive as { kind?: string }).kind)}`,
      );
    }
  }
  return s.toUint8Array();
}

/**
 * Translate a low-level Aptos SDK `Deserializer` throw into a structured
 * `ChainDeserializationError`. The SDK raises plain `Error` instances
 * with stable messages:
 *
 *   - "Reached to the end of buffer"                 → truncated
 *   - "Overflow while parsing uleb128-encoded uint32" → invalid_uleb128
 *   - "Buffer has remaining bytes"                   → trailing_bytes
 *
 * All other SDK failures (e.g. "Invalid boolean value") are classified
 * as `truncated` because the surrounding context already failed — a
 * bool-byte mismatch in our decode paths would indicate a malformed
 * Move payload that the Aptos VM would also reject, so the distinction
 * is not load-bearing for upstream error handling.
 *
 * A `ChainDeserializationError` from a nested helper (e.g. `microsToMs`
 * when decoding a TimeLock) is re-thrown unchanged so the innermost
 * reason / offset is preserved.
 */
function wrapDeserializerError(
  err: unknown,
  offset: number,
  inputLength: number,
  blobName: string | undefined,
  field: string,
): never {
  if (err instanceof ChainDeserializationError) {
    throw err;
  }
  const message = err instanceof Error ? err.message : String(err);
  let reason: ChainDeserializationReason;
  if (message.includes('uleb128')) {
    reason = 'invalid_uleb128';
  } else if (message.includes('remaining bytes')) {
    reason = 'trailing_bytes';
  } else if (
    message.includes('end of buffer') ||
    message.includes('Reached')
  ) {
    reason = 'truncated';
  } else {
    // Conservative default — any unrecognized SDK error in a decode
    // path means the payload does not match the Move shape we expect.
    reason = 'truncated';
  }
  throw new ChainDeserializationError({
    reason,
    offset,
    inputLength,
    blobName,
    field,
  });
}

/**
 * BCS-decode an `AccessPolicy` from the full byte vector produced by
 * `serializeAccessPolicy` (or by the Move module's
 * `bcs::to_bytes(&policy)`). Every input byte MUST be consumed by the
 * decode; trailing bytes raise `ChainDeserializationError` with
 * `reason: 'trailing_bytes'` per Req 3.2 / 3.7.
 *
 * Variant tag → shape mapping matches `serializeAccessPolicy` exactly.
 * Unknown tags (Uleb128 value `>= 4`) raise
 * `ChainDeserializationError({ reason: 'unknown_variant' })` so the
 * caller can surface `chain_unavailable` upstream.
 *
 * Address bytes are re-canonicalized via
 * `AccountAddress.from(bytes).toStringLong()` so the returned allowlist
 * entries / CustomModule.module_addr are always in the 66-character
 * lowercase 0x-prefixed form that downstream equality checks rely on
 * (Req 2.2, 4.7).
 *
 * The `blobName` argument is threaded through to every
 * `ChainDeserializationError` so operators can correlate a decode
 * failure with the specific blob that tripped it; it is optional
 * because unit tests may drive the decoder without a blob context.
 */
export function deserializeAccessPolicy(
  bytes: Uint8Array,
  blobName?: string,
): AccessPolicy {
  if (!(bytes instanceof Uint8Array)) {
    // Guard against accidental `number[]` / ArrayBuffer inputs — the
    // SDK `Deserializer` requires a Uint8Array and would otherwise
    // throw a cryptic message at the first `read`.
    throw new ChainDeserializationError({
      reason: 'truncated',
      offset: 0,
      inputLength: 0,
      blobName,
      field: 'input',
    });
  }
  const inputLength = bytes.length;
  const deserializer = new Deserializer(bytes);
  const policy = deserializeAccessPolicyInner(
    deserializer,
    inputLength,
    blobName,
  );
  // Byte-exact consumption guard (Req 3.2). Any remainder is a
  // `trailing_bytes` failure — the Move VM's `access_policy_from_bytes`
  // rejects this too, so the UI-level decoder must agree to stay in
  // lock-step with on-chain validation.
  if (deserializer.remaining() !== 0) {
    throw new ChainDeserializationError({
      reason: 'trailing_bytes',
      offset: inputLength - deserializer.remaining(),
      inputLength,
      blobName,
      field: 'AccessPolicy',
    });
  }
  return policy;
}

/**
 * Internal helper: decode JUST the `AccessPolicy` fields from an
 * already-constructed `Deserializer`. DOES NOT verify
 * `remaining() === 0`, so callers can compose it inside a larger
 * decode flow (e.g. `deserializeBlobMetadataV2`) where additional
 * outer-frame bytes remain after the policy has been consumed.
 *
 * `inputLength` is the length of the WHOLE buffer backing the
 * `deserializer` (not just the policy bytes) so the `offset` field
 * reported on error is meaningful to the caller handling the outer
 * struct. `blobName` is threaded through unchanged for error context.
 *
 * Both `deserializeAccessPolicy` (wrapper + trailing-bytes check) and
 * `deserializeBlobMetadataV2` (nested `access_policy` field) call
 * through here; the split exists so the outer-struct decoder does not
 * have to hand the inner decoder a freshly-sliced byte range just to
 * satisfy a remaining-byte assertion.
 */
function deserializeAccessPolicyInner(
  deserializer: Deserializer,
  inputLength: number,
  blobName?: string,
): AccessPolicy {
  // Byte offset at which the currently-decoded field begins. Computed
  // as `inputLength - deserializer.remaining()` captured BEFORE each
  // primitive read so a thrown error points at the field that failed
  // rather than at the buffer tail. `Deserializer` does not expose a
  // public `offset` accessor, so we derive it from `remaining()`.
  const offsetOf = (): number => inputLength - deserializer.remaining();

  // --- Variant tag --------------------------------------------------------
  let tag: number;
  const tagOffset = offsetOf();
  try {
    tag = deserializer.deserializeUleb128AsU32();
  } catch (err) {
    wrapDeserializerError(err, tagOffset, inputLength, blobName, 'variant_tag');
  }

  let policy: AccessPolicy;
  switch (tag!) {
    case TAG_ALLOWLIST: {
      // vector<address> — Uleb128 length prefix + n × 32 fixed bytes.
      let n: number;
      const lenOffset = offsetOf();
      try {
        n = deserializer.deserializeUleb128AsU32();
      } catch (err) {
        wrapDeserializerError(
          err,
          lenOffset,
          inputLength,
          blobName,
          'Allowlist.addresses.length',
        );
      }
      const addresses: string[] = new Array(n!);
      for (let i = 0; i < n!; i++) {
        const entryOffset = offsetOf();
        let raw: Uint8Array;
        try {
          raw = deserializer.deserializeFixedBytes(ADDRESS_BYTES);
        } catch (err) {
          wrapDeserializerError(
            err,
            entryOffset,
            inputLength,
            blobName,
            `Allowlist.addresses[${i}]`,
          );
        }
        // `AccountAddress.from(Uint8Array)` accepts any 32-byte buffer,
        // so the only way this throws is an SDK-internal issue. We
        // guard it defensively and classify as `truncated` (the bytes
        // did not shape into a valid address).
        try {
          addresses[i] = AccountAddress.from(raw!).toStringLong();
        } catch (err) {
          wrapDeserializerError(
            err,
            entryOffset,
            inputLength,
            blobName,
            `Allowlist.addresses[${i}]`,
          );
        }
      }
      policy = { kind: 'Allowlist', addresses };
      break;
    }
    case TAG_TIMELOCK: {
      const fieldOffset = offsetOf();
      let locked_until: bigint;
      try {
        locked_until = deserializer.deserializeU64();
      } catch (err) {
        wrapDeserializerError(
          err,
          fieldOffset,
          inputLength,
          blobName,
          'TimeLock.locked_until',
        );
      }
      policy = { kind: 'TimeLock', locked_until: locked_until! };
      break;
    }
    case TAG_PAYTODOWNLOAD: {
      const fieldOffset = offsetOf();
      let price: bigint;
      try {
        price = deserializer.deserializeU64();
      } catch (err) {
        wrapDeserializerError(
          err,
          fieldOffset,
          inputLength,
          blobName,
          'PayToDownload.price',
        );
      }
      policy = { kind: 'PayToDownload', price: price! };
      break;
    }
    case TAG_CUSTOMMODULE: {
      const addrOffset = offsetOf();
      let rawAddr: Uint8Array;
      try {
        rawAddr = deserializer.deserializeFixedBytes(ADDRESS_BYTES);
      } catch (err) {
        wrapDeserializerError(
          err,
          addrOffset,
          inputLength,
          blobName,
          'CustomModule.module_addr',
        );
      }
      let module_addr: string;
      try {
        module_addr = AccountAddress.from(rawAddr!).toStringLong();
      } catch (err) {
        wrapDeserializerError(
          err,
          addrOffset,
          inputLength,
          blobName,
          'CustomModule.module_addr',
        );
      }
      const nameOffset = offsetOf();
      let module_name: string;
      try {
        module_name = deserializer.deserializeStr();
      } catch (err) {
        wrapDeserializerError(
          err,
          nameOffset,
          inputLength,
          blobName,
          'CustomModule.module_name',
        );
      }
      policy = {
        kind: 'CustomModule',
        module_addr: module_addr!,
        module_name: module_name!,
      };
      break;
    }
    default: {
      // Unknown variant tag (>= 4) per Req 3.7.
      throw new ChainDeserializationError({
        reason: 'unknown_variant',
        offset: tagOffset,
        inputLength,
        blobName,
        field: `AccessPolicy.tag=${tag!}`,
      });
    }
  }

  return policy!;
}

// ---------------------------------------------------------------------------
// RegistrationInfoV2 + BlobMetadataV2 BCS (Req 3.3, 3.4, 3.7) — task 2.4.
//
// Wire format mirrors the Move `RegistrationInfoV2` / `BlobMetadataV2`
// struct declarations field-by-field. Both structs are fixed-field
// records (no variant tag), so encoding is the concatenation of each
// field's own BCS bytes in Move declaration order.
//
//   RegistrationInfoV2 {
//     blob_name:        String           → Uleb128 len + UTF-8 bytes
//     green_box_scheme: u8               → 1 byte
//     green_box_bytes:  vector<u8>       → Uleb128 len + bytes
//     access_policy:    AccessPolicy     → variant tag + variant fields
//   }
//
//   BlobMetadataV2 {
//     owner:            address          → 32 fixed bytes
//     green_box_scheme: u8               → 1 byte
//     green_box_bytes:  vector<u8>       → Uleb128 len + bytes
//     access_policy:    AccessPolicy     → variant tag + variant fields
//   }
//
// `get_maybe_blob_metadata_bcs` returns an outer `Option<BlobMetadataV2>`
// whose BCS encoding prefixes the struct with a single Uleb128 tag byte:
//   0x00 → None
//   0x01 → Some(metadata)
// Any other tag byte raises `ChainDeserializationError({ reason:
// 'unknown_variant' })` per Req 3.7.
//
// Serialization-side input validation parallels `serializeAccessPolicy`:
// invalid inputs throw plain `Error` (not `ChainDeserializationError`)
// because no decode is in progress. `green_box_scheme` must fit in `u8`,
// `green_box_bytes` must be a `Uint8Array`, `blob_name` must be a string.
// ---------------------------------------------------------------------------

/** u8 max, used to validate `green_box_scheme` before writing one byte. */
const U8_MAX = 0xff;

/**
 * BCS-encode a single `RegistrationInfoV2` struct. Field order follows
 * the Move declaration exactly (Req 3.3):
 *
 *     blob_name        → serializeStr
 *     green_box_scheme → serializeU8
 *     green_box_bytes  → serializeBytes    (Uleb128 len + bytes)
 *     access_policy    → serializeAccessPolicy (tag + fields)
 *
 * @throws Error on invalid field types / ranges. Never throws
 *   `ChainDeserializationError` — this is an encoder.
 */
export function serializeRegistrationInfoV2(
  info: RegistrationInfoV2,
): Uint8Array {
  if (typeof info !== 'object' || info === null) {
    throw new Error(
      `serializeRegistrationInfoV2: info must be an object, got ${typeof info}`,
    );
  }
  if (typeof info.blob_name !== 'string') {
    throw new Error(
      `serializeRegistrationInfoV2: field="blob_name" must be a string, got ${typeof info.blob_name}`,
    );
  }
  if (
    typeof info.green_box_scheme !== 'number' ||
    !Number.isInteger(info.green_box_scheme) ||
    info.green_box_scheme < 0 ||
    info.green_box_scheme > U8_MAX
  ) {
    throw new Error(
      `serializeRegistrationInfoV2: field="green_box_scheme" must be an integer in [0, 255], got ${String(info.green_box_scheme)}`,
    );
  }
  if (!(info.green_box_bytes instanceof Uint8Array)) {
    throw new Error(
      `serializeRegistrationInfoV2: field="green_box_bytes" must be a Uint8Array, got ${typeof info.green_box_bytes}`,
    );
  }

  const s = new Serializer();
  s.serializeStr(info.blob_name);
  s.serializeU8(info.green_box_scheme);
  s.serializeBytes(info.green_box_bytes);

  // Embed the serialized `AccessPolicy` bytes directly after the
  // preceding fields. `serializeAccessPolicy` returns the variant-tag
  // + fields encoding ready for concatenation, and `serializeFixedBytes`
  // writes them without a length prefix (which is what we want — the
  // policy's variant tag self-describes the frame).
  const policyBytes = serializeAccessPolicy(info.access_policy);
  s.serializeFixedBytes(policyBytes);

  return s.toUint8Array();
}

/**
 * BCS-encode a vector of `RegistrationInfoV2`. Wire format:
 *
 *   Uleb128 length prefix | element_0 bytes | element_1 bytes | …
 *
 * Each element is encoded by `serializeRegistrationInfoV2` and spliced
 * in without any per-element length prefix (the Move VM
 * `registration_infos_from_bytes` helper expects this exact layout).
 *
 * @throws Error when `infos` is not an array or when any element fails
 *   `serializeRegistrationInfoV2` validation.
 */
export function serializeRegistrationInfoV2Vec(
  infos: RegistrationInfoV2[],
): Uint8Array {
  if (!Array.isArray(infos)) {
    throw new Error(
      `serializeRegistrationInfoV2Vec: infos must be an array, got ${typeof infos}`,
    );
  }
  const s = new Serializer();
  s.serializeU32AsUleb128(infos.length);
  for (let i = 0; i < infos.length; i++) {
    const elementBytes = serializeRegistrationInfoV2(infos[i]!);
    s.serializeFixedBytes(elementBytes);
  }
  return s.toUint8Array();
}

/**
 * BCS-decode the payload returned by the Move view function
 * `get_maybe_blob_metadata_bcs(full_blob_name): vector<u8>`.
 *
 * The returned bytes encode `Option<BlobMetadataV2>`:
 *
 *   - tag `0x00` (Uleb128 0)     → returns `null`
 *   - tag `0x01` (Uleb128 1)     → decodes a `BlobMetadataV2` struct
 *   - any other tag (>= 2)       → throws `ChainDeserializationError`
 *                                  with `reason: 'unknown_variant'`
 *
 * Every byte of `bytes` MUST be consumed by a valid decode (Req 3.4);
 * trailing bytes after the struct completes raise
 * `ChainDeserializationError({ reason: 'trailing_bytes' })`. Truncation
 * inside any field raises `reason: 'truncated'` via
 * `wrapDeserializerError`.
 *
 * Address bytes for `owner` are re-canonicalized via
 * `AccountAddress.from(bytes).toStringLong()` so the returned value is
 * always in the 66-character 0x-prefixed lowercase form downstream
 * equality checks rely on (Req 2.2, 4.7).
 */
export function deserializeBlobMetadataV2(
  bytes: Uint8Array,
  blobName?: string,
): BlobMetadataV2 | null {
  if (!(bytes instanceof Uint8Array)) {
    throw new ChainDeserializationError({
      reason: 'truncated',
      offset: 0,
      inputLength: 0,
      blobName,
      field: 'input',
    });
  }
  const inputLength = bytes.length;
  const deserializer = new Deserializer(bytes);
  const offsetOf = (): number => inputLength - deserializer.remaining();

  // --- Outer Option tag ---------------------------------------------------
  let optionTag: number;
  const tagOffset = offsetOf();
  try {
    optionTag = deserializer.deserializeUleb128AsU32();
  } catch (err) {
    wrapDeserializerError(
      err,
      tagOffset,
      inputLength,
      blobName,
      'Option<BlobMetadataV2>.tag',
    );
  }

  if (optionTag! === 0) {
    // None — assert byte-exact consumption (Req 3.4) before returning.
    if (deserializer.remaining() !== 0) {
      throw new ChainDeserializationError({
        reason: 'trailing_bytes',
        offset: offsetOf(),
        inputLength,
        blobName,
        field: 'Option<BlobMetadataV2>',
      });
    }
    return null;
  }

  if (optionTag! !== 1) {
    // Any tag outside {0, 1} is an unknown Option variant (Req 3.7).
    throw new ChainDeserializationError({
      reason: 'unknown_variant',
      offset: tagOffset,
      inputLength,
      blobName,
      field: `Option<BlobMetadataV2>.tag=${optionTag!}`,
    });
  }

  // --- owner: address (32 fixed bytes) -----------------------------------
  const ownerOffset = offsetOf();
  let rawOwner: Uint8Array;
  try {
    rawOwner = deserializer.deserializeFixedBytes(ADDRESS_BYTES);
  } catch (err) {
    wrapDeserializerError(
      err,
      ownerOffset,
      inputLength,
      blobName,
      'BlobMetadataV2.owner',
    );
  }
  let owner: string;
  try {
    owner = AccountAddress.from(rawOwner!).toStringLong();
  } catch (err) {
    wrapDeserializerError(
      err,
      ownerOffset,
      inputLength,
      blobName,
      'BlobMetadataV2.owner',
    );
  }

  // --- green_box_scheme: u8 ---------------------------------------------
  const schemeOffset = offsetOf();
  let green_box_scheme: number;
  try {
    green_box_scheme = deserializer.deserializeU8();
  } catch (err) {
    wrapDeserializerError(
      err,
      schemeOffset,
      inputLength,
      blobName,
      'BlobMetadataV2.green_box_scheme',
    );
  }

  // --- green_box_bytes: vector<u8> --------------------------------------
  const bytesOffset = offsetOf();
  let green_box_bytes: Uint8Array;
  try {
    green_box_bytes = deserializer.deserializeBytes();
  } catch (err) {
    wrapDeserializerError(
      err,
      bytesOffset,
      inputLength,
      blobName,
      'BlobMetadataV2.green_box_bytes',
    );
  }

  // --- access_policy: AccessPolicy (variant tag + fields) ----------------
  // Feed the same Deserializer to the shared inner decoder so offset
  // reporting on a nested failure still points at the absolute byte
  // inside the full input buffer.
  let access_policy: AccessPolicy;
  try {
    access_policy = deserializeAccessPolicyInner(
      deserializer,
      inputLength,
      blobName,
    );
  } catch (err) {
    // `deserializeAccessPolicyInner` throws only
    // `ChainDeserializationError`; re-throw unchanged to preserve the
    // innermost reason / offset / field.
    if (err instanceof ChainDeserializationError) throw err;
    wrapDeserializerError(
      err,
      offsetOf(),
      inputLength,
      blobName,
      'BlobMetadataV2.access_policy',
    );
  }

  // --- Byte-exact consumption guard (Req 3.4) ---------------------------
  if (deserializer.remaining() !== 0) {
    throw new ChainDeserializationError({
      reason: 'trailing_bytes',
      offset: offsetOf(),
      inputLength,
      blobName,
      field: 'BlobMetadataV2',
    });
  }

  return {
    owner: owner!,
    green_box_scheme: green_box_scheme!,
    green_box_bytes: green_box_bytes!,
    access_policy: access_policy!,
  };
}
