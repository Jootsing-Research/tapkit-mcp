/**
 * OAuth Authorization Endpoint
 * Redirects to Supabase OAuth with Google
 */

export const runtime = 'edge';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dlrtwwcgdfekjcyfqfcr.supabase.co';
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://mcp.tapkit.ai';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Extract OAuth params from MCP client
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const scope = url.searchParams.get('scope');

  // Validate required parameters
  if (!redirectUri || !state) {
    return new Response(
      JSON.stringify({
        error: 'invalid_request',
        error_description: 'Missing required parameters: redirect_uri, state',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Store OAuth state for callback
  // In production, use a proper store like Redis or KV
  // For now, we'll encode it in the Supabase redirect
  const oauthState = {
    client_redirect_uri: redirectUri,
    client_state: state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope: scope,
  };

  const encodedState = Buffer.from(JSON.stringify(oauthState)).toString('base64url');

  // Build Supabase OAuth URL
  // Using the auth/authorize endpoint which will redirect to Google
  // IMPORTANT: Pass our state via redirect_to URL, not Supabase's state param
  // Supabase uses its own state for CSRF protection
  const callbackUrl = new URL(`${MCP_SERVER_URL}/oauth/callback`);
  callbackUrl.searchParams.set('mcp_state', encodedState);

  const supabaseAuthUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  supabaseAuthUrl.searchParams.set('provider', 'google');
  supabaseAuthUrl.searchParams.set('redirect_to', callbackUrl.toString());

  // Redirect to Supabase OAuth
  return Response.redirect(supabaseAuthUrl.toString(), 302);
}
