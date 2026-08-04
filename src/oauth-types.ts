export type AuthorizationStatus =
  | 'pending_login'
  | 'awaiting_consent'
  | 'approved'
  | 'denied'
  | 'failed';

export interface OAuthClientRecord {
  client_id: string;
  redirect_uris: string[];
  client_name: string | null;
  client_uri: string | null;
  logo_uri: string | null;
  token_endpoint_auth_method: 'none';
  grant_types: string[];
  response_types: string[];
  created_at?: string;
  revoked_at?: string | null;
}

export interface OAuthAuthorizationRecord {
  transaction_hash: string;
  client_id: string;
  redirect_uri: string;
  client_state: string;
  resource: string;
  requested_scope: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  upstream_pkce_verifier_ciphertext: string | null;
  user_id?: string | null;
  upstream_access_token_ciphertext?: string | null;
  upstream_refresh_token_ciphertext?: string | null;
  upstream_expires_at?: string | null;
  consent_token_hash?: string | null;
  status: AuthorizationStatus;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
}

export interface OAuthCodeRecord {
  code_hash: string;
  grant_id: string;
  client_id: string;
  redirect_uri: string;
  resource: string;
  requested_scope: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  expires_at: string;
  consumed_at?: string | null;
  created_at?: string;
}

export interface OAuthGrantRecord {
  id: string;
  user_id: string;
  client_id: string;
  resource: string;
  granted_scope: string;
  upstream_access_token_ciphertext: string | null;
  upstream_refresh_token_ciphertext: string | null;
  upstream_expires_at: string | null;
  revoked_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type RefreshTokenClaim =
  | { replayed: true; busy: false; grace: boolean }
  | { replayed: false; busy: true }
  | (OAuthGrantRecord & {
      replayed: false;
      busy: false;
      refresh_family_id: string;
      refresh_generation: number;
      refresh_claim_id: string;
    });

export interface AuthenticatedMcpPrincipal {
  grantId: string;
  userId: string;
  clientId: string;
  resource: string;
  scope: string;
  upstreamAccessToken: string;
}
