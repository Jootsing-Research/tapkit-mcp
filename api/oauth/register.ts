/**
 * OAuth Dynamic Client Registration Endpoint
 * RFC 7591 - OAuth 2.0 Dynamic Client Registration
 *
 * MCP clients use this to register themselves before starting OAuth flow.
 * Since we're stateless, we generate a client_id without storing it.
 */

export const runtime = 'edge';

interface ClientRegistrationRequest {
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

interface ClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body: ClientRegistrationRequest = await request.json();

    // Validate required fields
    if (!body.redirect_uris || body.redirect_uris.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'invalid_client_metadata',
          error_description: 'redirect_uris is required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Generate a random client_id
    // In a stateless setup, we don't need to store this
    const clientId = `mcp_${crypto.randomUUID().replace(/-/g, '')}`;

    const response: ClientRegistrationResponse = {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris,
      client_name: body.client_name,
      client_uri: body.client_uri,
      logo_uri: body.logo_uri,
      scope: body.scope || 'phone:read phone:control',
      grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
      response_types: body.response_types || ['code'],
      token_endpoint_auth_method: body.token_endpoint_auth_method || 'none',
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: 'invalid_client_metadata',
        error_description: 'Invalid JSON in request body',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
