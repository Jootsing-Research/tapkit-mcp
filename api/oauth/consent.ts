import { getOAuthConfig, type OAuthConfig } from '../../src/oauth-config.js';
import { hashToken, randomToken } from '../../src/oauth-crypto.js';
import { oauthErrorRedirect, oauthErrorResponse, parseFormBody } from '../../src/oauth-http.js';
import { OAuthRepository } from '../../src/oauth-repository.js';

export const runtime = 'edge';

export async function handleConsent(
  request: Request,
  repository?: OAuthRepository,
  config: OAuthConfig = getOAuthConfig()
): Promise<Response> {
  let params: URLSearchParams;
  try {
    params = await parseFormBody(request);
  } catch (error) {
    return oauthErrorResponse('invalid_request', error instanceof Error ? error.message : 'Invalid form body');
  }
  const transaction = params.get('transaction');
  const consentToken = params.get('consent_token');
  const decision = params.get('decision');
  if (!transaction || !consentToken
    || params.getAll('transaction').length !== 1
    || params.getAll('consent_token').length !== 1
    || params.getAll('decision').length !== 1
    || !['approve', 'deny'].includes(decision || '')) {
    return oauthErrorResponse('invalid_request', 'The consent form is incomplete or invalid');
  }

  try {
    const store = repository ?? new OAuthRepository(fetch, config);
    const transactionHash = await hashToken(transaction);
    const consentTokenHash = await hashToken(consentToken);
    if (decision === 'deny') {
      const denied = await store.denyAuthorization(transactionHash, consentTokenHash);
      if (!denied) {
        return oauthErrorResponse('invalid_request', 'This consent request expired or was already used');
      }
      return oauthErrorRedirect(
        denied.redirect_uri,
        denied.client_state,
        'access_denied',
        'The user denied the TapKit connection.'
      );
    }

    const authorizationCode = randomToken('mcp_code_');
    const approved = await store.approveAuthorization({
      transactionHash,
      consentTokenHash,
      grantId: crypto.randomUUID(),
      codeHash: await hashToken(authorizationCode),
      codeExpiresAt: new Date(Date.now() + config.authorizationCodeTtlSeconds * 1000).toISOString(),
    });
    if (!approved) {
      return oauthErrorResponse('invalid_request', 'This consent request expired or was already used');
    }
    const target = new URL(approved.redirect_uri);
    target.searchParams.set('code', authorizationCode);
    target.searchParams.set('state', approved.client_state);
    return new Response(null, {
      status: 302,
      headers: {
        Location: target.toString(),
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch {
    return oauthErrorResponse('server_error', 'TapKit could not save consent. Please try again.', 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleConsent(request);
}
