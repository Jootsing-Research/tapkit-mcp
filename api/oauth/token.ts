/**
 * OAuth Token Endpoint
 * Exchanges authorization code for access token
 */

export const runtime = 'edge';

import { verifyCode } from '../../src/oauth-store.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dlrtwwcgdfekjcyfqfcr.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export async function POST(request: Request): Promise<Response> {
  // Parse form-encoded body (OAuth standard)
  const contentType = request.headers.get('Content-Type');

  let params: URLSearchParams;
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    params = new URLSearchParams(await request.text());
  } else if (contentType?.includes('application/json')) {
    const json = await request.json();
    params = new URLSearchParams(json as Record<string, string>);
  } else {
    return errorResponse('invalid_request', 'Content-Type must be application/x-www-form-urlencoded or application/json');
  }

  const grantType = params.get('grant_type');
  const code = params.get('code');
  const codeVerifier = params.get('code_verifier');
  const refreshToken = params.get('refresh_token');

  // Handle authorization_code grant
  if (grantType === 'authorization_code') {
    if (!code) {
      return errorResponse('invalid_request', 'Missing authorization code');
    }

    // Verify and decode the signed authorization code
    const codeData = await verifyCode(code);
    if (!codeData) {
      return errorResponse('invalid_grant', 'Invalid or expired authorization code');
    }

    // Verify PKCE code challenge if it was provided
    if (codeData.codeChallenge) {
      if (!codeVerifier) {
        return errorResponse('invalid_request', 'Missing code_verifier for PKCE');
      }

      const isValid = await verifyCodeChallenge(
        codeVerifier,
        codeData.codeChallenge,
        codeData.codeChallengeMethod || 'S256'
      );

      if (!isValid) {
        return errorResponse('invalid_grant', 'Invalid code_verifier');
      }
    }

    // Return the tokens
    return new Response(
      JSON.stringify({
        access_token: codeData.accessToken,
        token_type: 'Bearer',
        expires_in: 3600, // Supabase tokens typically last 1 hour
        refresh_token: codeData.refreshToken,
        scope: 'phone:read phone:control',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  // Handle refresh_token grant
  if (grantType === 'refresh_token') {
    if (!refreshToken) {
      return errorResponse('invalid_request', 'Missing refresh_token');
    }

    try {
      // Exchange refresh token with Supabase
      const tokenResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          refresh_token: refreshToken,
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        return errorResponse(
          'invalid_grant',
          errorData.error_description || 'Failed to refresh token'
        );
      }

      const tokens = await tokenResponse.json();

      return new Response(
        JSON.stringify({
          access_token: tokens.access_token,
          token_type: 'Bearer',
          expires_in: tokens.expires_in || 3600,
          refresh_token: tokens.refresh_token,
          scope: 'phone:read phone:control',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        }
      );
    } catch (err) {
      return errorResponse(
        'server_error',
        err instanceof Error ? err.message : 'Token refresh failed'
      );
    }
  }

  return errorResponse('unsupported_grant_type', `Grant type '${grantType}' is not supported`);
}

function errorResponse(error: string, description: string): Response {
  return new Response(
    JSON.stringify({
      error,
      error_description: description,
    }),
    {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

async function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: string
): Promise<boolean> {
  if (method === 'plain') {
    return verifier === challenge;
  }

  if (method === 'S256') {
    // SHA-256 hash the verifier
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);

    // Base64url encode
    const base64 = btoa(String.fromCharCode(...hashArray))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return base64 === challenge;
  }

  return false;
}
