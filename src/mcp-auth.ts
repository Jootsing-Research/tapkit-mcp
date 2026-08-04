import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { decryptSecret, hashToken } from './oauth-crypto.js';
import { getOAuthConfig, type OAuthConfig } from './oauth-config.js';
import { OAuthRepository } from './oauth-repository.js';
import type { AuthenticatedMcpPrincipal } from './oauth-types.js';

export type McpAuthFailure = 'missing' | 'invalid';

export class McpAuthError extends Error {
  constructor(readonly failure: McpAuthFailure) {
    super(failure === 'missing' ? 'Authentication required' : 'Invalid or expired access token');
    this.name = 'McpAuthError';
  }
}

export interface McpAuthentication {
  principal: AuthenticatedMcpPrincipal;
  authInfo: AuthInfo;
}

export function bearerTokenFromRequest(request: Request): string {
  const header = request.headers.get('Authorization');
  if (!header) throw new McpAuthError('missing');
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match) throw new McpAuthError('invalid');
  return match[1];
}

export function bearerChallenge(
  failure: McpAuthFailure,
  config: OAuthConfig = getOAuthConfig()
): string {
  const base = `Bearer resource_metadata="${config.protectedResourceMetadataUrl}"`;
  return failure === 'missing'
    ? base
    : `${base}, error="invalid_token", error_description="The access token is invalid or expired."`;
}

export async function authenticateMcpRequest(
  request: Request,
  repository?: OAuthRepository,
  config: OAuthConfig = getOAuthConfig()
): Promise<McpAuthentication> {
  const accessToken = bearerTokenFromRequest(request);
  const store = repository ?? new OAuthRepository(fetch, config);
  const grant = await store.resolveAccessGrant(await hashToken(accessToken), config.resource);
  if (!grant
    || grant.resource !== config.resource
    || !grant.upstream_access_token_ciphertext
    || !grant.upstream_expires_at
    || Date.parse(grant.upstream_expires_at) <= Date.now()) {
    throw new McpAuthError('invalid');
  }

  let upstreamAccessToken: string;
  try {
    upstreamAccessToken = await decryptSecret(
      grant.upstream_access_token_ciphertext,
      config.encryptionKey
    );
  } catch {
    throw new McpAuthError('invalid');
  }

  const principal: AuthenticatedMcpPrincipal = {
    grantId: grant.id,
    userId: grant.user_id,
    clientId: grant.client_id,
    resource: grant.resource,
    scope: grant.granted_scope,
    upstreamAccessToken,
  };

  return {
    principal,
    authInfo: {
      token: accessToken,
      clientId: grant.client_id,
      scopes: [],
      resource: new URL(config.resource),
      extra: { grantId: grant.id, userId: grant.user_id },
    },
  };
}
