import { getOAuthConfig, type OAuthConfig } from '../../src/oauth-config.js';
import { hashToken } from '../../src/oauth-crypto.js';
import { noStoreJsonResponse, oauthErrorResponse, parseFormBody } from '../../src/oauth-http.js';
import { OAuthRepository } from '../../src/oauth-repository.js';

export const runtime = 'edge';

export async function handleRevocation(
  request: Request,
  repository?: OAuthRepository,
  config: OAuthConfig = getOAuthConfig()
): Promise<Response> {
  let params: URLSearchParams;
  try {
    params = await parseFormBody(request);
  } catch (error) {
    return oauthErrorResponse('invalid_request', error instanceof Error ? error.message : 'Invalid revocation request');
  }
  const token = params.get('token');
  const clientId = params.get('client_id');
  if (!token || !clientId
    || params.getAll('token').length !== 1
    || params.getAll('client_id').length !== 1) {
    return oauthErrorResponse('invalid_request', 'token and client_id are required exactly once');
  }
  try {
    const store = repository ?? new OAuthRepository(fetch, config);
    await store.revokeGrantByToken(await hashToken(token), clientId);
  } catch {
    return oauthErrorResponse('server_error', 'TapKit could not process revocation. Please try again.', 503);
  }
  // RFC 7009 deliberately does not reveal whether the token was valid.
  return noStoreJsonResponse({}, 200);
}

export async function POST(request: Request): Promise<Response> {
  return handleRevocation(request);
}
