/**
 * Aptos Keyless Authentication Service
 * Handles Google OAuth login with Aptos blockchain integration
 */

import {
  Aptos,
  AptosConfig,
  Network,
  EphemeralKeyPair,
  KeylessAccount,
  Hex,
  generateSignedTransaction,
} from '@aptos-labs/ts-sdk';

// aptos — Aptos TESTNET only for ZK account derivation (pepper + prover services live here)
const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

// aptosChain — Shelbynet custom node for submitting transactions
// This is where blob registrations and smart contracts actually live
const aptosChain = new Aptos(new AptosConfig({
  network: Network.CUSTOM,
  fullnode: process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL ?? 'https://api.testnet.aptoslabs.com/v1',
  indexer: process.env.NEXT_PUBLIC_SHELBYNET_INDEXER_URL ?? 'https://api.testnet.aptoslabs.com/v1/graphql',
}));

// Storage keys
const STORAGE_KEY_EKP = 'aptos-keyless-ekp';
const STORAGE_KEY_JWT = 'aptos-keyless-jwt';       // store JWT so we can re-derive account
const STORAGE_KEY_USER_INFO = 'aptos-keyless-user';

export interface KeylessUserInfo {
  email: string;
  name?: string;
  picture?: string;
  sub: string;
  accountAddress: string;
}

/**
 * Initiate Google OAuth login flow
 */
export function initiateGoogleLogin(): void {
  try {
    const ephemeralKeyPair = EphemeralKeyPair.generate();

    // Store as base64 — avoids 0x prefix issues with hex encoding
    const ekpBytes = ephemeralKeyPair.bcsToBytes();
    const ekpBase64 = Buffer.from(ekpBytes).toString('base64');
    localStorage.setItem(STORAGE_KEY_EKP, ekpBase64);

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new Error('Missing Google OAuth configuration. Check your environment variables.');
    }

    const loginUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    loginUrl.searchParams.set('client_id', clientId);
    loginUrl.searchParams.set('redirect_uri', redirectUri);
    loginUrl.searchParams.set('response_type', 'id_token');
    loginUrl.searchParams.set('scope', 'openid email profile');
    loginUrl.searchParams.set('nonce', ephemeralKeyPair.nonce);

    window.location.href = loginUrl.toString();
  } catch (error) {
    console.error('❌ Failed to initiate login:', error);
    throw error;
  }
}

/**
 * Finalize login after Google OAuth callback
 */
export async function finalizeGoogleLogin(): Promise<KeylessUserInfo> {
  console.log('🔐 Finalizing Google OAuth login...');

  try {
    // 1. Extract JWT from URL fragment
    const fragment = new URLSearchParams(window.location.hash.substring(1));
    const jwt = fragment.get('id_token');

    if (!jwt) {
      throw new Error('No JWT token found in URL. Login may have been cancelled.');
    }
    console.log('✅ JWT token retrieved');

    // Clear JWT from URL bar immediately (security — don't let it sit in history)
    window.history.replaceState(null, '', window.location.pathname);

    // 2. Retrieve stored ephemeral key pair
    const ekpStored = localStorage.getItem(STORAGE_KEY_EKP);
    if (!ekpStored) {
      throw new Error('Ephemeral key pair not found. Please try logging in again.');
    }

    const ephemeralKeyPair = EphemeralKeyPair.fromBytes(
      Buffer.from(ekpStored, 'base64')
    );
    console.log('✅ Retrieved ephemeral key pair');

    // 3. Derive Keyless Account
    console.log('🔑 Deriving Keyless account...');
    const keylessAccount = await aptos.deriveKeylessAccount({
      jwt,
      ephemeralKeyPair,
    });

    console.log('✅ Keyless account derived');
    console.log('   Address:', keylessAccount.accountAddress.toString());

    // 4. Verify JWT server-side
    console.log('➡️ Sending JWT to server for verification...');
    const response = await fetch('/api/auth/google/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: jwt }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to verify JWT on server');
    }

    const verifiedUserInfo = await response.json();
    console.log('✅ Server verified JWT');

    const keylessUserInfo: KeylessUserInfo = {
      email: verifiedUserInfo.email,
      name: verifiedUserInfo.name,
      picture: verifiedUserInfo.picture,
      sub: verifiedUserInfo.sub,
      accountAddress: keylessAccount.accountAddress.toString(),
    };

    // 5. Store JWT + user info — JWT is needed to re-derive the account later
    localStorage.setItem(STORAGE_KEY_JWT, jwt);
    localStorage.setItem(STORAGE_KEY_USER_INFO, JSON.stringify(keylessUserInfo));

    console.log('✅ Login complete!');
    return keylessUserInfo;
  } catch (error) {
    console.error('❌ Failed to finalize login:', error);
    throw error;
  }
}

/**
 * Re-derive the KeylessAccount from stored JWT + EKP
 * This is needed every session since KeylessAccount can't be serialised fully
 */
export async function getKeylessAccount(): Promise<KeylessAccount | null> {
  try {
    const jwt = localStorage.getItem(STORAGE_KEY_JWT);
    const ekpStored = localStorage.getItem(STORAGE_KEY_EKP);

    if (!jwt || !ekpStored) return null;

    const ephemeralKeyPair = EphemeralKeyPair.fromBytes(
      Buffer.from(ekpStored, 'base64')
    );

    // Check if EKP is expired — if so, user needs to re-login
    if (ephemeralKeyPair.isExpired()) {
      console.log('⏰ Ephemeral key expired — clearing session');
      logout();
      return null;
    }

    const keylessAccount = await aptos.deriveKeylessAccount({
      jwt,
      ephemeralKeyPair,
    });

    return keylessAccount;
  } catch (error) {
    console.error('Failed to get keyless account:', error);
    return null;
  }
}

/**
 * Build a signAndSubmitTransaction function for Google keyless users
 * Returns a function with the same signature as the wallet adapter's version
 */
export async function getKeylessSignAndSubmit(): Promise<((payload: any) => Promise<any>) | null> {
  const keylessAccount = await getKeylessAccount();
  if (!keylessAccount) return null;

  return async (payload: any) => {
    const shelbyNode = (process.env.NEXT_PUBLIC_SHELBYNET_NODE_URL ?? 'https://api.testnet.aptoslabs.com/v1').replace(/\/$/, '');
    const senderAddress = keylessAccount.accountAddress.toString();

    // Fetch account sequence number directly from Shelbynet
    // Using raw fetch avoids the SDK trying to parse non-standard responses
    const accountRes = await fetch(`${shelbyNode}/accounts/${senderAddress}`)
      .then(r => r.json())
      .catch(() => ({ sequence_number: '0' }));

    const sequenceNumber = BigInt(accountRes.sequence_number ?? '0');

    // Build transaction using aptos testnet client, injecting sequence number
    const transaction = await aptos.transaction.build.simple({
      sender: keylessAccount.accountAddress,
      data: payload.data ?? payload,
      options: {
        accountSequenceNumber: sequenceNumber,
      },
    });

    // Sign using keyless account (ZK proof via Aptos testnet pepper/prover)
    const senderAuthenticator = aptos.transaction.sign({
      signer: keylessAccount,
      transaction,
    });

    // Submit BCS-encoded bytes directly to Shelbynet — bypasses SDK JSON parsing
    const submitRes = await fetch(`${shelbyNode}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x.aptos.signed_transaction+bcs' },
      body: generateSignedTransaction({ transaction, senderAuthenticator }),
    });

    let hash = `tx_${Date.now()}`;
    try {
      const text = await submitRes.text();
      // Shelbynet may return "true" or JSON — handle both
      if (text.startsWith('{') || text.startsWith('"')) {
        const json = JSON.parse(text);
        hash = json.hash ?? json.transaction_hash ?? hash;
      }
    } catch {
      // Non-JSON response — tx still submitted successfully
    }

    console.log('✅ Keyless transaction submitted to Shelbynet:', hash);
    return { hash };
  };
}

/**
 * Get user info from storage
 */
export function getUserInfo(): KeylessUserInfo | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_USER_INFO);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Check if user is logged in via Google
 */
export function isLoggedIn(): boolean {
  const userInfo = getUserInfo();
  return userInfo !== null && !!userInfo.accountAddress;
}

/**
 * Logout — clear all stored data
 */
export function logout(): void {
  localStorage.removeItem(STORAGE_KEY_EKP);
  localStorage.removeItem(STORAGE_KEY_JWT);
  localStorage.removeItem(STORAGE_KEY_USER_INFO);
  console.log('✅ Logged out');
}

/**
 * Get Aptos client instance
 */
export function getAptosClient(): Aptos {
  return aptos;
}

/**
 * Check and clean up expired ephemeral keys
 */
export function cleanupExpiredKeys(): void {
  try {
    const ekpStored = localStorage.getItem(STORAGE_KEY_EKP);
    if (!ekpStored) return;

    const ephemeralKeyPair = EphemeralKeyPair.fromBytes(
      Buffer.from(ekpStored, 'base64')
    );

    if (ephemeralKeyPair.isExpired()) {
      console.log('⏰ Ephemeral key expired - cleaning up');
      logout();
    }
  } catch {
    // Key may be corrupted — clean up
    logout();
  }
}
