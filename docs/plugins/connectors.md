# Connectors (MCP)

Hob connects to any [Model Context Protocol](https://modelcontextprotocol.io) server: a program on this computer, an online server at a link, or a `.mcpb` bundle.

## Connect an MCP server

```json
{
  "id": "memory",
  "name": "Memory",
  "mcpServers": { "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] } }
}
```

Users can also add one without a folder: **Settings → Connectors → Add connector**, then paste a link, a command, or a Claude / Cursor / VS Code style `{"mcpServers": …}` config.

- Hob starts the server the first time it's needed and stops it when Hob quits.
- `npx`, `uvx` and similar commands are found through the user's login shell `PATH`.
- Tools marked `destructiveHint: true` show an approval card before each use.
- MCP servers are **not sandboxed**. Hob says so before connecting one.
- Tools without hints whose names only read (`get_…`, `list_…`, `search…`) run without asking; others ask first.

### Online servers (a link)

```json
"mcpServers": {
  "linear": { "url": "https://mcp.linear.app/mcp" },
  "docs":   { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${API_KEY}" } },
  "old":    { "url": "https://example.com/sse", "type": "sse" }
}
```

- Hob speaks Streamable HTTP and falls back to the older HTTP+SSE transport by itself.
- **Sign-in:** if the server asks for it (OAuth), the plugin card shows **Sign in**. Hob opens the browser, registers itself with the server, and keeps the token encrypted. Tokens refresh on their own.
- If the server doesn't let apps register, give your client id: `"oauth": { "clientId": "…" }`, or use an API key header.
- `${API_KEY}` (any setting key) is filled in from the plugin's settings.

## MCP bundles (.mcpb)

A [`.mcpb`](https://github.com/anthropics/mcpb) file works in Hob as it is. Build one with `npx @anthropic-ai/mcpb pack`, then:
- **Settings → Connectors**, then drop it there or choose it, or double-click it in Finder.
- `user_config` fields become settings on the card: text, secret, number, on/off, and folder or file pickers. Required ones must be filled in before it starts.
- `${__dirname}`, `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}`, `${DOWNLOADS}`, `${/}` and `${user_config.…}` are filled in. Several chosen folders become several arguments.
- `"type": "node"` bundles run on Hob's built-in Node, and `"python"` bundles on Hob's Python. Nothing extra to install. `uv` bundles need [uv](https://docs.astral.sh/uv/).
- `platform_overrides` and `compatibility.platforms` are respected.

[Plugins overview](README.md) · [Skills](skills.md) · [Python tools](python-tools.md) · [Connectors (MCP)](connectors.md) · [Reference](reference.md)
