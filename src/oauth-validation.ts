import type { OAuthClientRecord } from './oauth-types.js';

export class ClientMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientMetadataError';
  }
}

interface ClientRegistrationInput {
  redirect_uris?: unknown;
  client_name?: unknown;
  client_uri?: unknown;
  logo_uri?: unknown;
  scope?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  token_endpoint_auth_method?: unknown;
}

function optionalBoundedString(
  value: unknown,
  name: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ClientMetadataError(`${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ClientMetadataError(`${name} contains unsupported control characters`);
  }
  return value;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]';
}

function isCursorRedirectUri(value: string, url: URL): boolean {
  return /^cursor(?:-nightly)?:$/.test(url.protocol)
    && url.host === 'anysphere.cursor-mcp'
    && url.pathname === '/oauth/callback'
    && url.search === ''
    && !value.includes('?')
    && value === url.href;
}

export function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || value.includes('#')) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') return isLoopback(url.hostname);
    return isCursorRedirectUri(value, url);
  } catch {
    return false;
  }
}

function validateDisplayUrl(value: string | null, name: string): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new ClientMetadataError(`${name} must be an HTTPS URL without credentials or a fragment`);
  }
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string')) {
    throw new ClientMetadataError(`${name} must be a non-empty array of strings`);
  }
  return value as string[];
}

export function validateClientRegistration(
  input: unknown,
  clientId: string
): OAuthClientRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ClientMetadataError('Client metadata must be a JSON object');
  }
  const metadata = input as ClientRegistrationInput;
  const redirectUris = stringArray(metadata.redirect_uris, 'redirect_uris');
  if (redirectUris.length > 10) {
    throw new ClientMetadataError('redirect_uris may contain at most 10 entries');
  }
  if (new Set(redirectUris).size !== redirectUris.length) {
    throw new ClientMetadataError('redirect_uris must not contain duplicates');
  }
  if (redirectUris.some(uri => uri.length > 2048 || !isSafeRedirectUri(uri))) {
    throw new ClientMetadataError(
      'Each redirect URI must use HTTPS, loopback HTTP, or an approved native-app callback and must not contain credentials or a fragment'
    );
  }

  if (metadata.scope !== undefined && metadata.scope !== '') {
    throw new ClientMetadataError('TapKit does not define OAuth scopes; scope must be omitted or empty');
  }

  const grantTypes = metadata.grant_types === undefined
    ? ['authorization_code', 'refresh_token']
    : stringArray(metadata.grant_types, 'grant_types');
  if (new Set(grantTypes).size !== 2
    || !grantTypes.includes('authorization_code')
    || !grantTypes.includes('refresh_token')) {
    throw new ClientMetadataError('grant_types must contain authorization_code and refresh_token exactly once');
  }

  const responseTypes = metadata.response_types === undefined
    ? ['code']
    : stringArray(metadata.response_types, 'response_types');
  if (responseTypes.length !== 1 || responseTypes[0] !== 'code') {
    throw new ClientMetadataError('response_types must be ["code"]');
  }

  const authMethod = metadata.token_endpoint_auth_method ?? 'none';
  if (authMethod !== 'none') {
    throw new ClientMetadataError('token_endpoint_auth_method must be none');
  }

  return {
    client_id: clientId,
    redirect_uris: redirectUris,
    client_name: optionalBoundedString(metadata.client_name, 'client_name', 200),
    client_uri: validateDisplayUrl(
      optionalBoundedString(metadata.client_uri, 'client_uri', 2048),
      'client_uri'
    ),
    logo_uri: validateDisplayUrl(
      optionalBoundedString(metadata.logo_uri, 'logo_uri', 2048),
      'logo_uri'
    ),
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
}

export function isValidPkceChallenge(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isValidPkceVerifier(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}
