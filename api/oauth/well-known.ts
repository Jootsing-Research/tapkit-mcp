/**
 * OAuth Authorization Server Metadata
 * RFC 8414 - OAuth 2.0 Authorization Server Metadata
 */

export const runtime = 'edge';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://mcp.tapkit.ai';

export async function GET(): Promise<Response> {
  const metadata = {
    issuer: MCP_SERVER_URL,
    authorization_endpoint: `${MCP_SERVER_URL}/oauth/authorize`,
    token_endpoint: `${MCP_SERVER_URL}/oauth/token`,
    scopes_supported: ['phone:read', 'phone:control'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], // Public client
    service_documentation: 'https://docs.tapkit.ai',
  };

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
