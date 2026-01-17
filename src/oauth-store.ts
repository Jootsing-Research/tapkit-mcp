/**
 * OAuth Code Store
 *
 * Stores authorization codes temporarily for the OAuth flow.
 *
 * NOTE: This in-memory implementation works for development but NOT for production
 * Vercel Edge functions on serverless. For production, use Vercel KV:
 *
 * ```
 * import { kv } from '@vercel/kv';
 * ```
 *
 * For now, we'll use a simple approach that stores the tokens directly
 * in the authorization code (signed/encrypted).
 */

const SIGNING_SECRET = process.env.OAUTH_SIGNING_SECRET || 'dev-secret-change-in-production';

interface CodePayload {
  accessToken: string;
  refreshToken: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  createdAt: number;
}

/**
 * Generate an authorization code that contains the encrypted token data
 * This allows stateless operation without needing shared storage
 */
export async function generateCode(payload: Omit<CodePayload, 'createdAt'>): Promise<string> {
  const data: CodePayload = {
    ...payload,
    createdAt: Date.now(),
  };

  // For edge runtime, we use SubtleCrypto
  const encoder = new TextEncoder();
  const keyData = encoder.encode(SIGNING_SECRET);

  // Import the key for HMAC
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Encode the payload
  const payloadJson = JSON.stringify(data);
  const payloadBase64 = btoa(payloadJson);

  // Sign it
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payloadBase64)
  );

  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  // Return payload.signature format (both base64url encoded)
  return `${base64ToBase64Url(payloadBase64)}.${base64ToBase64Url(signatureBase64)}`;
}

/**
 * Verify and decode an authorization code
 */
export async function verifyCode(code: string): Promise<CodePayload | null> {
  try {
    const [payloadBase64Url, signatureBase64Url] = code.split('.');
    if (!payloadBase64Url || !signatureBase64Url) {
      return null;
    }

    const payloadBase64 = base64UrlToBase64(payloadBase64Url);
    const signatureBase64 = base64UrlToBase64(signatureBase64Url);

    const encoder = new TextEncoder();
    const keyData = encoder.encode(SIGNING_SECRET);

    // Import the key
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Verify signature
    const signatureBytes = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(payloadBase64)
    );

    if (!isValid) {
      return null;
    }

    // Decode payload
    const payloadJson = atob(payloadBase64);
    const payload: CodePayload = JSON.parse(payloadJson);

    // Check expiry (10 minutes)
    if (Date.now() - payload.createdAt > 10 * 60 * 1000) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBase64(base64Url: string): string {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  return base64;
}
