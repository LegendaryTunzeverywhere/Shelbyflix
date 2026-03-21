/**
 * Aptos Keyless Authentication Service
 * Handles Google OAuth login with Aptos blockchain integration
 * FIXED: Added pepper service URL configuration
 */

import {
  Aptos,
  AptosConfig,
  Network,
  EphemeralKeyPair,
  KeylessAccount,
} from '@aptos-labs/ts-sdk';

// Initialize Aptos client with pepper service
const network = (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) || Network.TESTNET;

const config = new AptosConfig({
  network,
  // CRITICAL FIX: Add pepper service URL for Keyless authentication
  pepperServiceUrl: 'https://api.testnet.aptoslabs.com/v1/keyless/pepper',
  // For mainnet, use: 'https://api.mainnet.aptoslabs.com/v1/keyless/pepper'
} as any);

const aptos = new Aptos(config);

// Storage keys
const STORAGE_KEY_EKP = 'aptos-keyless-ekp';
const STORAGE_KEY_ACCOUNT = 'aptos-keyless-account';
const STORAGE_KEY_USER_INFO = 'aptos-keyless-user';

export interface KeylessUserInfo {
  email: string;
  name?: string;
  picture?: string;
  sub: string; // Google user ID
  accountAddress: string;
}

/**
 * Initiate Google OAuth login flow
 * Generates ephemeral key pair and redirects to Google
 */
export function initiateGoogleLogin(): void {
  console.log('🔐 Initiating Google OAuth login...');

  try {
    // 1. Generate ephemeral key pair
    const ephemeralKeyPair = EphemeralKeyPair.generate();
    console.log('✅ Generated ephemeral key pair');

    // 2. Store in localStorage (needed after redirect)
    const ekpBytes = ephemeralKeyPair.bcsToBytes();
    const ekpBase64 = Buffer.from(ekpBytes).toString('base64');
    localStorage.setItem(STORAGE_KEY_EKP, ekpBase64);
    console.log('✅ Stored ephemeral key pair');

    // 3. Build Google OAuth URL
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new Error('Missing Google OAuth configuration. Check your .env.local file.');
    }

    const nonce = ephemeralKeyPair.nonce;

    const loginUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    loginUrl.searchParams.set('client_id', clientId);
    loginUrl.searchParams.set('redirect_uri', redirectUri);
    loginUrl.searchParams.set('response_type', 'id_token');
    loginUrl.searchParams.set('scope', 'openid email profile');
    loginUrl.searchParams.set('nonce', nonce);

    console.log('🔗 Redirecting to Google OAuth...');
    window.location.href = loginUrl.toString();
  } catch (error) {
    console.error('❌ Failed to initiate login:', error);
    throw error;
  }
}

/**
 * Finalize login after Google OAuth callback
 * Derives Aptos Keyless account from JWT
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

    // 2. Retrieve stored ephemeral key pair
    const ekpStored = localStorage.getItem(STORAGE_KEY_EKP);
    if (!ekpStored) {
      throw new Error('Ephemeral key pair not found. Please try logging in again.');
    }

    const ephemeralKeyPair = EphemeralKeyPair.fromBytes(
      Buffer.from(ekpStored, 'base64')
    );
    console.log('✅ Retrieved ephemeral key pair');

    // 3. Derive Keyless Account (with pepper service configured in AptosConfig above)
    console.log('🔑 Deriving Keyless account...');
    const keylessAccount = await aptos.deriveKeylessAccount({
      jwt,
      ephemeralKeyPair,
    });

    console.log('✅ Keyless account derived');
    console.log('   Address:', keylessAccount.accountAddress.toString());

    // 4. Parse user info from JWT
    const userInfo = parseJWT(jwt);
    const keylessUserInfo: KeylessUserInfo = {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      sub: userInfo.sub,
      accountAddress: keylessAccount.accountAddress.toString(),
    };

    // 5. Store account and user info
    await storeKeylessAccount(keylessAccount, keylessUserInfo);

    console.log('✅ Login complete!');
    console.log('   Email:', keylessUserInfo.email);
    console.log('   Account:', keylessUserInfo.accountAddress);

    return keylessUserInfo;
  } catch (error) {
    console.error('❌ Failed to finalize login:', error);
    throw error;
  }
}

/**
 * Get currently logged-in account
 */
export async function getKeylessAccount(): Promise<KeylessAccount | null> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ACCOUNT);
    if (!stored) return null;

    const accountData = JSON.parse(stored);
    return accountData as any;
  } catch (error) {
    console.error('Failed to get keyless account:', error);
    return null;
  }
}

/**
 * Get user info from storage
 */
export function getUserInfo(): KeylessUserInfo | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_USER_INFO);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch (error) {
    console.error('Failed to get user info:', error);
    return null;
  }
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  const userInfo = getUserInfo();
  return userInfo !== null && !!userInfo.accountAddress;
}

/**
 * Logout (clear stored data)
 */
export function logout(): void {
  console.log('👋 Logging out...');
  localStorage.removeItem(STORAGE_KEY_EKP);
  localStorage.removeItem(STORAGE_KEY_ACCOUNT);
  localStorage.removeItem(STORAGE_KEY_USER_INFO);
  console.log('✅ Logged out');
}

/**
 * Sign and submit transaction
 */
export async function signAndSubmitTransaction(
  keylessAccount: KeylessAccount,
  transaction: any
): Promise<any> {
  try {
    console.log('📝 Signing transaction...');
    const committedTxn = await aptos.signAndSubmitTransaction({
      signer: keylessAccount,
      transaction,
    });
    console.log('✅ Transaction submitted:', committedTxn.hash);
    return committedTxn;
  } catch (error) {
    console.error('❌ Transaction failed:', error);
    throw error;
  }
}

/**
 * Parse JWT token to extract user info
 */
function parseJWT(jwt: string): any {
  try {
    const base64Url = jwt.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Failed to parse JWT:', error);
    throw new Error('Invalid JWT token');
  }
}

/**
 * Store keyless account and user info
 */
async function storeKeylessAccount(
  account: KeylessAccount,
  userInfo: KeylessUserInfo
): Promise<void> {
  try {
    // Store account (simplified)
    localStorage.setItem(STORAGE_KEY_ACCOUNT, JSON.stringify({
      accountAddress: account.accountAddress.toString(),
    }));

    // Store user info
    localStorage.setItem(STORAGE_KEY_USER_INFO, JSON.stringify(userInfo));

    console.log('✅ Account and user info stored');
  } catch (error) {
    console.error('Failed to store account:', error);
    throw error;
  }
}

/**
 * Get Aptos client instance
 */
export function getAptosClient(): Aptos {
  return aptos;
}

/**
 * Clean up expired ephemeral keys
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
  } catch (error) {
    console.error('Failed to check key expiry:', error);
  }
}