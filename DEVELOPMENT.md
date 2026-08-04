# Development

## Local Setup

```bash
git clone https://github.com/Jootsing-Research/tapkit-mcp.git
cd tapkit-mcp
npm install
cp .env.example .env  # Add your TAPKIT_API_KEY
```

## Commands

```bash
npm run dev          # Start with hot reload (tsx watch)
npm run build        # Compile TypeScript
npm run typecheck    # Type check without emitting
npm test             # OAuth and MCP auth contract tests
```

## Local MCP Config

Configure your agent to use the stdio transport:

```json
{
  "mcpServers": {
    "tapkit": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/tapkit-mcp",
      "env": {
        "TAPKIT_API_KEY": "tk_your_key"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TAPKIT_API_KEY` | Yes (local) | Your TapKit API key (`tk_...`) |
| `TAPKIT_API_URL` | No | API base URL (default: `https://api.tapkit.ai/v1`) |
| `SUPABASE_URL` | Yes (OAuth) | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes (OAuth) | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (OAuth) | Server-only key used for the OAuth grant store |
| `OAUTH_ENCRYPTION_KEY` | Yes (OAuth) | 32-byte key used to encrypt the dedicated upstream Supabase session |
| `CRON_SECRET` | Yes (hosted) | Random 16+ character secret that authorizes Vercel's daily expired-grant cleanup job |
| `SUPABASE_OAUTH_PROVIDER` | No | Supabase social provider (default: `google`) |
| `MCP_SERVER_URL` | Yes (OAuth) | Public URL for OAuth redirects |
| `MCP_RESOURCE_URL` | No | Canonical MCP resource; must equal `${MCP_SERVER_URL}/mcp` |
| `MCP_SUPPORT_URL` | No | User support page |
| `MCP_PRIVACY_URL` | No | Privacy policy URL |
| `MCP_TERMS_URL` | No | Terms URL |

## Hosted OAuth setup

1. Apply `supabase/migrations/20260803230000_mcp_oauth.sql` to the same Supabase project used by TapKit Auth.
2. Add `https://mcp.tapkit.ai/oauth/callback` to the Supabase Auth redirect allowlist.
3. Set the server-only environment variables above in Vercel, including `CRON_SECRET`. Never expose the service-role, encryption, or cron keys to a browser bundle.
4. Deploy, then validate both protected-resource metadata URLs, dynamic client registration, login/consent, refresh rotation, revocation, and an authenticated `/mcp` tool call.

The hosted OAuth server issues opaque, MCP-specific access and refresh tokens. OpenAI never receives an ordinary TapKit/Supabase session, and the inbound MCP bearer token is never forwarded to `api.tapkit.ai`.

Vercel invokes `/api/oauth/cleanup` daily. The endpoint is fail-closed behind `CRON_SECRET`; it revokes abandoned grants and grants whose last refresh token expired, clears their encrypted upstream credentials, and later removes expired records.

Public registration, authorization, token, and MCP requests use distributed Supabase-backed rate limits. Network-derived rate-limit keys are peppered and hashed before storage, expire after two days, and never store the raw address. Dynamically registered clients that were never used are removed after seven days.
