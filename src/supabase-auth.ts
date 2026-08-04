import type { OAuthConfig } from './oauth-config.js';

type FetchLike = typeof fetch;

export class SupabaseAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transient: boolean
  ) {
    super(message);
    this.name = 'SupabaseAuthError';
  }
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
  fetchImpl: FetchLike
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
    throw new SupabaseAuthError('The identity provider is temporarily unavailable', 0, true);
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
    throw new SupabaseAuthError(description, response.status, transient);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SupabaseAuthError('The identity provider returned an invalid response', 502, true);
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
    fetchImpl
  );
  if (typeof user.id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) {
    throw new SupabaseAuthError('The identity provider did not return a valid user', 502, true);
  }
  return user.id;
}

async function parseSession(
  body: Record<string, unknown>,
  config: OAuthConfig,
  fetchImpl: FetchLike
): Promise<SupabaseSession> {
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  if (typeof accessToken !== 'string' || accessToken.length < 20
    || typeof refreshToken !== 'string' || refreshToken.length < 20) {
    throw new SupabaseAuthError('The identity provider returned incomplete credentials', 502, true);
  }
  const expiresAtSeconds = typeof body.expires_at === 'number'
    ? body.expires_at
    : Math.floor(Date.now() / 1000) + (typeof body.expires_in === 'number' ? body.expires_in : 3600);
  if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= Math.floor(Date.now() / 1000)) {
    throw new SupabaseAuthError('The identity provider returned expired credentials', 502, true);
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
    fetchImpl
  );
  return parseSession(body, config, fetchImpl);
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
    fetchImpl
  );
  return parseSession(body, config, fetchImpl);
}
