import type { OAuthConfig } from './oauth-config.js';

type FetchLike = typeof fetch;

export type SupabaseAuthOperation = 'token_exchange' | 'session_refresh' | 'user_lookup';
export type SupabaseAuthFailureReason =
  | 'network_failure'
  | 'provider_rejected'
  | 'invalid_response'
  | 'incomplete_credentials'
  | 'expired_credentials'
  | 'invalid_user';
export interface SupabaseCredentialResponseShape {
  envelope: 'top_level' | 'session' | 'data_session' | 'unknown';
  access_token: 'valid_string' | 'short_string' | 'missing_or_other';
  refresh_token: 'valid_string' | 'short_string' | 'missing_or_other';
}

export class SupabaseAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transient: boolean,
    readonly reason: SupabaseAuthFailureReason,
    readonly operation: SupabaseAuthOperation,
    readonly responseShape?: SupabaseCredentialResponseShape
  ) {
    super(message);
    this.name = 'SupabaseAuthError';
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sessionPayload(body: Record<string, unknown>): {
  payload: Record<string, unknown>;
  envelope: SupabaseCredentialResponseShape['envelope'];
} {
  if ('access_token' in body || 'refresh_token' in body) {
    return { payload: body, envelope: 'top_level' };
  }
  const directSession = recordValue(body.session);
  if (directSession) return { payload: directSession, envelope: 'session' };
  const data = recordValue(body.data);
  const nestedSession = data ? recordValue(data.session) : null;
  if (nestedSession) return { payload: nestedSession, envelope: 'data_session' };
  return { payload: body, envelope: 'unknown' };
}

function credentialFieldShape(
  value: unknown,
  minimumLength: number
): SupabaseCredentialResponseShape['access_token'] {
  if (typeof value !== 'string') return 'missing_or_other';
  return value.length >= minimumLength ? 'valid_string' : 'short_string';
}

export interface SupabaseSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
}

export function createSupabaseAuthorizationUrl(
  config: OAuthConfig,
  upstreamPkceChallenge: string
): string {
  const authorization = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
  authorization.searchParams.set('provider', config.supabaseProvider);
  authorization.searchParams.set('redirect_to', `${config.issuer}/oauth/callback`);
  authorization.searchParams.set('code_challenge', upstreamPkceChallenge);
  authorization.searchParams.set('code_challenge_method', 's256');
  return authorization.toString();
}

async function jsonRequest(
  url: string,
  config: OAuthConfig,
  init: RequestInit,
  fetchImpl: FetchLike,
  operation: SupabaseAuthOperation
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set('apikey', config.supabaseAnonKey);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${config.supabaseAnonKey}`);
    }
    headers.set('Content-Type', 'application/json');
    response = await fetchImpl(url, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SupabaseAuthError(
      'The identity provider is temporarily unavailable',
      0,
      true,
      'network_failure',
      operation
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const description = typeof data.error_description === 'string'
      ? data.error_description
      : typeof data.msg === 'string'
        ? data.msg
        : 'The identity provider rejected the request';
    const transient = response.status >= 500 || [408, 425, 429].includes(response.status);
    throw new SupabaseAuthError(
      description,
      response.status,
      transient,
      'provider_rejected',
      operation
    );
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SupabaseAuthError(
      'The identity provider returned an invalid response',
      502,
      true,
      'invalid_response',
      operation
    );
  }
  return body as Record<string, unknown>;
}

async function getUserId(
  accessToken: string,
  config: OAuthConfig,
  fetchImpl: FetchLike
): Promise<string> {
  const user = await jsonRequest(
    `${config.supabaseUrl}/auth/v1/user`,
    config,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl,
    'user_lookup'
  );
  if (typeof user.id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) {
    throw new SupabaseAuthError(
      'The identity provider did not return a valid user',
      502,
      true,
      'invalid_user',
      'user_lookup'
    );
  }
  return user.id;
}

async function parseSession(
  body: Record<string, unknown>,
  config: OAuthConfig,
  fetchImpl: FetchLike,
  operation: Exclude<SupabaseAuthOperation, 'user_lookup'>
): Promise<SupabaseSession> {
  const selected = sessionPayload(body);
  const accessToken = selected.payload.access_token;
  const refreshToken = selected.payload.refresh_token;
  if (typeof accessToken !== 'string' || accessToken.length < 20
    || typeof refreshToken !== 'string' || refreshToken.length < 12) {
    throw new SupabaseAuthError(
      'The identity provider returned incomplete credentials',
      502,
      true,
      'incomplete_credentials',
      operation,
      {
        envelope: selected.envelope,
        access_token: credentialFieldShape(accessToken, 20),
        refresh_token: credentialFieldShape(refreshToken, 12),
      }
    );
  }
  const expiresAtSeconds = typeof selected.payload.expires_at === 'number'
    ? selected.payload.expires_at
    : Math.floor(Date.now() / 1000)
      + (typeof selected.payload.expires_in === 'number' ? selected.payload.expires_in : 3600);
  if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= Math.floor(Date.now() / 1000)) {
    throw new SupabaseAuthError(
      'The identity provider returned expired credentials',
      502,
      true,
      'expired_credentials',
      operation
    );
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    userId: await getUserId(accessToken, config, fetchImpl),
  };
}

export async function exchangeSupabaseAuthorizationCode(
  code: string,
  verifier: string,
  config: OAuthConfig,
  fetchImpl: FetchLike = fetch
): Promise<SupabaseSession> {
  const body = await jsonRequest(
    `${config.supabaseUrl}/auth/v1/token?grant_type=pkce`,
    config,
    {
      method: 'POST',
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    },
    fetchImpl,
    'token_exchange'
  );
  return parseSession(body, config, fetchImpl, 'token_exchange');
}

export async function refreshSupabaseSession(
  refreshToken: string,
  config: OAuthConfig,
  fetchImpl: FetchLike = fetch
): Promise<SupabaseSession> {
  const body = await jsonRequest(
    `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
    config,
    { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) },
    fetchImpl,
    'session_refresh'
  );
  return parseSession(body, config, fetchImpl, 'session_refresh');
}
