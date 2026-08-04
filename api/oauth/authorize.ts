import { getOAuthConfig, type OAuthConfig } from '../../src/oauth-config.js';
import {
  createPkceChallenge,
  encryptSecret,
  hashToken,
  randomToken,
} from '../../src/oauth-crypto.js';
import {
  hasExactlyOne,
  oauthErrorRedirect,
  oauthErrorResponse,
} from '../../src/oauth-http.js';
import { OAuthRepository } from '../../src/oauth-repository.js';
import { consumeRequestRateLimit, rateLimitResponse } from '../../src/oauth-rate-limit.js';
import { isValidPkceChallenge } from '../../src/oauth-validation.js';
import { createSupabaseAuthorizationUrl } from '../../src/supabase-auth.js';

export const runtime = 'edge';

function redirectError(
  redirectUri: string,
  state: string,
  error: string,
  description: string
): Response {
  return oauthErrorRedirect(redirectUri, state, error, description);
}

export async function handleAuthorization(
  request: Request,
  repository?: OAuthRepository,
  config: OAuthConfig = getOAuthConfig()
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if (!hasExactlyOne(params, 'client_id') || !hasExactlyOne(params, 'redirect_uri')) {
    return oauthErrorResponse('invalid_request', 'client_id and redirect_uri are required exactly once');
  }

  const clientId = params.get('client_id')!;
  const redirectUri = params.get('redirect_uri')!;
  let client;
  let store: OAuthRepository;
  try {
    store = repository ?? new OAuthRepository(fetch, config);
    if (!repository) {
      const rateLimit = await consumeRequestRateLimit(request, store, config, {
        bucket: 'oauth_authorize',
        limit: 60,
        windowSeconds: 10 * 60,
      }, clientId);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);
    }
    client = await store.getClient(clientId);
  } catch {
    return oauthErrorResponse('server_error', 'TapKit authorization is temporarily unavailable', 500);
  }
  if (!client) {
    return oauthErrorResponse('invalid_request', 'Unknown or inactive OAuth client');
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    return oauthErrorResponse('invalid_request', 'redirect_uri is not registered for this client');
  }

  const state = params.get('state') || '';
  const fail = (error: string, description: string) =>
    redirectError(redirectUri, state, error, description);
  const required = ['state', 'response_type', 'code_challenge', 'code_challenge_method', 'resource'];
  if (required.some(name => !hasExactlyOne(params, name))) {
    return fail('invalid_request', 'A required authorization parameter is missing or repeated');
  }
  if (state.length === 0 || state.length > 2048) {
    return fail('invalid_request', 'state must be a non-empty opaque value');
  }
  if (params.get('response_type') !== 'code') {
    return fail('unsupported_response_type', 'Only response_type=code is supported');
  }
  if (params.get('code_challenge_method') !== 'S256'
    || !isValidPkceChallenge(params.get('code_challenge'))) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  }
  if (params.get('resource') !== config.resource) {
    return fail('invalid_target', `resource must be ${config.resource}`);
  }
  if (params.getAll('scope').length > 1 || (params.get('scope') || '').trim() !== '') {
    return fail('invalid_scope', 'TapKit does not define OAuth scopes; scope must be omitted or empty');
  }

  const transactionToken = randomToken('mcp_tx_');
  const transactionHash = await hashToken(transactionToken);
  const upstreamVerifier = randomToken('', 32);
  const upstreamChallenge = await createPkceChallenge(upstreamVerifier);
  try {
    await store.createAuthorization({
      transaction_hash: transactionHash,
      client_id: clientId,
      redirect_uri: redirectUri,
      client_state: state,
      resource: config.resource,
      requested_scope: '',
      code_challenge: params.get('code_challenge')!,
      code_challenge_method: 'S256',
      upstream_pkce_verifier_ciphertext: await encryptSecret(
        upstreamVerifier,
        config.encryptionKey
      ),
      status: 'pending_login',
      expires_at: new Date(Date.now() + config.authorizationTtlSeconds * 1000).toISOString(),
    });
  } catch {
    return fail('server_error', 'TapKit could not start authorization. Please try again.');
  }

  const secure = config.issuer.startsWith('https:') ? '; Secure' : '';
  const headers = new Headers({
    Location: createSupabaseAuthorizationUrl(config, upstreamChallenge),
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Set-Cookie': `tapkit_oauth_tx=${transactionToken}; Path=/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=${config.authorizationTtlSeconds}${secure}`,
  });
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request): Promise<Response> {
  return handleAuthorization(request);
}
