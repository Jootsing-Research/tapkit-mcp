/**
 * OAuth Callback Endpoint
 * Handles Supabase OAuth redirect and generates authorization code
 */

export const runtime = 'edge';

import { generateCode } from '../../src/oauth-store.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dlrtwwcgdfekjcyfqfcr.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Supabase returns the tokens in the URL fragment for implicit flow
  // or as query params for PKCE flow
  const accessToken = url.searchParams.get('access_token');
  const refreshToken = url.searchParams.get('refresh_token');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  const stateParam = url.searchParams.get('state');

  // Handle Supabase error
  if (error) {
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head><title>Authentication Error</title></head>
        <body>
          <h1>Authentication Error</h1>
          <p>${escapeHtml(errorDescription || error)}</p>
          <p>Please close this window and try again.</p>
        </body>
      </html>
      `,
      {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }

  // Decode the state to get original client params
  let oauthState: {
    client_redirect_uri: string;
    client_state: string;
    code_challenge?: string;
    code_challenge_method?: string;
    scope?: string;
  };

  try {
    if (!stateParam) {
      throw new Error('Missing state parameter');
    }
    oauthState = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
  } catch {
    return new Response(
      JSON.stringify({
        error: 'invalid_state',
        error_description: 'Invalid or missing state parameter',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // If we have tokens directly (from query params), generate auth code
  if (accessToken) {
    return await handleTokens(
      accessToken,
      refreshToken || '',
      oauthState
    );
  }

  // If Supabase redirects with a code (PKCE flow), exchange it
  const supabaseCode = url.searchParams.get('code');
  if (supabaseCode) {
    try {
      // Exchange Supabase code for tokens
      const tokenResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=authorization_code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          code: supabaseCode,
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        throw new Error(errorData.error_description || 'Token exchange failed');
      }

      const tokens = await tokenResponse.json();

      return await handleTokens(
        tokens.access_token,
        tokens.refresh_token || '',
        oauthState
      );
    } catch (err) {
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head><title>Authentication Error</title></head>
          <body>
            <h1>Authentication Error</h1>
            <p>${escapeHtml(err instanceof Error ? err.message : 'Token exchange failed')}</p>
            <p>Please close this window and try again.</p>
          </body>
        </html>
        `,
        {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }
  }

  // If we get here with no tokens and no code, show a page that extracts from fragment
  // (Supabase sometimes returns tokens in the URL fragment for implicit flow)
  return new Response(
    `
    <!DOCTYPE html>
    <html>
      <head>
        <title>TapKit - Completing Authentication</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 40px; text-align: center; }
          .spinner { animation: spin 1s linear infinite; }
          @keyframes spin { 100% { transform: rotate(360deg); } }
        </style>
        <script>
          // Extract tokens from URL fragment if present
          const hash = window.location.hash.substring(1);
          if (hash) {
            const params = new URLSearchParams(hash);
            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');

            if (accessToken) {
              // Redirect to self with tokens as query params
              const url = new URL(window.location.href);
              url.hash = '';
              url.searchParams.set('access_token', accessToken);
              if (refreshToken) {
                url.searchParams.set('refresh_token', refreshToken);
              }
              window.location.href = url.toString();
            } else {
              document.body.innerHTML = '<h1>Authentication Error</h1><p>No access token received.</p>';
            }
          } else {
            document.body.innerHTML = '<h1>Authentication Error</h1><p>No authentication data received. Please try again.</p>';
          }
        </script>
      </head>
      <body>
        <h1>Completing authentication...</h1>
        <p class="spinner">⏳</p>
        <p>Please wait while we complete the sign-in process.</p>
      </body>
    </html>
    `,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }
  );
}

async function handleTokens(
  accessToken: string,
  refreshToken: string,
  oauthState: {
    client_redirect_uri: string;
    client_state: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }
): Promise<Response> {
  // Generate a signed authorization code containing the tokens
  const authCode = await generateCode({
    accessToken,
    refreshToken,
    codeChallenge: oauthState.code_challenge,
    codeChallengeMethod: oauthState.code_challenge_method,
  });

  // Redirect back to the MCP client with the authorization code
  const redirectUrl = new URL(oauthState.client_redirect_uri);
  redirectUrl.searchParams.set('code', authCode);
  redirectUrl.searchParams.set('state', oauthState.client_state);

  return Response.redirect(redirectUrl.toString(), 302);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
