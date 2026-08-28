# TapKit MCP

MCP server that lets AI agents control real iPhones. Screenshot, tap, swipe, and type -- all through the [Model Context Protocol](https://modelcontextprotocol.io).

```
AI Agent  -->  MCP Protocol  -->  TapKit MCP Server  -->  TapKit API  -->  Real iPhone
```

## Getting Started

### Use a Plugin (Recommended)

The fastest way to get TapKit working with your AI agent is through an official plugin. Plugins bundle the MCP server connection *and* app-navigation skills together -- no manual setup needed.

| Agent | Plugin Repo |
|-------|-------------|
| **Claude Code / Claude Desktop** | [tapkit-plugins-claude](https://github.com/Jootsing-Research/tapkit-plugins-claude) |
| **OpenAI Codex** | [tapkit-plugins-codex](https://github.com/Jootsing-Research/tapkit-plugins-codex) |

### Use the MCP Server Directly

If your agent supports MCP but doesn't have a dedicated plugin, you can connect to the hosted server:

**Remote (hosted on Vercel):**

Add to your MCP config (`.mcp.json`, `claude_desktop_config.json`, etc.):

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

On first connection, an OAuth-capable client opens TapKit sign-in and the TapKit consent screen. The hosted connection does not use a TapKit API key; API keys are only for local development.

**Local (development):** See [Development Guide](DEVELOPMENT.md).

### Use Skills Without a Plugin

For agents that support the open [Agent Skills](https://agentskills.io) standard (Cursor, GitHub Copilot, OpenClaw, etc.), install TapKit skills separately:

```bash
npx skills add jootsing-research/skills
```

Then connect TapKit via the MCP server or CLI. See the [skills repo](https://github.com/Jootsing-Research/skills) for details.

## MCP Tools

All phone-targeting tools require a `phone_id` parameter. Call `list_phones` first to discover available phones.

All action tools (everything under Touch & Gestures and Navigation & Input, plus `unlock`) return a screenshot of the resulting screen after a short settle delay.

### Device

| Tool | Description |
|------|-------------|
| `list_phones` | List all phones with connection status, IDs, and dimensions |
| `get_phone_status` | Get real-time status (connection and dimensions) |
| `screenshot` | Take a screenshot (returned as JPEG, max 1344px long edge) |

### Touch & Gestures

| Tool | Description |
|------|-------------|
| `tap` | Tap at (x, y) coordinates |
| `double_tap` | Double tap at (x, y) -- for zooming or text selection |
| `long_press` | Long press at (x, y) -- for context menus (default 1000ms) |
| `swipe` | Fast flick gesture in a direction (up/down/left/right) |
| `drag` | Drag from one point to another -- for sliders, precise scrolling |
| `hold_and_drag` | Long press then drag -- for reordering lists, drag-and-drop |

### Navigation & Input

| Tool | Description |
|------|-------------|
| `press_home` | Press the home button |
| `type_text` | Type text into the active text field |

### Hardware

| Tool | Description |
|------|-------------|
| `lock` | Lock the screen |
| `unlock` | Unlock the screen |

## Skills

Skills are Markdown files that teach AI agents how to navigate specific iOS apps -- where buttons are, how to handle common flows, and strategies for accomplishing tasks.

The official plugin repos bundle these skills automatically. If you're using a standalone MCP setup, grab them from the [skills repo](https://github.com/Jootsing-Research/skills).

## How It Works

- **Coordinate scaling** -- Screenshots are resized to a max 1344px long edge (JPEG @ 80%) for efficient transmission. Tap coordinates are automatically translated back to native screen space.
- **Auto phone selection** -- If you have one phone, it's auto-selected. Multiple phones require passing `phone_id`.
- **OAuth-isolated** -- Hosted connections use OAuth 2.1 authorization-code PKCE with rotating, revocable MCP-specific tokens. Ordinary TapKit/Supabase sessions are never returned to the MCP client.
- **Serverless-safe** -- OAuth state is durable in Supabase and the hosted MCP transport is stateless. Requests can land on any Vercel instance without losing an in-memory MCP session or reconnecting the TapKit account.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, commands, and environment variables.

## License

MIT
