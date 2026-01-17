/**
 * TapKit MCP Server - Local Entry Point
 *
 * For local development/testing with stdio transport.
 * For production, use the Vercel API routes.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMCPServer } from './mcp-server.js';

async function main() {
  const apiKey = process.env.TAPKIT_API_KEY;

  if (!apiKey) {
    console.error('Error: TAPKIT_API_KEY environment variable is required');
    console.error('Get your API key from https://tapkit.ai/dashboard');
    process.exit(1);
  }

  const server = createMCPServer(apiKey);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error('TapKit MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
