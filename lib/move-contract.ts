/**
 * lib/move-contract.ts
 *
 * Single source of truth for the deployed Aptos `access_control` Move
 * module address and its fully qualified module identifier. Every call
 * into the module (entry functions, view functions, event types) builds
 * its `${ACCESS_CONTROL_MODULE}<function_name>` identifier from the
 * constants exported here rather than duplicating the address literal,
 * so switching environments is a one-line env change rather than a
 * codebase-wide find-and-replace.
 *
 * Resolution rules (Req 1.1 - 1.4):
 *   - Read `NEXT_PUBLIC_ACCESS_CONTROL_MODULE_ADDRESS` and trim surrounding
 *     whitespace.
 *   - Treat `undefined`, empty string, and whitespace-only values as
 *     unset; fall back to `DEFAULT_ACCESS_CONTROL_MODULE_ADDRESS`.
 *   - Validate the resolved candidate against `^0x[a-fA-F0-9]{1,64}$`.
 *   - Throw at module import time on invalid input, naming the env var
 *     and quoting the rejected value verbatim so the operator sees the
 *     exact value the process rejected without guessing at quoting.
 *   - Guarantee the built-in default satisfies the regex (Req 1.3) so a
 *     fully unset environment never reaches the error branch.
 *
 * The Aptos client itself is NOT constructed here — callers that need
 * to hit the chain use `getAptosClient()` from `lib/aptos-client.ts`
 * (Req 1.6), so there is exactly one Aptos client in the process.
 *
 * Requirements covered: 1.1, 1.2, 1.3, 1.4, 1.6
 */

/**
 * The default Move module address used when
 * `NEXT_PUBLIC_ACCESS_CONTROL_MODULE_ADDRESS` is unset, empty, or
 * whitespace-only. A full 64-hex address so it trivially satisfies the
 * validation regex (Req 1.3).
 */
export const DEFAULT_ACCESS_CONTROL_MODULE_ADDRESS =
  '0x8e09cdeebdebcf4885c8d6b8a388a7a01e1b8c9327c886ea234b5d92bfa8d652';

/**
 * Accepted Module_Address format — a `0x` prefix followed by 1 to 64
 * hex characters. Shorter-than-64 addresses are accepted for env
 * compatibility; downstream canonicalization (`AccountAddress.from(x)
 * .toStringLong()`) zero-pads them to 66 characters when needed.
 */
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

/**
 * Resolve the Move module address from the environment, applying the
 * rules documented at the top of this file. Exported for targeted
 * testing; application code should use `ACCESS_CONTROL_MODULE_ADDRESS`
 * or `ACCESS_CONTROL_MODULE` instead so the validation happens exactly
 * once at module import time.
 */
export function resolveModuleAddress(): string {
  const raw = process.env.NEXT_PUBLIC_ACCESS_CONTROL_MODULE_ADDRESS;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const candidate =
    trimmed.length > 0 ? trimmed : DEFAULT_ACCESS_CONTROL_MODULE_ADDRESS;

  if (!ADDRESS_REGEX.test(candidate)) {
    // Req 1.2 — name the env var, quote the rejected value verbatim,
    // and state the expected format so the operator can fix it without
    // re-deriving the regex from documentation.
    throw new Error(
      `NEXT_PUBLIC_ACCESS_CONTROL_MODULE_ADDRESS rejected: "${candidate}". ` +
        `Expected format: ^0x[a-fA-F0-9]{1,64}$`,
    );
  }

  return candidate;
}

/**
 * The validated Move module address. Resolved once at module import
 * time; an invalid env value throws here, failing fast before any
 * downstream code attempts to build an entry-function identifier.
 */
export const ACCESS_CONTROL_MODULE_ADDRESS: string = resolveModuleAddress();

/**
 * Fully qualified module prefix used to construct every entry- and
 * view-function identifier. Ends with a trailing `::` so callers can
 * concatenate the bare function name directly:
 *
 *   ${ACCESS_CONTROL_MODULE}register_blob_v2
 *   ${ACCESS_CONTROL_MODULE}check_permission
 *
 * Typed as the Aptos TS SDK's expected template-literal shape
 * (`${string}::${string}::${string}`) so the resulting string is
 * accepted by `InputGenerateTransactionPayloadData.function` without a
 * cast (Req 1.4).
 */
export const ACCESS_CONTROL_MODULE: `${string}::${string}::${string}` =
  `${ACCESS_CONTROL_MODULE_ADDRESS}::access_control::` as const;
