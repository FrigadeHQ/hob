# Hob plugins

A plugin is a folder with a `hob-plugin.json`. It can add any mix of:

- **Skills**: plain-English instructions for a kind of task. Anyone can write one.
- **Python tools**: small scripts Hob can call. They run in Hob's sandbox.
- **Connectors**: any [MCP](https://modelcontextprotocol.io) server: a program on this computer, or an online one at a link.

Hob also installs **MCP bundles** (`.mcpb`, the format Claude Desktop uses) as they are.

Hob's own Web search, Code & charts and PDF features are built-in plugins in this same format. See [`app/plugins/`](../../app/plugins).

## Pages

| | |
|---|---|
| [Skills](skills.md) | Plain-English instructions for a kind of task. Anyone can write one, in 5 minutes. |
| [Python tools](python-tools.md) | Small scripts Hob can call, run in Hob's sandbox. |
| [Connectors (MCP)](connectors.md) | Any MCP server, on this computer or online, plus `.mcpb` bundles. |
| [Reference](reference.md) | Every `hob-plugin.json` field, settings, home screen starters. |

## What's built in

| Plugin | What it adds |
|---|---|
| Web search | Searches the web and reads pages, through a private metasearch that runs on your computer |
| Code & charts | Python with pandas, Pillow, openpyxl and more, in a sandbox; reads photo dates |
| PDF | Reads PDFs (scanned ones too) and fills in PDF forms (Mac) |

## Share it

Zip the folder (or the folder that contains it). Others add it with **Settings → Plugins → Add plugin**. Installing a newer zip with the same `id` replaces the old copy.

If something's wrong, the plugin's card shows the exact problem, for example `hob-plugin.json: tools[0].run must be a path inside the plugin folder`.

[Plugins overview](README.md) · [Skills](skills.md) · [Python tools](python-tools.md) · [Connectors (MCP)](connectors.md) · [Reference](reference.md)
