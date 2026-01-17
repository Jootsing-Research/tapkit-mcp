/**
 * MCP API Route for Vercel
 * Handles Streamable HTTP transport for MCP using Web Standards
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, executeTool } from '../../src/tools.js';
import { TapKitClient } from '../../src/tapkit-client.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Store active transports by session ID for stateful sessions
const sessions = new Map<string, {
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
}>();

function createMCPServer(authToken: string): Server {
  const server = new Server(
    {
      name: 'tapkit',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const tapkitClient = new TapKitClient(authToken);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return executeTool(tapkitClient, name, args || {});
  });

  return server;
}

function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  const apiKey = request.headers.get('X-API-Key');

  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (apiKey) {
    return apiKey;
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const authToken = getAuthToken(request);

  if (!authToken) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Authentication required. Please provide a Bearer token or API key.',
        },
        id: null,
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer',
        },
      }
    );
  }

  const sessionId = request.headers.get('Mcp-Session-Id');

  try {
    let transport: WebStandardStreamableHTTPServerTransport;
    let server: Server;

    if (sessionId && sessions.has(sessionId)) {
      // Reuse existing session
      const session = sessions.get(sessionId)!;
      transport = session.transport;
      server = session.server;
      // Handle the request with existing session
      return transport.handleRequest(request);
    }

    // For new sessions or lost sessions, we need to check if this is an initialize request
    // Clone the request so we can read the body without consuming it
    const clonedRequest = request.clone();
    let requestBody: { method?: string; id?: string | number | null };
    try {
      requestBody = await clonedRequest.json();
    } catch {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error: Invalid JSON',
          },
          id: null,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Create new transport and server
    // Use the existing sessionId if provided (for serverless continuity), or generate a new one
    const useSessionId = sessionId || crypto.randomUUID();

    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => useSessionId,
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { transport, server });
        // Clean up old sessions after 30 minutes
        setTimeout(() => {
          sessions.delete(newSessionId);
        }, 30 * 60 * 1000);
      },
      enableJsonResponse: true, // Allow JSON responses for simple requests
    });

    server = createMCPServer(authToken);
    await server.connect(transport);

    // If this is NOT an initialize request but we had to create a new transport
    // (serverless instance lost session state), we need to handle this specially.
    // The MCP SDK requires initialize to be called first, so we'll synthesize one.
    if (requestBody.method !== 'initialize') {

      // Create synthetic headers with required Accept types
      const syntheticHeaders = new Headers(request.headers);
      syntheticHeaders.set('Accept', 'application/json, text/event-stream');
      syntheticHeaders.set('Mcp-Session-Id', useSessionId);

      // Create a synthetic initialize request to bootstrap the server
      const initRequest = new Request(request.url, {
        method: 'POST',
        headers: syntheticHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'reconnected-client',
              version: '1.0.0',
            },
          },
          id: 'synthetic-init',
        }),
      });

      // Initialize the server first
      await transport.handleRequest(initRequest);

      // Send the 'initialized' notification (MCP protocol requirement)
      const initializedNotification = new Request(request.url, {
        method: 'POST',
        headers: syntheticHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
      await transport.handleRequest(initializedNotification);

      // Modify the original request to include the session ID
      const modifiedHeaders = new Headers(request.headers);
      modifiedHeaders.set('Mcp-Session-Id', useSessionId);
      if (!modifiedHeaders.get('Accept')?.includes('text/event-stream')) {
        modifiedHeaders.set('Accept', 'application/json, text/event-stream');
      }

      const modifiedRequest = new Request(request.url, {
        method: request.method,
        headers: modifiedHeaders,
        body: JSON.stringify(requestBody),
      });
      return transport.handleRequest(modifiedRequest);
    }

    // Handle the actual request (for initialize, it can go through directly)
    return transport.handleRequest(request);
  } catch (error) {
    console.error('MCP error:', error);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
        id: null,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const authToken = getAuthToken(request);

  if (!authToken) {
    return new Response(
      JSON.stringify({
        error: 'AUTH_REQUIRED',
        message: 'Authentication required.',
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer',
        },
      }
    );
  }

  const sessionId = request.headers.get('Mcp-Session-Id');

  if (!sessionId || !sessions.has(sessionId)) {
    return new Response(
      JSON.stringify({
        error: 'SESSION_NOT_FOUND',
        message: 'Session not found. Please initialize a new session via POST.',
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const session = sessions.get(sessionId)!;
  return session.transport.handleRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  const sessionId = request.headers.get('Mcp-Session-Id');

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.close();
    sessions.delete(sessionId);
  }

  return new Response(null, { status: 204 });
}
