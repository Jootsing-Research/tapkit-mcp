import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  authenticateMcpRequest,
  bearerChallenge,
  bearerTokenFromRequest,
  McpAuthError,
  type McpAuthentication,
} from '../../src/mcp-auth.js';
import { getOAuthConfig } from '../../src/oauth-config.js';
import { consumeRequestRateLimit } from '../../src/oauth-rate-limit.js';
import { OAuthRepository } from '../../src/oauth-repository.js';
import { TapKitClient } from '../../src/tapkit-client.js';
import { executeTool, toolDefinitions } from '../../src/tools.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const OAUTH_SECURITY_SCHEMES = [{ type: 'oauth2' as const, scopes: [] as string[] }];

export function remoteToolDescriptors() {
  return toolDefinitions.map(tool => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
  }));
}

export function createServer(client: TapKitClient): Server {
  const server = new Server(
    { name: 'tapkit', version: '1.3.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: remoteToolDescriptors(),
  }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    return executeTool(client, name, args || {});
  });
  return server;
}

function authFailureResponse(request: Request, error: McpAuthError): Response {
  const postBody = {
    jsonrpc: '2.0',
    error: { code: -32001, message: error.message },
    id: null,
  };
  const otherBody = { error: 'UNAUTHORIZED', message: error.message };
  return new Response(JSON.stringify(request.method === 'POST' ? postBody : otherBody), {
    status: 401,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'WWW-Authenticate': bearerChallenge(error.failure),
    },
  });
}

async function authenticate(request: Request): Promise<McpAuthentication | Response> {
  try {
    // Parse the bearer before constructing storage so missing/invalid credentials
    // always receive the required 401 challenge, even during a storage outage.
    bearerTokenFromRequest(request);
    const config = getOAuthConfig();
    const repository = new OAuthRepository(fetch, config);
    const authentication = await authenticateMcpRequest(request, repository, config);
    const rateLimit = await consumeRequestRateLimit(request, repository, config, {
      bucket: 'mcp_request',
      limit: 300,
      windowSeconds: 60,
    }, authentication.principal.grantId);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32002, message: 'Too many MCP requests. Wait briefly and try again.' },
        id: null,
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      });
    }
    return authentication;
  } catch (error) {
    if (error instanceof McpAuthError) return authFailureResponse(request, error);
    return new Response(JSON.stringify({ error: 'AUTH_SERVICE_UNAVAILABLE' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
}

function mcpErrorResponse(status: number, message: string, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export async function handleAuthenticatedPost(
  request: Request,
  authentication: McpAuthentication
): Promise<Response> {
  const client = new TapKitClient(authentication.principal.upstreamAccessToken);
  const server = createServer(client);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { authInfo: authentication.authInfo });
  } catch {
    await transport.close().catch(() => undefined);
    return mcpErrorResponse(500, 'TapKit could not handle the MCP request.');
  }
}

export async function POST(request: Request): Promise<Response> {
  const authentication = await authenticate(request);
  if (authentication instanceof Response) return authentication;
  return handleAuthenticatedPost(request, authentication);
}

async function methodNotAllowed(request: Request): Promise<Response> {
  const authentication = await authenticate(request);
  if (authentication instanceof Response) return authentication;
  return mcpErrorResponse(405, 'Method not allowed. This stateless MCP endpoint accepts POST.', {
    Allow: 'POST',
  });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
