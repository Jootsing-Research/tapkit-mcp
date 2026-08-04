const DEFAULT_MCP_SERVER_URL = 'https://mcp.tapkit.ai';
const DEFAULT_SUPABASE_URL = 'https://dlrtwwcgdfekjcyfqfcr.supabase.co';

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function normalizedUrl(name: string, fallback: string): string {
  const value = process.env[name] || fallback;
  const url = new URL(value);
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error(`${name} must use HTTPS outside local development`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not include credentials, a query, or a fragment`);
  }
  return url.toString().replace(/\/$/, '');
}

function normalizedRootUrl(name: string, fallback: string): string {
  const value = normalizedUrl(name, fallback);
  const url = new URL(value);
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${name} must be an origin without a path`);
  }
  return url.origin;
}

export interface OAuthConfig {
  issuer: string;
  resource: string;
  protectedResourceMetadataUrl: string;
  supportUrl: string;
  privacyUrl: string;
  termsUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  encryptionKey: string;
  supabaseProvider: string;
  authorizationTtlSeconds: number;
  authorizationCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

export function getOAuthConfig(): OAuthConfig {
  const issuer = normalizedRootUrl('MCP_SERVER_URL', DEFAULT_MCP_SERVER_URL);
  const resource = normalizedUrl('MCP_RESOURCE_URL', `${issuer}/mcp`);
  const supabaseUrl = normalizedRootUrl('SUPABASE_URL', DEFAULT_SUPABASE_URL);
  if (resource !== `${issuer}/mcp`) {
    throw new Error('MCP_RESOURCE_URL must be the /mcp endpoint on MCP_SERVER_URL');
  }

  return {
    issuer,
    resource,
    protectedResourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    supportUrl: normalizedUrl('MCP_SUPPORT_URL', 'https://www.tapkit.ai/support'),
    privacyUrl: normalizedUrl('MCP_PRIVACY_URL', 'https://www.tapkit.ai/privacy'),
    termsUrl: normalizedUrl('MCP_TERMS_URL', 'https://www.tapkit.ai/terms'),
    supabaseUrl,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    encryptionKey: process.env.OAUTH_ENCRYPTION_KEY || '',
    supabaseProvider: process.env.SUPABASE_OAUTH_PROVIDER || 'google',
    authorizationTtlSeconds: positiveInteger('OAUTH_AUTHORIZATION_TTL_SECONDS', 10 * 60),
    authorizationCodeTtlSeconds: positiveInteger('OAUTH_CODE_TTL_SECONDS', 5 * 60),
    accessTokenTtlSeconds: positiveInteger('OAUTH_ACCESS_TOKEN_TTL_SECONDS', 60 * 60),
    refreshTokenTtlSeconds: positiveInteger('OAUTH_REFRESH_TOKEN_TTL_SECONDS', 30 * 24 * 60 * 60),
  };
}

export function requireOAuthSecrets(config: OAuthConfig): void {
  const missing: string[] = [];
  if (!config.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!config.supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!config.encryptionKey) missing.push('OAUTH_ENCRYPTION_KEY');
  if (missing.length > 0) {
    throw new Error(`Missing required OAuth environment variables: ${missing.join(', ')}`);
  }
}
