# Plugin reference

Everything a `hob-plugin.json` can hold.

## `hob-plugin.json` reference

| Field | | |
|---|---|---|
| `id` | required | lowercase letters, digits, dashes |
| `name` | required | shown to users |
| `version`, `description`, `author` | | |
| `icon` | | a [lucide](https://lucide.dev) name: `map`, `coins`, `chef-hat`, `globe`, `calendar`, `music`, `book-open`, `graduation-cap`, `code`, `mail`, `heart`, `briefcase`, `palette`, `plane`, `sparkles`, `plug`, … (others show a puzzle piece) |
| `permissions.network` | | Python tools may use the internet |
| `prompt` | | one or two sentences added to Hob's instructions while the plugin is on |
| `tools[]` | | `name`, `description`, `params` (JSON schema), `run`, `title` |
| `mcpServers` | | `{ name: { command, args, env } }` or `{ name: { url, headers, type, oauth } }` |
| `settings[]` | | `key` (UPPER_CASE), `label`, `secret`, `help`, `type` (`text`, `number`, `boolean`, `directory`, `file`), `required`, `multiple`, `default` |
| `starters[]` | | `title`, `prompt` |

## Settings and API keys

```json
"settings": [{ "key": "API_KEY", "label": "API key", "secret": true, "help": "From example.com/account" }]
```

- Users fill these in on the plugin's card.
- Secret values are encrypted with the system keychain.
- Hob passes the values to your tools and MCP servers as environment variables.

## Home screen starters

```json
"starters": [{ "title": "Plan a 3-day trip to Lisbon", "prompt": "/plan-trip 3 days in Lisbon" }]
```

[Plugins overview](README.md) · [Skills](skills.md) · [Python tools](python-tools.md) · [Connectors (MCP)](connectors.md) · [Reference](reference.md)
