# Computer Use via MCP: Architecture Problem

## What We Have

We have a working MCP server that exposes tools for controlling a mobile device:

```
screenshot()     -> returns base64 PNG
tap(x, y)        -> taps at coordinates
swipe(...)       -> swipe gestures
type_text(text)  -> types into focused field
```

These tools work. Claude Code can call them.

## What Works (Direct API)

When we call the Anthropic API directly with the computer use tool, everything works correctly:

```python
tools = [
    {
        "type": "computer_20251124",
        "name": "computer",
        "display_width_px": 430,
        "display_height_px": 932,
        "display_number": 1,
    }
]

response = client.beta.messages.create(
    model="claude-opus-4-5",
    tools=tools,
    messages=messages,
    betas=["computer-use-2025-11-24"]
)
```

With this setup, Claude:
- Correctly interprets screenshots
- Accurately identifies UI element positions
- Returns precise tap coordinates
- Uses the structured `computer` tool with `action`, `coordinate`, etc.

## The Problem

When Claude Code uses our MCP tools, it **does not** use the computer use tool infrastructure. Instead:

1. It calls `screenshot()` via MCP and receives the image
2. It "eyeballs" where to tap based on the image
3. It calls `tap(x, y)` via MCP with **hallucinated coordinates**

The coordinates are consistently wrong because Claude Code isn't using the specialized computer use vision/reasoning that the `computer_20251124` tool provides. It's just guessing.

## What We Want

We want Claude Code to:
1. Use proper computer use tool reasoning when viewing screenshots from our MCP
2. Return accurate coordinates based on that reasoning
3. Execute those coordinates via our MCP tap tool

## Constraints

- **No proxy API server**: We don't want to run our own inference loop. We're distributing this MCP to users and don't want to pay for their API calls.
- **Maintain Claude Code autonomy**: Users should be able to give Claude Code a task and have it autonomously use the phone MCP as needed.
- **MCP is the execution layer**: The MCP handles the actual device interaction. We just need Claude Code to reason correctly about coordinates.

## What We've Tried

- Skills/slash commands: These don't change how Claude reasons about coordinates
- Detailed system prompts in MCP tool descriptions: Still hallucinates positions
- Returning screenshots with coordinate grids overlaid: Marginal improvement, still unreliable

## The Core Question

**Is there a way to make Claude Code use the `computer_20251124` tool and `computer-use-2025-11-24` beta when interacting with an MCP that provides the execution layer?**

Or alternatively: **Is there a pattern for MCP servers that need computer-use-level vision accuracy without running a separate API loop?**

## Ideal Architecture

```
User Task
    ↓
Claude Code (with computer use tool enabled)
    ↓
Reasons about screenshot, produces accurate coordinates
    ↓
Calls MCP tap(x, y) with correct coordinates
    ↓
MCP executes on device
    ↓
Returns new screenshot
    ↓
Loop continues
```

The missing piece is getting Claude Code to enable and use the computer use tool when our MCP is present.
