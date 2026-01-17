# TapKit MCP Server - Implementation Plan

## Overview

Build an MCP (Model Context Protocol) server that enables Claude and Claude Code to control real iOS devices through TapKit's API, deployed at `mcp.tapkit.ai`. This is analogous to "Claude in Chrome" but for iOS devices.

## Goals

1. **Claude Code Integration**: Allow Claude Code to seamlessly control iOS devices during development workflows
2. **Vercel Deployment**: Deploy as a serverless MCP server at `mcp.tapkit.ai`
3. **Full TapKit API Coverage**: Expose all TapKit capabilities as MCP tools
4. **Developer Experience**: "Just works" when connected - Claude can naturally use iOS when needed

---

## Architecture

```
┌─────────────────────┐       ┌─────────────────────┐       ┌─────────────────────┐
│                     │       │                     │       │                     │
│   Claude / Claude   │──MCP──│   TapKit MCP Server │──REST─│   TapKit API        │
│   Code              │       │   (mcp.tapkit.ai)   │       │   (api.tapkit.ai)   │
│                     │       │                     │       │                     │
└─────────────────────┘       └─────────────────────┘       └─────────────────────┘
                                       │
                                       │
                              ┌────────▼────────┐
                              │   Real iPhones   │
                              │   via TapKit     │
                              └─────────────────┘
```

### Transport Options

The MCP spec supports multiple transports:

1. **Streamable HTTP (Primary)** - Best for Vercel deployment
   - POST to `/mcp` endpoint
   - SSE for streaming responses
   - Stateless, serverless-compatible

2. **SSE Transport (Fallback)** - For clients that don't support Streamable HTTP
   - GET `/sse` for event stream
   - POST `/messages` for requests

---

## MCP Tools to Expose

### Core Device Tools

| Tool | Description | TapKit Endpoint |
|------|-------------|-----------------|
| `list_phones` | List available iOS devices | `GET /phones` |
| `get_phone` | Get details about a specific phone | `GET /phones/{id}` |
| `screenshot` | Capture device screen (auto-compressed for LLM) | `GET /phones/{id}/screenshot` |

### Touch Gestures

| Tool | Description | TapKit Endpoint |
|------|-------------|-----------------|
| `tap` | Tap at coordinates (x, y) | `POST /phones/{id}/tap` |
| `tap_element` | Tap element by natural language description | `POST /phones/{id}/tap/select` |
| `double_tap` | Double tap at coordinates | `POST /phones/{id}/double-tap` |
| `long_press` | Long press at coordinates | `POST /phones/{id}/tap-and-hold` |
| `swipe` | Swipe in a direction | `POST /phones/{id}/flick` |
| `scroll` | Scroll/pan on screen | `POST /phones/{id}/pan` |
| `drag` | Drag from point A to B | `POST /phones/{id}/drag` |
| `pinch` | Pinch gesture (zoom in/out) | `POST /phones/{id}/pinch` |

### Device Actions

| Tool | Description | TapKit Endpoint |
|------|-------------|-----------------|
| `press_home` | Press home button / swipe home | `POST /phones/{id}/home` |
| `lock` | Lock the device | `POST /phones/{id}/lock` |
| `unlock` | Unlock the device | `POST /phones/{id}/unlock` |
| `volume_up` | Increase volume | `POST /phones/{id}/volume-up` |
| `volume_down` | Decrease volume | `POST /phones/{id}/volume-down` |
| `rotate` | Rotate device orientation | `POST /phones/{id}/rotate` |

### App Control

| Tool | Description | TapKit Endpoint |
|------|-------------|-----------------|
| `open_app` | Launch an app by name or bundle ID | `POST /phones/{id}/open-app` |
| `type_text` | Type text into active field | `POST /phones/{id}/type` |
| `run_shortcut` | Execute an iOS Shortcut | `POST /phones/{id}/run-shortcut` |
| `open_url` | Open a URL on device | `POST /phones/{id}/open-url` |
| `spotlight_search` | Open Spotlight and search | `POST /phones/{id}/spotlight` |
| `activate_siri` | Activate Siri | `POST /phones/{id}/siri` |

---

## Authentication Strategy

### Current State Analysis

TapKit's auth is handled by **Supabase** (external OAuth provider). The API accepts:
- `Authorization: Bearer <supabase_jwt>` - from web app sessions
- `X-API-Key: tk_xxxxx` - from dashboard-generated API keys

**No OAuth endpoints exist** on jootsing-server currently. To support MCP's OAuth 2.1 flow, we need to build them.

---

### Phase 1: API Key Auth (Ship Fast)

For immediate deployment, use API key authentication:

```bash
# User gets API key from TapKit dashboard
export TAPKIT_API_KEY=tk_xxxxxxxxxxxxx
```

**MCP Client Config:**
```json
{
  "mcpServers": {
    "tapkit": {
      "type": "url",
      "url": "https://mcp.tapkit.ai/mcp",
      "headers": {
        "X-API-Key": "${TAPKIT_API_KEY}"
      }
    }
  }
}
```

The MCP server passes the API key through to TapKit API.

**Pros:** Works immediately, no backend changes needed
**Cons:** User must manually copy API key from dashboard

---

### Phase 3: MCP OAuth 2.1 (Better UX)

Add proper OAuth endpoints to enable seamless "Connect with TapKit" flow.

**New endpoints needed on jootsing-server (or mcp.tapkit.ai):**

| Endpoint | Purpose |
|----------|---------|
| `GET /oauth/authorize` | Authorization endpoint - redirects to Supabase OAuth |
| `POST /oauth/token` | Token endpoint - exchanges code for JWT/API key |
| `GET /.well-known/oauth-authorization-server` | OAuth metadata discovery |

**Flow:**
```
1. MCP client → GET mcp.tapkit.ai/mcp (no auth)
2. Server → 401 Unauthorized
3. Client discovers → GET mcp.tapkit.ai/.well-known/oauth-authorization-server
4. Client redirects user → GET mcp.tapkit.ai/oauth/authorize
   → Redirects to Supabase Google OAuth
5. User authorizes → Callback to mcp.tapkit.ai/oauth/callback
6. Server exchanges code → Gets Supabase JWT
7. Server issues MCP token → POST /oauth/token returns access_token
8. Client includes token → Authorization: Bearer <token>
9. MCP server validates & proxies to TapKit API
```

**OAuth Metadata (`/.well-known/oauth-authorization-server`):**
```json
{
  "issuer": "https://mcp.tapkit.ai",
  "authorization_endpoint": "https://mcp.tapkit.ai/oauth/authorize",
  "token_endpoint": "https://mcp.tapkit.ai/oauth/token",
  "scopes_supported": ["phone:read", "phone:control"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"]
}
```

**Implementation Options:**

1. **Add to jootsing-server** - OAuth endpoints in FastAPI, reuse Supabase client
2. **Build on mcp.tapkit.ai** - Standalone OAuth proxy in the Vercel deployment
3. **Use Supabase directly** - If Supabase exposes compatible endpoints (needs research)

**Recommendation:** Build OAuth proxy on mcp.tapkit.ai (Vercel) to keep MCP concerns isolated.

---

## Deployment Strategy

### Vercel Deployment

```
tapkit-mcp/
├── api/
│   └── mcp/
│       └── route.ts      # Streamable HTTP MCP endpoint
├── src/
│   ├── server.ts         # MCP server implementation
│   ├── tools/            # Tool implementations
│   │   ├── device.ts
│   │   ├── gestures.ts
│   │   ├── apps.ts
│   │   └── index.ts
│   ├── tapkit-client.ts  # TapKit API wrapper
│   └── utils/
│       └── image.ts      # Screenshot compression
├── vercel.json
├── package.json
└── tsconfig.json
```

### Vercel Configuration

```json
{
  "functions": {
    "api/mcp/**": {
      "maxDuration": 60
    }
  }
}
```

### Domain Setup

- Deploy to Vercel
- Configure `mcp.tapkit.ai` as custom domain
- SSL handled automatically by Vercel

---

## Screenshot Handling

Following computer-use best practices:

1. **Capture**: Get raw screenshot from TapKit (PNG)
2. **Resize**: Scale to optimal resolution for LLM (e.g., 1024x768 equivalent aspect ratio)
3. **Compress**: Convert to JPEG with quality optimization
4. **Return**: Base64 encoded image in MCP response

```typescript
async function getScreenshot(phoneId: string): Promise<string> {
  const rawPng = await tapkit.screenshot(phoneId);
  const optimized = await optimizeForLLM(rawPng, {
    maxWidth: 1024,
    maxHeight: 1024,
    quality: 80
  });
  return optimized.toString('base64');
}
```

---

## Claude Code Integration

### Remote Server (Recommended)

Users add to their Claude Code MCP config:

```json
{
  "mcpServers": {
    "tapkit": {
      "type": "url",
      "url": "https://mcp.tapkit.ai/mcp"
    }
  }
}
```

**OAuth flow happens automatically:**
1. Claude Code connects to `mcp.tapkit.ai`
2. Server returns 401 → Claude Code discovers OAuth endpoints
3. User is prompted to authorize in browser (TapKit dashboard)
4. Token is stored and used for future requests

### Local Development

For running locally with API key:

```json
{
  "mcpServers": {
    "tapkit": {
      "command": "node",
      "args": ["./dist/server.js"],
      "env": {
        "TAPKIT_API_KEY": "${TAPKIT_API_KEY}"
      }
    }
  }
}
```

---

## Implementation Phases

### Phase 1: Core MCP Server + OAuth (Launch Ready)
- [ ] Initialize TypeScript project with MCP SDK
- [ ] Implement TapKit API client wrapper
- [ ] Create MCP server with Streamable HTTP transport for Vercel
- [ ] Implement core tools: `screenshot`, `tap`, `tap_element`, `type_text`, `press_home`, `open_app`
- [ ] Auto-select single phone (no multi-phone logic)
- [ ] **OAuth endpoints on mcp.tapkit.ai:**
  - `GET /.well-known/oauth-authorization-server` - metadata discovery
  - `GET /oauth/authorize` - redirects to Supabase OAuth
  - `GET /oauth/callback` - handles Supabase redirect, exchanges code for JWT
  - `POST /oauth/token` - token exchange endpoint for MCP clients
- [ ] PKCE support (required for public clients)
- [ ] Bearer token auth → pass JWT to TapKit API
- [ ] Deploy to Vercel at `mcp.tapkit.ai`
- [ ] Test full OAuth flow with Claude Desktop/Claude Code

**Deliverable:** Production-ready MCP server with seamless OAuth login

### Phase 2: Full Tool Coverage + Polish
- [ ] Implement all gesture tools (swipe, scroll, pinch, long_press, double_tap)
- [ ] Implement all device action tools (lock, unlock, volume, rotate)
- [ ] Implement remaining app control tools (shortcuts, Siri, Spotlight, open_url)
- [ ] Add screenshot optimization (resize + compress for LLM)
- [ ] Comprehensive error handling with friendly messages
- [ ] Write user documentation

**Deliverable:** Full-featured MCP server with all TapKit capabilities

### Phase 3: Future Enhancements
- [ ] Multi-phone support (if needed)
- [ ] Real-time screen streaming
- [ ] Usage analytics
- [ ] NPM package for local installs
- [ ] API key fallback for programmatic access

---

## Technical Considerations

### Timeouts

TapKit operations can take time (especially `tap_element` with vision). Configure:
- Vercel function timeout: 60s
- TapKit API timeout: 30s default, with async fallback

### Error Handling

Map TapKit errors to meaningful MCP error responses:
- `PHONE_NOT_FOUND` → "No phone connected. Ensure TapKit desktop app is running."
- `MAC_APP_NOT_RUNNING` → "TapKit companion app is offline."
- `TIMEOUT` → "Operation timed out. The app may be unresponsive."

### Phone Selection

**Single phone only for v1.** Auto-select the first (and only) connected phone. Multi-phone support can be added later if needed.

---

## Example Workflows

### Mobile App Testing
```
User: "Test the login flow on my iPhone - try logging in with test@example.com"

Claude:
1. screenshot() - See current state
2. open_app("MyApp") - Launch the app
3. screenshot() - Confirm app opened
4. tap_element("Email field") - Focus email input
5. type_text("test@example.com")
6. tap_element("Password field")
7. type_text("testpass123")
8. tap_element("Login button")
9. screenshot() - Verify login success
```

### Quick Actions
```
User: "Send a text to mom saying I'll be home late"

Claude:
1. open_app("Messages")
2. tap_element("Compose new message")
3. type_text("Mom")
4. tap_element("Mom contact")
5. tap_element("Message field")
6. type_text("I'll be home late")
7. tap_element("Send button")
8. screenshot() - Confirm sent
```

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "sharp": "^0.33.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "vercel": "latest"
  }
}
```

---

## Open Questions

1. ~~**Agentic API**~~ → **Decision: No.** Let Claude handle the loop itself. Can revisit later.

2. ~~**Multi-phone UX**~~ → **Decision: Single phone only for v1.** Auto-select first connected phone.

3. ~~**OAuth Endpoints**~~ → **Finding: None exist.** Auth is via Supabase. Need to build OAuth proxy for MCP.

4. ~~**JWT Validation**~~ → **Finding: Yes.** TapKit API accepts Supabase JWTs directly via `Authorization: Bearer`.

5. **OAuth Implementation Priority**: Should OAuth be Phase 3 or pushed to Phase 1?
   - Phase 1 (API key) ships faster but requires manual key copy
   - OAuth is better UX but requires building proxy endpoints

6. **Supabase OAuth Compatibility**: Can we redirect MCP clients directly to Supabase's OAuth and intercept the callback? Needs research.

---

## Next Steps

1. **Confirm plan** - Review this with stakeholders
2. **Start Phase 1** - Initialize project and implement core tools
3. **Test locally** - Verify with Claude Code before deploying
4. **Deploy** - Push to Vercel and configure domain
