import { getOAuthConfig, requireOAuthSecrets, type OAuthConfig } from './oauth-config.js';
import type {
  OAuthAuthorizationRecord,
  OAuthClientRecord,
  OAuthCodeRecord,
  OAuthGrantRecord,
  RefreshTokenClaim,
} from './oauth-types.js';

export class OAuthRepositoryError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'OAuthRepositoryError';
  }
}

interface RpcAuthorizationResult {
  client_id?: string;
  redirect_uri: string;
  client_state: string;
  resource?: string;
}

type FetchLike = typeof fetch;

function firstRecord<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) || null;
  if (value && typeof value === 'object') return value as T;
  return null;
}

export class OAuthRepository {
  private readonly config: OAuthConfig;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    config: OAuthConfig = getOAuthConfig()
  ) {
    requireOAuthSecrets(config);
    this.config = config;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.config.supabaseServiceRoleKey);
    headers.set('Authorization', `Bearer ${this.config.supabaseServiceRoleKey}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await this.fetchImpl(`${this.config.supabaseUrl}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      throw new OAuthRepositoryError('OAuth storage request failed', response.status);
    }
    return body as T;
  }

  private tablePath(table: string, query = ''): string {
    return `/rest/v1/${table}${query ? `?${query}` : ''}`;
  }

  async createClient(client: OAuthClientRecord): Promise<OAuthClientRecord> {
    const body = await this.request<OAuthClientRecord[]>(this.tablePath('mcp_oauth_clients'), {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(client),
    });
    const created = firstRecord<OAuthClientRecord>(body);
    if (!created) throw new OAuthRepositoryError('OAuth client was not created', 500);
    return created;
  }

  async getClient(clientId: string): Promise<OAuthClientRecord | null> {
    const query = `client_id=eq.${encodeURIComponent(clientId)}&revoked_at=is.null&limit=1`;
    const body = await this.request<OAuthClientRecord[]>(this.tablePath('mcp_oauth_clients', query));
    return firstRecord<OAuthClientRecord>(body);
  }

  async createAuthorization(record: OAuthAuthorizationRecord): Promise<void> {
    await this.request(this.tablePath('mcp_oauth_authorizations'), {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(record),
    });
  }

  async getAuthorizationByTransactionHash(hash: string): Promise<OAuthAuthorizationRecord | null> {
    const query = `transaction_hash=eq.${encodeURIComponent(hash)}&limit=1`;
    const body = await this.request<OAuthAuthorizationRecord[]>(
      this.tablePath('mcp_oauth_authorizations', query)
    );
    return firstRecord<OAuthAuthorizationRecord>(body);
  }

  async getAuthorizationByConsentHash(hash: string): Promise<OAuthAuthorizationRecord | null> {
    const query = `consent_token_hash=eq.${encodeURIComponent(hash)}&limit=1`;
    const body = await this.request<OAuthAuthorizationRecord[]>(
      this.tablePath('mcp_oauth_authorizations', query)
    );
    return firstRecord<OAuthAuthorizationRecord>(body);
  }

  async completeLogin(
    transactionHash: string,
    patch: Pick<
      OAuthAuthorizationRecord,
      | 'user_id'
      | 'upstream_access_token_ciphertext'
      | 'upstream_refresh_token_ciphertext'
      | 'upstream_expires_at'
      | 'consent_token_hash'
    >
  ): Promise<OAuthAuthorizationRecord | null> {
    const body = await this.request<unknown>('/rest/v1/rpc/mcp_complete_authorization_login', {
      method: 'POST',
      body: JSON.stringify({
        p_transaction_hash: transactionHash,
        p_user_id: patch.user_id,
        p_upstream_access_token_ciphertext: patch.upstream_access_token_ciphertext,
        p_upstream_refresh_token_ciphertext: patch.upstream_refresh_token_ciphertext,
        p_upstream_expires_at: patch.upstream_expires_at,
        p_consent_token_hash: patch.consent_token_hash,
      }),
    });
    return firstRecord<OAuthAuthorizationRecord>(body);
  }

  async failAuthorization(transactionHash: string): Promise<void> {
    const query = `transaction_hash=eq.${encodeURIComponent(transactionHash)}&status=in.(pending_login,awaiting_consent)`;
    await this.request(this.tablePath('mcp_oauth_authorizations', query), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'failed',
        upstream_pkce_verifier_ciphertext: null,
        upstream_access_token_ciphertext: null,
        upstream_refresh_token_ciphertext: null,
        upstream_expires_at: null,
        consent_token_hash: null,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  async approveAuthorization(input: {
    transactionHash: string;
    consentTokenHash: string;
    grantId: string;
    codeHash: string;
    codeExpiresAt: string;
  }): Promise<RpcAuthorizationResult | null> {
    const body = await this.request<unknown>('/rest/v1/rpc/mcp_approve_authorization', {
      method: 'POST',
      body: JSON.stringify({
        p_transaction_hash: input.transactionHash,
        p_consent_token_hash: input.consentTokenHash,
        p_grant_id: input.grantId,
        p_code_hash: input.codeHash,
        p_code_expires_at: input.codeExpiresAt,
      }),
    });
    return firstRecord<RpcAuthorizationResult>(body);
  }

  async denyAuthorization(
    transactionHash: string,
    consentTokenHash: string
  ): Promise<RpcAuthorizationResult | null> {
    const body = await this.request<unknown>('/rest/v1/rpc/mcp_deny_authorization', {
      method: 'POST',
      body: JSON.stringify({
        p_transaction_hash: transactionHash,
        p_consent_token_hash: consentTokenHash,
      }),
    });
    return firstRecord<RpcAuthorizationResult>(body);
  }

  async getCode(codeHash: string): Promise<OAuthCodeRecord | null> {
    const query = `code_hash=eq.${encodeURIComponent(codeHash)}&consumed_at=is.null&limit=1`;
    const body = await this.request<OAuthCodeRecord[]>(this.tablePath('mcp_oauth_codes', query));
    return firstRecord<OAuthCodeRecord>(body);
  }

  async getGrant(grantId: string): Promise<OAuthGrantRecord | null> {
    const query = `id=eq.${encodeURIComponent(grantId)}&revoked_at=is.null&limit=1`;
    const body = await this.request<OAuthGrantRecord[]>(this.tablePath('mcp_oauth_grants', query));
    return firstRecord<OAuthGrantRecord>(body);
  }

  async exchangeAuthorizationCode(input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    accessTokenHash: string;
    accessExpiresAt: string;
    refreshTokenHash: string;
    refreshFamilyId: string;
    refreshExpiresAt: string;
  }): Promise<OAuthGrantRecord | null> {
    const body = await this.request<unknown>('/rest/v1/rpc/mcp_exchange_authorization_code', {
      method: 'POST',
      body: JSON.stringify({
        p_code_hash: input.codeHash,
        p_client_id: input.clientId,
        p_redirect_uri: input.redirectUri,
        p_resource: input.resource,
        p_access_token_hash: input.accessTokenHash,
        p_access_expires_at: input.accessExpiresAt,
        p_refresh_token_hash: input.refreshTokenHash,
        p_refresh_family_id: input.refreshFamilyId,
        p_refresh_expires_at: input.refreshExpiresAt,
      }),
    });
    return firstRecord<OAuthGrantRecord>(body);
  }

  async resolveAccessGrant(
    accessTokenHash: string,
    resource: string
  ): Promise<OAuthGrantRecord | null> {
    const body = await this.request<unknown>('/rest/v1/rpc/mcp_resolve_access_token', {
      method: 'POST',
      body: JSON.stringify({ p_token_hash: accessTokenHash, p_resource: resource }),
    });
    return firstRecord<OAuthGrantRecord>(body);
  }

  async claimRefreshToken(input: {
    refreshTokenHash: string;
    clientId: string;
    resource: string;
    claimId: string;
  }): Promise<RefreshTokenClaim | null> {
    const body = await this.request<unknown>('/rest/v1/rpc/mcp_claim_refresh_token', {
      method: 'POST',
      body: JSON.stringify({
        p_token_hash: input.refreshTokenHash,
        p_client_id: input.clientId,
        p_resource: input.resource,
        p_claim_id: input.claimId,
      }),
    });
    return firstRecord<RefreshTokenClaim>(body);
  }

  async completeRefresh(input: {
    grantId: string;
    currentRefreshTokenHash: string;
    refreshClaimId: string;
    refreshFamilyId: string;
    refreshGeneration: number;
    newAccessTokenHash: string;
    newAccessExpiresAt: string;
    newRefreshTokenHash: string;
    newRefreshExpiresAt: string;
    upstreamAccessTokenCiphertext: string;
    upstreamRefreshTokenCiphertext: string;
    upstreamExpiresAt: string;
  }): Promise<OAuthGrantRecord | null> {
    const body = await this.request<unknown>('/rest/v1/rpc/mcp_complete_refresh', {
      method: 'POST',
      body: JSON.stringify({
        p_grant_id: input.grantId,
        p_current_refresh_token_hash: input.currentRefreshTokenHash,
        p_refresh_claim_id: input.refreshClaimId,
        p_refresh_family_id: input.refreshFamilyId,
        p_refresh_generation: input.refreshGeneration,
        p_new_access_token_hash: input.newAccessTokenHash,
        p_new_access_expires_at: input.newAccessExpiresAt,
        p_new_refresh_token_hash: input.newRefreshTokenHash,
        p_new_refresh_expires_at: input.newRefreshExpiresAt,
        p_upstream_access_token_ciphertext: input.upstreamAccessTokenCiphertext,
        p_upstream_refresh_token_ciphertext: input.upstreamRefreshTokenCiphertext,
        p_upstream_expires_at: input.upstreamExpiresAt,
      }),
    });
    return firstRecord<OAuthGrantRecord>(body);
  }

  async releaseRefreshClaim(input: {
    refreshTokenHash: string;
    claimId: string;
  }): Promise<void> {
    await this.request('/rest/v1/rpc/mcp_release_refresh_claim', {
      method: 'POST',
      body: JSON.stringify({
        p_token_hash: input.refreshTokenHash,
        p_claim_id: input.claimId,
      }),
    });
  }

  async revokeGrant(grantId: string): Promise<void> {
    await this.request('/rest/v1/rpc/mcp_revoke_grant', {
      method: 'POST',
      body: JSON.stringify({ p_grant_id: grantId }),
    });
  }

  async revokeGrantByToken(tokenHash: string, clientId: string): Promise<boolean> {
    return this.request<boolean>('/rest/v1/rpc/mcp_revoke_grant_by_token', {
      method: 'POST',
      body: JSON.stringify({ p_token_hash: tokenHash, p_client_id: clientId }),
    });
  }

  async cleanupExpiredRecords(): Promise<void> {
    await this.request('/rest/v1/rpc/mcp_cleanup_expired_oauth_records', {
      method: 'POST',
      body: '{}',
    });
  }

  async consumeRateLimit(input: {
    bucket: string;
    keyHash: string;
    windowStart: string;
    limit: number;
  }): Promise<boolean> {
    return this.request<boolean>('/rest/v1/rpc/mcp_consume_oauth_rate_limit', {
      method: 'POST',
      body: JSON.stringify({
        p_bucket: input.bucket,
        p_key_hash: input.keyHash,
        p_window_start: input.windowStart,
        p_limit: input.limit,
      }),
    });
  }
}
