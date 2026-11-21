# 9eye MCP server

9eye has a built-in **Model Context Protocol (MCP) server**, so Claude, ChatGPT, Grok or your own agents
can work in your 9eye: read a channel's layouts, plans, playlists and ad campaigns, and — when you
allow it — change them, always with a preview first and an undo after. It is part of the 9eye API
(decision [0023](decisions/0023-mcp-server.md)); there is nothing extra to install.

| | |
|---|---|
| Endpoint | `https://<your 9eye address>/api/mcp` (locally `http://127.0.0.1:4100/api/mcp`) |
| Transport | Streamable HTTP, stateless; MCP 2026-07-28 and earlier 2025 clients — or [stdio](#over-stdio) |
| Authentication | `Authorization: Bearer 9eye_pat_…` — a personal access token |
| Acts as | the token's person, in the token's company, with that person's role |

## Connect

**1. Make a token.** In 9eye: account menu › **AI access** › **New token** (the token is shown once, with
a ready-made command), or in the terminal:

```bash
npm -w @9eye/api run token -- create <email> <company short name> "<name>" [days] [--edit]
```

A token from the terminal is read only unless it is made with `--edit`; in the web form a token is
*Same as the company*, *Read only* or *Custom*. A token is never wider than the company allows (see
[What AI may do](#what-ai-may-do)).

**2. Add the server to your MCP client.**

Claude Code:

```bash
claude mcp add --transport http 9eye https://<your 9eye address>/api/mcp \
  --header "Authorization: Bearer 9eye_pat_…"
```

Any MCP client that speaks Streamable HTTP — a JSON config such as:

```json
{
  "mcpServers": {
    "9eye": {
      "type": "http",
      "url": "https://<your 9eye address>/api/mcp",
      "headers": { "Authorization": "Bearer 9eye_pat_…" }
    }
  }
}
```

ChatGPT and claude.ai connect over the internet with a sign-in instead of a token; that comes when a
9eye installation runs on its own public address.

### Over stdio

For MCP clients that start a local command instead of calling a URL, the same tools run over stdio,
as the token's person (checked when the server starts):

```bash
NINEEYE_MCP_TOKEN=9eye_pat_… npm -s -w @9eye/api run mcp:stdio
```

```json
{
  "mcpServers": {
    "9eye": {
      "command": "npm",
      "args": ["-s", "-w", "@9eye/api", "run", "mcp:stdio"],
      "cwd": "/path/to/9eye",
      "env": { "NINEEYE_MCP_TOKEN": "9eye_pat_…" }
    }
  }
}
```

The [Docker demo](../README.md#try-it-in-one-command-docker) needs no token — it uses the demo
admin's: `"command": "docker", "args": ["run", "--rm", "-i", "9eye", "mcp"]`.

## What the tools cover

75+ tools, named after the work, not the endpoints. They answer in plain text a model reads well:
clock times and lengths as timecode, ids for the next call.

| Part | Read | Change |
|---|---|---|
| **Channels and layouts** | `list_channels` `get_channel` `get_layout` | `create_channel` `edit_channel` `create_layout` `clone_layout` `rename_layout` `edit_layout` `delete_layout` `create_block_type` `edit_block_type` `delete_block_type` `create_break_list` `edit_break_list` `delete_break_list` `edit_break_positions` |
| **Scheduling** | `list_plans` `get_plan` | `create_plan` `edit_plan` `place_airings` `move_airings` `remove_airings` `copy_week` `shift_episodes` `replace_items` `split_plan` `delete_plan` `confirm_plan` |
| **Playlist** | `list_weeks` `get_day_playlist` | `create_weeks` `rename_week` `delete_week` `fill_day` `edit_day` `approve_day` `reopen_day` `export_day` |
| **Ads** | `list_clients` `list_deals` `get_deal` `get_campaign` | `create_client` `edit_client` `delete_client` `create_deal` `edit_deal` `delete_deal` `create_campaigns` `edit_campaign` `delete_campaign` `book_campaign_spots` `remove_campaign_spots` `confirm_campaign` |
| **Media** | `search_media` `list_categories` `get_title` `get_rotation_lists` | `create_category` `edit_category` `create_title` `edit_title` `create_item` `create_episodes` `create_cut` `edit_media` `delete_media` `create_rotation_list` `clone_rotation_list` `edit_rotation_list` `add_to_rotation_list` `delete_rotation_list` `edit_relations` |
| **Every part** | | `undo_change` |

Every change tool **previews first** (`apply: false`) and applies only the version it showed; every
applied change can be put back with `undo_change` while nobody changed it since, and lands in the audit
log with the token's name.

## What AI may do

Each company has one table in **Settings › AI access**: part × action — Read · Change · Create and
delete · Approve · Export — each **Allowed**, **Ask first** or **Off**
(decision [0025](decisions/0025-ai-permissions.md)).

- *Ask first* turns the change into a request in **Agents › Waiting for you**; it is applied when a
  person who may do it approves.
- A token or an agent can be narrower than the company, never wider; the person's role still decides
  every step.
- Never open to AI: people and roles, companies, AI access and tokens, connections and sign-in.

## Agents

9eye's own agents use the same tools and the same table, run on the company's own Claude, ChatGPT or
Grok key, and always ask first (decision [0024](decisions/0024-agents.md)).
