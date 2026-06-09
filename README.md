# TapKit MCP

MCP server that lets AI agents control real iPhones. Screenshot, tap, swipe, type, open apps -- all through the [Model Context Protocol](https://modelcontextprotocol.io).

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

**Local (development):** See [Development Guide](DEVELOPMENT.md).

### Use Skills Without a Plugin

For agents that support the open [Agent Skills](https://agentskills.io) standard (Cursor, GitHub Copilot, OpenClaw, etc.), install TapKit skills separately:

```bash
npx skills add jootsing-research/skills
```

Then connect TapKit via the MCP server or CLI. See the [skills repo](https://github.com/Jootsing-Research/skills) for details.

## MCP Tools

All tools require a `phone_id` parameter. Call `list_phones` first to discover available phones.

### Device

| Tool | Description |
|------|-------------|
| `list_phones` | List all phones with connection status, IDs, and dimensions |
| `get_phone_status` | Get real-time status (connection, Switch Control, screen lock, streaming) |
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
| `pinch` | Pinch in/out or rotate at (x, y) |

### Navigation & Input

| Tool | Description |
|------|-------------|
| `press_home` | Press the home button |
| `open_app` | Open an app by name or bundle ID |
| `open_url` | Open a URL via the Shortcut action queue |
| `spotlight` | Open Spotlight search, optionally with a query |
| `escape` | Dismiss keyboards, alerts, popups, or modal screens |
| `copy_text_to_phone` | Load text into the phone's clipboard for pasting |
| `get_clipboard_text_from_phone` | Read text from the phone's clipboard |
| `activate_siri` | Activate Siri |
| `run_shortcut` | Run an iOS Shortcut by index |

### Hardware

| Tool | Description |
|------|-------------|
| `lock` | Lock the screen |
| `unlock` | Unlock the screen |
| `volume_up` | Increase volume |
| `volume_down` | Decrease volume |

## Skills

Skills are Markdown files that teach AI agents how to navigate specific iOS apps -- where buttons are, how to handle common flows, and strategies for accomplishing tasks.

The official plugin repos bundle these skills automatically. If you're using a standalone MCP setup, grab them from the [skills repo](https://github.com/Jootsing-Research/skills).

## How It Works

- **Coordinate scaling** -- Screenshots are resized to a max 1344px long edge (JPEG @ 80%) for efficient transmission. Tap coordinates are automatically translated back to native screen space.
- **Auto phone selection** -- If you have one phone, it's auto-selected. Multiple phones require passing `phone_id`.
- **Serverless-friendly** -- Deployed on Vercel with session recovery on cold starts. OAuth 2.0 with PKCE for secure authentication.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, commands, and environment variables.

## License

MIT
