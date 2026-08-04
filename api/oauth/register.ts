import { getOAuthConfig, type OAuthConfig } from '../../src/oauth-config.js';
import { noStoreJsonResponse, oauthErrorResponse, parseJsonBody } from '../../src/oauth-http.js';
import { consumeRequestRateLimit, rateLimitResponse } from '../../src/oauth-rate-limit.js';
import { OAuthRepository } from '../../src/oauth-repository.js';
import {
  ClientMetadataError,
  validateClientRegistration,
} from '../../src/oauth-validation.js';
import { randomToken } from '../../src/oauth-crypto.js';

export const runtime = 'edge';

export async function handleRegistration(
  request: Request,
  repository?: OAuthRepository,
  config: OAuthConfig = getOAuthConfig()
): Promise<Response> {
  try {
    const store = repository ?? new OAuthRepository(fetch, config);
    if (!repository) {
      const rateLimit = await consumeRequestRateLimit(request, store, config, {
        bucket: 'oauth_register',
        limit: 20,
        windowSeconds: 60 * 60,
      });
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);
    }
    const metadata = await parseJsonBody(request);
    const record = validateClientRegistration(metadata, randomToken('mcp_client_', 24));
    const created = await store.createClient(record);
    const response: Record<string, unknown> = {
      client_id: created.client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: created.redirect_uris,
      grant_types: created.grant_types,
      response_types: created.response_types,
      token_endpoint_auth_method: created.token_endpoint_auth_method,
    };
    if (created.client_name) response.client_name = created.client_name;
    if (created.client_uri) response.client_uri = created.client_uri;
    if (created.logo_uri) response.logo_uri = created.logo_uri;
    return noStoreJsonResponse(response, 201);
  } catch (error) {
    if (error instanceof ClientMetadataError || error instanceof SyntaxError) {
      return oauthErrorResponse('invalid_client_metadata', error.message);
    }
    if (error instanceof Error && (
      error.message === 'Content-Type must be application/json'
      || error.message === 'Request body is too large'
    )) {
      return oauthErrorResponse('invalid_client_metadata', error.message);
    }
    return oauthErrorResponse(
      'server_error',
      'TapKit could not register the OAuth client. Please try again.',
      500
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleRegistration(request);
}
