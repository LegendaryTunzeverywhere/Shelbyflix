/**
 * Wallet signature verification — server side.
 *
 * This app accepts two very different kinds of wallet, and they need two
 * genuinely different cryptographic verification procedures:
 *
 *   1. PETRA / any browser-extension wallet (Ed25519).
 *      The extension holds a real Ed25519 keypair. `signMessage()` returns an
 *      Ed25519 signature over a wallet-standard framed message. Verification is
 *      purely local and synchronous: no network, no chain state.
 *
 *   2. "Continue with Google" / "Continue with Apple" (AptosConnect).
 *      These are NOT a different signing algorithm bolted onto #1 — they are
 *      Aptos **Keyless** accounts. The wallet returns a `KeylessSignature`:
 *      a zero-knowledge proof (Groth16) that the caller holds a Google/Apple
 *      OIDC identity, plus a short-lived ephemeral Ed25519 keypair bound to
 *      it. Verifying it requires reading two things off the chain:
 *
 *        - `0x1::keyless_account::Configuration` + `Groth16VerificationKey`
 *          (the on-chain Groth16 verification key and byte-length bounds)
 *        - `0x1::jwks::PatchedJWKs` (the patched JWK set, keyed by the JWT
 *          `iss` and `kid` embedded in the proof)
 *
 *      and running an actual pairing check. That is asynchronous and
 *      network-dependent by construction.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * Every route in this app used to call `AnyPublicKey.verifySignature()` (or a
 * hardcoded `new Ed25519PublicKey(...)`) directly. That works for Petra and
 * fails for Google/Apple, because the SDK's *synchronous* `verifySignature()`
 * on a Keyless public key deliberately throws:
 *
 *     throw new Error("Use verifySignatureAsync to verify Keyless signatures")
 *     // node_modules/@aptos-labs/ts-sdk/src/core/crypto/singleKey.ts
 *
 * That throw was swallowed by the surrounding `try/catch` and surfaced to the
 * user as a flat "Signature verification failed" 401 on every video upload —
 * indistinguishable from an actually-bad signature, and impossible to fix by
 * tweaking the Ed25519 parsing.
 *
 * DESIGN RULE: the two paths below share *nothing* except the two hex parsers
 * at the top. The Ed25519 branch is a byte-for-byte copy of the logic that
 * already worked for Petra; the keyless branch is new and additive. Changing
 * or removing the keyless branch cannot alter Petra's behaviour, and vice
 * versa. That isolation is the whole point of this module — it is what makes
 * it safe to change one without regressing the other.
 */

import {
  AnyPublicKey,
  AnySignature,
  AptosConfig,
  Ed25519PublicKey,
  Ed25519Signature,
  FederatedKeylessPublicKey,
  KeylessError,
  KeylessErrorCategory,
  KeylessErrorType,
  KeylessPublicKey,
  KeylessSignature,
  Network,
  PublicKey,
  ZeroKnowledgeSig,
  Deserializer,
  deserializePublicKey,
  deserializeSignature,
} from '@aptos-labs/ts-sdk';
import { hexToBytes } from '@/lib/shared-utils';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Which verification procedure handled the signature.
 *
 * - `ed25519` : Petra and other classic extension wallets. Local, synchronous.
 * - `keyless` : AptosConnect Google/Apple social login. On-chain ZK proof.
 */
export type WalletSignatureScheme = 'ed25519' | 'keyless';

/**
 * Why a signature failed, in terms a route can act on.
 *
 * - `invalid`     — the signature genuinely does not match. -> 401.
 * - `unavailable` — we could not *check* it, because the chain state the
 *                   check depends on was unreachable / absent. This is a
 *                   server-side outage, not a user error, and reporting it
 *                   as 401 would be a lie that also makes the failure
 *                   undiagnosable. -> 503.
 * - `unsupported` — well-formed request, but this wallet's key/signature pair
 *                   is not something we know how to verify at all. -> 400.
 */
export type WalletSignatureFailure = 'invalid' | 'unavailable' | 'unsupported';

export type WalletSignatureResult =
  | { valid: true; scheme: WalletSignatureScheme }
  | {
      valid: false;
      scheme: WalletSignatureScheme | 'unknown';
      reason: WalletSignatureFailure;
      /** Human-readable diagnostic. Safe to log; never contains key material. */
      detail?: string;
    };

// ---------------------------------------------------------------------------
// Hex parsers
//
// Three encodings occur in the wild and all three must be accepted:
//
//   1. Bare, untagged key material — 32 bytes for Ed25519, 64 for a
//      signature. This is what the Petra extension sends.
//   2. BCS with a length prefix but no variant tag — e.g. 0x20 followed by a
//      32-byte Ed25519 key. This SDK's `serializeBytes` writes lengths, so
//      anything produced by `publicKey.toUint8Array()` in this version is
//      this shape.
//   3. BCS `AnyPublicKey` / `AnySignature` — a leading variant byte followed by
//      (2). Every AptosConnect "Continue with Google"/"Continue with Apple"
//      account is this shape, because those are Aptos keyless accounts.
//
// `deserializePublicKey` / `deserializeSignature` try every concrete type in
// turn and throw if none matched. Two of their failure modes matter here and
// both are handled below:
//
//   * They throw on a bare untagged key (case 1) — there is no variant tag to
//     disambiguate it. The raw-hex fallback covers this, and it is what keeps
//     Petra working. It is load-bearing, not defensive dead code.
//   * For a BCS `AnyPublicKey` wrapping an Ed25519 key (case 3 with an Ed25519
//     inner key) they throw "Multiple possible deserializations found": the
//     bytes `0x00 0x20 <32 bytes>` parse validly both as AnyPublicKey
//     (variant 0 = Ed25519, then a 32-byte body) and as a bare KeylessPublicKey
//     (a zero-length `iss` string, then a 32-byte commitment). The explicit
//     AnyPublicKey step below settles it by the variant byte, which is
//     authoritative.
// ---------------------------------------------------------------------------

function stripHexPrefix(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

export function parseWalletPublicKey(value: string): AnyPublicKey | Ed25519PublicKey {
  try {
    return deserializePublicKey(value) as AnyPublicKey | Ed25519PublicKey;
  } catch {
    // Ambiguous BCS blob: trust the AnyPublicKey variant byte.
    try {
      const deserializer = Deserializer.fromHex(value);
      const key = AnyPublicKey.deserialize(deserializer);
      deserializer.assertFinished();
      return key;
    } catch {
      return new Ed25519PublicKey(hexToBytes(stripHexPrefix(value)));
    }
  }
}

export function parseWalletSignature(value: string): AnySignature | Ed25519Signature {
  try {
    return deserializeSignature(value) as AnySignature | Ed25519Signature;
  } catch {
    // Ambiguous BCS blob: trust the AnySignature variant byte.
    try {
      const deserializer = Deserializer.fromHex(value);
      const signature = AnySignature.deserialize(deserializer);
      deserializer.assertFinished();
      return signature;
    } catch {
      return new Ed25519Signature(hexToBytes(stripHexPrefix(value)));
    }
  }
}

// ---------------------------------------------------------------------------
// Keyless detection
// ---------------------------------------------------------------------------

/**
 * Unwrap to the concrete inner key and report whether it is an Aptos Keyless
 * (or Federated Keyless) public key — i.e. a Google/Apple social-login account.
 */
function getInnerPublicKey(publicKey: PublicKey): PublicKey {
  return publicKey instanceof AnyPublicKey ? publicKey.publicKey : publicKey;
}

function isKeylessKey(publicKey: PublicKey): boolean {
  const inner = getInnerPublicKey(publicKey);
  return inner instanceof KeylessPublicKey || inner instanceof FederatedKeylessPublicKey;
}

/**
 * Peel `AnySignature` wrappers off, returning the concrete signature.
 */
function unwrapSignature(signature: AnySignature | Ed25519Signature) {
  return signature instanceof AnySignature ? signature.signature : signature;
}

// ---------------------------------------------------------------------------
// Network config for the keyless path
//
// WHY THIS IS *NOT* THE SHELBY NETWORK — read before "simplifying" it
// -----------------------------------------------------------------------
// A Google/Apple keyless signature is not a Shelby artefact. It is a Groth16
// zero-knowledge proof minted by AptosConnect, and it is only verifiable
// against the `0x1::keyless_account::Groth16VerificationKey` of the Aptos
// network the account was created on. Those keys genuinely differ per network
// (Shelbynet's `delta_g2` is 0xe65b1be7…, mainnet's and testnet's are
// 0xb1066199…), so verifying a proof against the wrong network fails the
// pairing check with a bare "The proof verification failed" — indistinguishable
// from forgery.
//
// And the network the account is created on is NOT the network this dApp is
// configured for. `@aptos-connect/wallet-adapter-plugin`'s `networkToChainId()`
// only maps MAINNET and TESTNET:
//
//     case Network.MAINNET: return NetworkToChainId.mainnet;
//     case Network.TESTNET:  return NetworkToChainId.testnet;
//     default:               return void 0;        // SHELBYNET lands here
//
// components/AptosWalletProvider.tsx passes `Network.SHELBYNET`, so the
// chainId sent to AptosConnect is `undefined` and the service applies its own
// default of mainnet. The account and its proof are therefore mainnet-scoped
// even though every other part of this app talks to Shelbynet.
//
// Consequence: keyless verification must target Aptos mainnet (testnet shares
// mainnet's verification key, so it is equally valid) while the rest of the app
// keeps using Shelbynet. The two are configured independently on purpose — do
// not merge them, and do not point this at NEXT_PUBLIC_SHELBYNET_NODE_URL.
//
// Overridable via KEYLESS_VERIFICATION_FULLNODE_URL /
// KEYLESS_VERIFICATION_NETWORK for deployments that provision AptosConnect
// differently.
//
// Built lazily and memoised: only keyless requests pay for it, and Petra
// uploads never construct it at all.
// ---------------------------------------------------------------------------

let cachedKeylessAptosConfig: AptosConfig | null = null;

function getKeylessAptosConfig(): AptosConfig {
  if (cachedKeylessAptosConfig) return cachedKeylessAptosConfig;

  // Aptos mainnet's fullnode needs no API key.
  const fullnode =
    process.env.KEYLESS_VERIFICATION_FULLNODE_URL?.trim() ||
    'https://api.mainnet.aptoslabs.com/v1';

  const networkName = process.env.KEYLESS_VERIFICATION_NETWORK?.trim() || Network.MAINNET;
  const network = (Object.values(Network) as string[]).includes(networkName)
    ? (networkName as Network)
    : Network.MAINNET;

  cachedKeylessAptosConfig = new AptosConfig({ network, fullnode });
  return cachedKeylessAptosConfig;
}

/** Test seam — drops the memoised config so a new env takes effect. */
export function __resetVerificationAptosConfig(): void {
  cachedKeylessAptosConfig = null;
}

// ---------------------------------------------------------------------------
// PATH 1 — Ed25519 (Petra / browser extensions)
//
// This is the code that already worked. It is reproduced here unchanged,
// in isolation, and short-circuits before the keyless code is ever reached.
// ---------------------------------------------------------------------------

function verifyEd25519Signature(args: {
  publicKey: AnyPublicKey | Ed25519PublicKey;
  signature: AnySignature | Ed25519Signature;
  message: string;
}): WalletSignatureResult {
  const { publicKey, signature, message } = args;

  let valid: boolean;
  try {
    if (publicKey instanceof AnyPublicKey) {
      const anySignature =
        signature instanceof AnySignature ? signature : new AnySignature(signature);
      valid = publicKey.verifySignature({ message, signature: anySignature });
    } else {
      const ed25519Signature =
        signature instanceof AnySignature ? signature.signature : signature;
      valid = publicKey.verifySignature({
        message,
        signature: ed25519Signature as Ed25519Signature,
      });
    }
  } catch (err) {
    return {
      valid: false,
      scheme: 'ed25519',
      reason: 'invalid',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  return valid
    ? { valid: true, scheme: 'ed25519' }
    : { valid: false, scheme: 'ed25519', reason: 'invalid' };
}

// ---------------------------------------------------------------------------
// PATH 2 — Keyless (AptosConnect "Continue with Google" / "Continue with Apple")
//
// Runs the real check: verify the ephemeral Ed25519 signature over the message,
// then verify the Groth16 proof against the on-chain verification key and the
// patched JWK for the token's issuer. Both the configuration and the JWK set
// are fetched from the fullnode, which is why this is async.
//
// Added for Google/Apple social login only. Nothing in this function is
// reachable from an Ed25519 request.
// ---------------------------------------------------------------------------

async function verifyKeylessSignature(args: {
  publicKey: PublicKey;
  signature: AnySignature | Ed25519Signature;
  message: string;
}): Promise<WalletSignatureResult> {
  const { publicKey, signature, message } = args;

  const innerPublicKey = getInnerPublicKey(publicKey);
  const innerSignature = unwrapSignature(signature);

  if (!(innerSignature instanceof KeylessSignature)) {
    return {
      valid: false,
      scheme: 'keyless',
      reason: 'unsupported',
      detail:
        'Public key is an Aptos keyless (Google/Apple) key but the signature is ' +
        'not a keyless signature. The wallet returned a mismatched pair.',
    };
  }

  let aptosConfig: AptosConfig;
  try {
    aptosConfig = getKeylessAptosConfig();
  } catch (err) {
    return {
      valid: false,
      scheme: 'keyless',
      reason: 'unavailable',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const valid = await innerPublicKey.verifySignatureAsync({
      aptosConfig,
      message,
      signature: innerSignature,
      // Without this the SDK swallows the real reason and just returns
      // `false`, which would make an unreachable fullnode indistinguishable
      // from a forged signature.
      options: { throwErrorWithReason: true },
    } as never);

    return valid === true
      ? { valid: true, scheme: 'keyless' }
      : { valid: false, scheme: 'keyless', reason: 'invalid' };
  } catch (err) {
    if (err instanceof KeylessError) {
      // API_ERROR / EXTERNAL_API_ERROR mean we never got a trustworthy
      // verdict (fullnode down, keyless module missing, JWK not fetched,
      // rate-limited). Everything else (expired proof, bad JWT, unrecognised
      // issuer, failed pairing) is a real "no".
      const infraFailure =
        err.category === KeylessErrorCategory.API_ERROR ||
        err.category === KeylessErrorCategory.EXTERNAL_API_ERROR;

      // PROOF_VERIFICATION_FAILED specifically means the Groth16 pairing check
      // did not hold. The statement being hashed there does NOT include the
      // signed message — it is built from the ephemeral key, the idCommitment
      // of the public key we were handed, the expiry, the issuer, the JWT
      // header and the on-chain JWK. So when only the pairing fails, the
      // signature and our message handling are fine; what is in question is
      // the public key, or the JWK/issuer it was proved against. Log those
      // inputs, because the user-visible message ("Invalid wallet signature")
      // cannot distinguish "forged" from "wrong public key submitted".
      if (err.type === KeylessErrorType.PROOF_VERIFICATION_FAILED) {
        console.error(
          '[wallet-signature] keyless proof verification failed — inputs:',
          describeKeylessInputs(innerPublicKey, innerSignature, publicKey),
        );
      }

      return {
        valid: false,
        scheme: 'keyless',
        reason: infraFailure ? 'unavailable' : 'invalid',
        detail: `${String(err.type)}: ${err.message}`,
      };
    }

    return {
      valid: false,
      scheme: 'keyless',
      reason: 'unavailable',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Keyless diagnostics
//
// A keyless proof commits to { ephemeral key, idCommitment, expiry, issuer,
// JWT header, on-chain JWK } — NOT to the message. So a pairing failure is
// ambiguous between "forged" and "the app submitted the wrong public key",
// and the API response cannot tell those apart. This dumps the inputs that
// determine the statement so the cause is visible in server logs.
// ---------------------------------------------------------------------------

function shortHex(bytes: Uint8Array, chars = 16): string {
  const hex = Buffer.from(bytes).toString('hex');
  return hex.length <= chars ? hex : `${hex.slice(0, chars)}…(${hex.length / 2}b)`;
}

function describeKeylessInputs(
  innerPublicKey: PublicKey,
  innerSignature: KeylessSignature,
  submittedPublicKey: PublicKey,
): Record<string, unknown> {
  const info: Record<string, unknown> = {};

  try {
    if (innerPublicKey instanceof KeylessPublicKey) {
      info.issuer = innerPublicKey.iss;
      info.idCommitment = shortHex(innerPublicKey.idCommitment, 32);
    } else if (innerPublicKey instanceof FederatedKeylessPublicKey) {
      info.issuer = innerPublicKey.keylessPublicKey.iss;
      info.idCommitment = shortHex(innerPublicKey.keylessPublicKey.idCommitment, 32);
      info.federatedJwkAddress = innerPublicKey.jwkAddress.toString();
    }
  } catch (e) {
    info.publicKeyReadError = e instanceof Error ? e.message : String(e);
  }

  try {
    info.jwtHeader = innerSignature.jwtHeader;
    info.jwtKid = innerSignature.getJwkKid();
    info.expiryDateSecs = innerSignature.expiryDateSecs;
    info.expired = innerSignature.expiryDateSecs * 1000 < Date.now();
    const cert = innerSignature.ephemeralCertificate.signature;
    if (cert instanceof ZeroKnowledgeSig) {
      info.expHorizonSecs = cert.expHorizonSecs;
      info.extraField = cert.extraField ?? null;
      info.overrideAudVal = cert.overrideAudVal ?? null;
      info.hasTrainingWheels = !!cert.trainingWheelsSignature;
    }
    info.ephemeralPublicKey = shortHex(innerSignature.ephemeralPublicKey.toUint8Array());
  } catch (e) {
    info.signatureReadError = e instanceof Error ? e.message : String(e);
  }

  // Does the submitted public key actually belong to the address the caller
  // claims? The route is not told the address here, so the auth key is logged
  // for comparison against the request's walletAddress.
  try {
    const authKeyBytes = new Uint8Array(
      (submittedPublicKey as unknown as {
        authKey(): { toUint8Array(): Uint8Array };
      })
        .authKey()
        .toUint8Array(),
    );
    info.authKeyOfSubmittedPublicKey = shortHex(authKeyBytes, 64);
  } catch (e) {
    info.authKeyError = e instanceof Error ? e.message : String(e);
  }

  return info;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Verify a wallet signature over `message`, choosing the correct procedure for
 * the key type the wallet actually used.
 *
 * @param publicKey  hex public key as returned by the wallet
 * @param signature  hex signature as returned by the wallet
 * @param message    the exact bytes the wallet signed (the wallet-standard
 *                   `fullMessage`, not the plain text we asked it to sign)
 */
export async function verifyWalletSignature(args: {
  publicKey: string;
  signature: string;
  message: string;
}): Promise<WalletSignatureResult> {
  const { publicKey: publicKeyHex, signature: signatureHex, message } = args;

  let publicKey: AnyPublicKey | Ed25519PublicKey;
  let signature: AnySignature | Ed25519Signature;
  try {
    // Parsed independently so a signature-parse fallback can never cause an
    // already-valid public key to be reparsed differently.
    publicKey = parseWalletPublicKey(publicKeyHex);
    signature = parseWalletSignature(signatureHex);
  } catch (err) {
    return {
      valid: false,
      scheme: 'unknown',
      reason: 'unsupported',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // The message is handed to the SDK as a `0x` hex string rather than a
  // Uint8Array on purpose. The SDK's `Hex.fromHexInput()` branches on
  // `hexInput instanceof Uint8Array`, and that check is realm-sensitive: a
  // Uint8Array produced by a TextEncoder from a different realm (a worker, a
  // test environment, an older polyfill) silently fails the check and gets
  // treated as a hex *string*, producing a `startsWith is not a function`
  // throw. A hex string is unambiguous and byte-identical, so it removes that
  // whole class of failure from both the Petra and the keyless path.
  const messageHex = `0x${Array.from(
    new TextEncoder().encode(message),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')}`;

  // ── Petra / Ed25519: unchanged, local, synchronous. ────────────────────
  // This is the branch that already worked in production. The keyless branch
  // below is never consulted for these wallets.
  if (!isKeylessKey(publicKey)) {
    return verifyEd25519Signature({ publicKey, signature, message: messageHex });
  }

  // ── Google / Apple keyless: on-chain zero-knowledge proof. ─────────────
  return verifyKeylessSignature({ publicKey, signature, message: messageHex });
}

/**
 * True when this public key belongs to a Google/Apple social-login account.
 * Routes use this to pick an accurate user-facing error message.
 */
export function isKeylessWalletPublicKey(publicKeyHex: string): boolean {
  try {
    return isKeylessKey(parseWalletPublicKey(publicKeyHex));
  } catch {
    return false;
  }
}
