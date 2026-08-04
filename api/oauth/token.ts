import { getOAuthConfig, type OAuthConfig } from '../../src/oauth-config.js';
import {
  constantTimeEqual,
  createPkceChallenge,
  decryptSecret,
  encryptSecret,
  hashToken,
  randomToken,
} from '../../src/oauth-crypto.js';
import { oauthErrorResponse, parseFormBody, noStoreJsonResponse } from '../../src/oauth-http.js';
import { OAuthRepository } from '../../src/oauth-repository.js';
import { consumeRequestRateLimit, rateLimitResponse } from '../../src/oauth-rate-limit.js';
import type { OAuthGrantRecord, RefreshTokenClaim } from '../../src/oauth-types.js';
import { isValidPkceVerifier } from '../../src/oauth-validation.js';
import { refreshSupabaseSession, SupabaseAuthError } from '../../src/supabase-auth.js';

export const runtime = 'edge';

function requiredSingle(params: URLSearchParams, names: string[]): boolean {
  return names.every(name => params.getAll(name).length === 1 && (params.get(name) || '').length > 0);
}

function accessExpiration(grant: OAuthGrantRecord, config: OAuthConfig): Date | null {
  if (!grant.upstream_expires_at) return null;
  const upstreamExpiry = Date.parse(grant.upstream_expires_at);
  const expiresAt = Math.min(
    Date.now() + config.accessTokenTtlSeconds * 1000,
    upstreamExpiry - 60_000
  );
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 5_000
    ? new Date(expiresAt)
    : null;
}

function tokenResponse(accessToken: string, refreshToken: string, accessExpiresAt: Date): Response {
  return noStoreJsonResponse({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.max(1, Math.floor((accessExpiresAt.getTime() - Date.now()) / 1000)),
    refresh_token: refreshToken,
  });
}

async function authorizationCodeGrant(
  params: URLSearchParams,
  store: OAuthRepository,
  config: OAuthConfig
): Promise<Response> {
  if (!requiredSingle(params, ['client_id', 'code', 'code_verifier', 'redirect_uri', 'resource'])) {
    return oauthErrorResponse('invalid_request', 'client_id, code, code_verifier, redirect_uri, and resource are required exactly once');
  }
  const clientId = params.get('client_id')!;
  const redirectUri = params.get('redirect_uri')!;
  const resource = params.get('resource')!;
  const verifier = params.get('code_verifier')!;
  if (resource !== config.resource) {
    return oauthErrorResponse('invalid_target', `resource must be ${config.resource}`);
  }
  if (!isValidPkceVerifier(verifier)) {
    return oauthErrorResponse('invalid_grant', 'The PKCE code_verifier is invalid');
  }
  const client = await store.getClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return oauthErrorResponse('invalid_grant', 'The authorization code binding is invalid');
  }
  const codeHash = await hashToken(params.get('code')!);
  const code = await store.getCode(codeHash);
  if (!code
    || code.client_id !== clientId
    || code.redirect_uri !== redirectUri
    || code.resource !== resource
    || code.code_challenge_method !== 'S256'
    || Date.parse(code.expires_at) <= Date.now()) {
    return oauthErrorResponse('invalid_grant', 'The authorization code is invalid, expired, or already used');
  }
  const actualChallenge = await createPkceChallenge(verifier);
  if (!constantTimeEqual(actualChallenge, code.code_challenge)) {
    return oauthErrorResponse('invalid_grant', 'The PKCE code_verifier is invalid');
  }
  const grant = await store.getGrant(code.grant_id);
  if (!grant) {
    return oauthErrorResponse('invalid_grant', 'The TapKit authorization is no longer active');
  }
  const accessExpiresAt = accessExpiration(grant, config);
  if (!accessExpiresAt) {
    await store.revokeGrant(grant.id);
    return oauthErrorResponse('invalid_grant', 'The TapKit sign-in session expired; reconnect TapKit');
  }

  const accessToken = randomToken('mcp_at_');
  const refreshToken = randomToken('mcp_rt_');
  const exchanged = await store.exchangeAuthorizationCode({
    codeHash,
    clientId,
    redirectUri,
    resource,
    accessTokenHash: await hashToken(accessToken),
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshTokenHash: await hashToken(refreshToken),
    refreshFamilyId: crypto.randomUUID(),
    refreshExpiresAt: new Date(Date.now() + config.refreshTokenTtlSeconds * 1000).toISOString(),
  });
  if (!exchanged) {
    return oauthErrorResponse('invalid_grant', 'The authorization code is invalid, expired, or already used');
  }
  return tokenResponse(accessToken, refreshToken, accessExpiresAt);
}

function isUsableClaim(claim: RefreshTokenClaim): claim is Extract<RefreshTokenClaim, OAuthGrantRecord> {
  return claim.replayed === false && claim.busy === false && 'id' in claim;
}

async function refreshTokenGrant(
  params: URLSearchParams,
  store: OAuthRepository,
  config: OAuthConfig,
  upstreamFetch: typeof fetch
): Promise<Response> {
  if (!requiredSingle(params, ['client_id', 'refresh_token', 'resource'])) {
    return oauthErrorResponse('invalid_request', 'client_id, refresh_token, and resource are required exactly once');
  }
  const clientId = params.get('client_id')!;
  const resource = params.get('resource')!;
  if (resource !== config.resource) {
    return oauthErrorResponse('invalid_target', `resource must be ${config.resource}`);
  }
  if (!await store.getClient(clientId)) {
    return oauthErrorResponse('invalid_grant', 'The OAuth client is unknown or inactive');
  }

  const refreshToken = params.get('refresh_token')!;
  const refreshTokenHash = await hashToken(refreshToken);
  const claimId = crypto.randomUUID();
  const claim = await store.claimRefreshToken({
    refreshTokenHash,
    clientId,
    resource,
    claimId,
  });
  if (!claim) {
    return oauthErrorResponse('invalid_grant', 'The refresh token is invalid, expired, revoked, or was reused');
  }
  if (claim.replayed) {
    return oauthErrorResponse(
      'invalid_grant',
      claim.grace
        ? 'The refresh token was just rotated; use the newest token response'
        : 'The refresh token is invalid, expired, revoked, or was reused'
    );
  }
  if (claim.busy) {
    return oauthErrorResponse('temporarily_unavailable', 'A refresh is already in progress; retry shortly', 503);
  }
  if (!isUsableClaim(claim) || !claim.upstream_refresh_token_ciphertext) {
    return oauthErrorResponse('invalid_grant', 'The TapKit authorization is no longer active');
  }

  let upstreamSession;
  try {
    const upstreamRefreshToken = await decryptSecret(
      claim.upstream_refresh_token_ciphertext,
      config.encryptionKey
    );
    upstreamSession = await refreshSupabaseSession(upstreamRefreshToken, config, upstreamFetch);
  } catch (error) {
    if (error instanceof SupabaseAuthError && error.transient) {
      await store.releaseRefreshClaim({ refreshTokenHash, claimId }).catch(() => undefined);
      return oauthErrorResponse('temporarily_unavailable', 'TapKit sign-in is temporarily unavailable; retry shortly', 503);
    }
    await store.revokeGrant(claim.id).catch(() => undefined);
    return oauthErrorResponse('invalid_grant', 'The TapKit sign-in session is no longer valid; reconnect TapKit');
  }
  if (upstreamSession.userId !== claim.user_id) {
    await store.revokeGrant(claim.id).catch(() => undefined);
    return oauthErrorResponse('invalid_grant', 'The TapKit account binding changed; reconnect TapKit');
  }

  const refreshedGrant: OAuthGrantRecord = {
    ...claim,
    upstream_expires_at: upstreamSession.expiresAt,
  };
  const accessExpiresAt = accessExpiration(refreshedGrant, config);
  if (!accessExpiresAt) {
    await store.revokeGrant(claim.id).catch(() => undefined);
    return oauthErrorResponse('invalid_grant', 'The refreshed TapKit sign-in session is already expired');
  }
  const newAccessToken = randomToken('mcp_at_');
  const newRefreshToken = randomToken('mcp_rt_');
  const completed = await store.completeRefresh({
    grantId: claim.id,
    currentRefreshTokenHash: refreshTokenHash,
    refreshClaimId: claim.refresh_claim_id,
    refreshFamilyId: claim.refresh_family_id,
    refreshGeneration: claim.refresh_generation,
    newAccessTokenHash: await hashToken(newAccessToken),
    newAccessExpiresAt: accessExpiresAt.toISOString(),
    newRefreshTokenHash: await hashToken(newRefreshToken),
    newRefreshExpiresAt: new Date(Date.now() + config.refreshTokenTtlSeconds * 1000).toISOString(),
    upstreamAccessTokenCiphertext: await encryptSecret(upstreamSession.accessToken, config.encryptionKey),
    upstreamRefreshTokenCiphertext: await encryptSecret(upstreamSession.refreshToken, config.encryptionKey),
    upstreamExpiresAt: upstreamSession.expiresAt,
  });
  if (!completed) {
    return oauthErrorResponse('invalid_grant', 'The refresh token could not be rotated safely');
  }
  return tokenResponse(newAccessToken, newRefreshToken, accessExpiresAt);
}

export async function handleToken(
  request: Request,
  repository?: OAuthRepository,
  config: OAuthConfig = getOAuthConfig(),
  upstreamFetch: typeof fetch = fetch
): Promise<Response> {
  if (request.headers.has('Authorization')) {
    return oauthErrorResponse('invalid_client', 'TapKit OAuth clients are public and must use client_id in the request body');
  }
  let params: URLSearchParams;
  try {
    params = await parseFormBody(request);
  } catch (error) {
    return oauthErrorResponse('invalid_request', error instanceof Error ? error.message : 'Invalid token request');
  }
  if (params.getAll('grant_type').length !== 1) {
    return oauthErrorResponse('invalid_request', 'grant_type is required exactly once');
  }
  if (params.getAll('scope').length > 1 || (params.get('scope') || '').trim() !== '') {
    return oauthErrorResponse('invalid_scope', 'TapKit does not define OAuth scopes');
  }
  try {
    const store = repository ?? new OAuthRepository(fetch, config);
    if (!repository) {
      const rateLimit = await consumeRequestRateLimit(request, store, config, {
        bucket: 'oauth_token',
        limit: 120,
        windowSeconds: 10 * 60,
      }, params.get('client_id') || 'missing-client');
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);
    }
    if (params.get('grant_type') === 'authorization_code') {
      return await authorizationCodeGrant(params, store, config);
    }
    if (params.get('grant_type') === 'refresh_token') {
      return await refreshTokenGrant(params, store, config, upstreamFetch);
    }
    return oauthErrorResponse('unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
  } catch {
    return oauthErrorResponse('server_error', 'TapKit could not complete the token request', 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleToken(request);
}
