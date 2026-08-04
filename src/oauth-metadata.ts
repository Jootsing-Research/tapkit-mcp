import { getOAuthConfig, type OAuthConfig } from './oauth-config.js';

export function authorizationServerMetadata(config: OAuthConfig = getOAuthConfig()) {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    registration_endpoint: `${config.issuer}/oauth/register`,
    revocation_endpoint: `${config.issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    service_documentation: config.supportUrl,
  };
}

export function protectedResourceMetadata(config: OAuthConfig = getOAuthConfig()) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    resource_name: 'TapKit',
    resource_documentation: config.supportUrl,
    resource_policy_uri: config.privacyUrl,
    resource_tos_uri: config.termsUrl,
  };
}
