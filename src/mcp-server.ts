/**
 * TapKit MCP Server
 * Handles MCP protocol for iOS device control
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, executeTool } from './tools.js';
import { TapKitClient } from './tapkit-client.js';

export function createMCPServer(authToken: string): Server {
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

  // Create TapKit client with auth token
  const tapkitClient = new TapKitClient(authToken);

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return executeTool(tapkitClient, name, args || {});
  });

  return server;
}

/**
 * Server info for MCP discovery
 */
export const serverInfo = {
  name: 'tapkit',
  version: '1.0.0',
  description: 'Control iOS devices through TapKit',
  vendor: 'TapKit',
  homepage: 'https://tapkit.ai',
};
