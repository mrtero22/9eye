# 0023 — MCP: AI clients work in 9eye through an MCP server inside the API

Status: **Accepted** 2026-11-16 (user, in the session: the plan below, then "Are, faz 1")

## Context

The user wants people to work in 9eye by prompt, from Claude, ChatGPT, Grok or their own agents.
The website (0022) already promises MCP, agents that act with the roles of the person who runs them,
approval before air, and a record of every step. 9eye cannot afford to serve a large model itself.

## Decision

1. **One MCP server inside the API**: `/api/mcp`, Streamable HTTP, stateless (a server per request,
   built for the token's person and company). Official TypeScript SDK v2 (`@modelcontextprotocol/server`
   2.4.0, `@modelcontextprotocol/node` 2.1.2): protocol 2026-07-28 and 2025 clients. The tools call
   the services directly, not the REST API.
2. **The model is the customer's** (their Claude / ChatGPT / Grok account); 9eye only offers tools.
   The ten agents of the website are built on the same tools later.
3. **Tools by task, not one per endpoint**, in 9eye's own words, with
   answers in plain text: clock times and lengths as timecode, ids for the next call.
4. **In phases:**
   1. **Read only, personal access tokens** — built 2026-11-16 (below).
   2. **Roles on every REST route, and an audit log** — built 2026-11-16 (below), before any tool
      can write.
   3. **Write tools on drafts only.** Each first answers with a preview (what would change), then
      applies with `apply: true` and the `version` it read (409 when someone changed it), all or
      nothing; `destructiveHint` on those that delete. **No tool approves, reopens or exports a
      day**: approval before air stays with a person.
   4. **On the internet:** OAuth 2.1 as the MCP spec asks (the person signs in on 9eye's page and
      allows the client for one company, view or edit) and the protected-resource metadata; then
      claude.ai and ChatGPT connectors work. Rate limits per token.
   5. Prompts (e.g. "check tomorrow"), each channel's skills, MCP Apps (a day shown inside the
      chat), then the agents.
5. **Personal access tokens:** `9eye_pat_` + 32 random bytes; one person in one company; read only;
   90 days unless asked (at most 365); only the SHA-256 is stored (`access_token`), last use kept
   (at most once a minute); unknown, expired or revoked → 401. On every request the person must
   still be able to open the company (active member or platform admin), and the role they have
   *now* decides. Made in the terminal for now, like passwords (0021):
   `npm -w @9eye/api run token -- create <email> <company-slug> "<name>" [days]`, `… list <email>`,
   `… revoke <id>`. A page in Settings comes later. Setting a password does not revoke tokens.
6. **Roles** (0007): `accessOf` / `can` / `demand` in `apps/api/src/access.ts` — module × action on
   all channels or selected ones; platform admins may do everything. The MCP tools and the REST
   routes use the same checks.
7. **Every REST route has a rule** (phase 2, user 2026-11-16: "Are, anjam bede") in
   `apps/api/src/rules.ts`: the grants it needs (any one of them) and where its channels come from —
   the address, the body, or the item it names (a layout, week, day, block type, break list, plan or
   campaign is looked up for its channel). The routes are registered through `guarded(r)`: a route
   without a rule, or a rule without a route, stops the API from starting.
   - Media → `catalog`; Layouts, block types, break lists → `templates`; weeks, days, filling →
     `playlist` edit, Approve / Reopen → `playlist` approve, the playout file → `playlist` export;
     plans, clients, deals, campaigns, booking → `orders`; channel settings, roles, people,
     connections, break positions → `admin`. The shared Media picker opens for anyone who may view
     Media, Playlist, Plans, Layouts or Settings; break positions can be read with `orders` view.
   - **Channel scope** applies to what belongs to a channel: channels, layouts, block types, break
     lists, weeks, days, plans and campaigns. Media, clients, deals and Settings belong to the whole
     company. `GET /channels` and `GET /block-types` list only the channels the role reaches.
   - **Companies:** the company list in Settings shows only the companies the person can open;
     making a company is for platform admins only (before, any signed-in person could do both).
   - The web app is unchanged: a person whose role lacks something sees the API's message ("Your
     role does not let you change Layouts."). Hiding menus and buttons comes later.
8. **Audit log** (`audit_event`, phase 2): who (person, and the token for MCP), when, through `web`
   or `mcp`, the action (`PUT /days/:id`, or `tool get_day_playlist`), the item in the address, its
   channels, the outcome, and the input — the body or tool arguments with any key like password,
   secret, token, credentials or api key shown as `[hidden]`, over 50 KB only its size. Kept: every
   REST change that succeeded (previews and checks — weeks/check, days/run, days/catalog-rows,
   catalog delete-check, booking with `apply: false` — are not changes), and every MCP tool call,
   reads and failures included. Read with `GET /api/admin/activity?before=&limit=&via=` (Settings
   view); a Settings page for it needs its mockup first. Not yet: the before / after of each change,
   which "undo" needs — it comes with the write tools (phase 3), whose previews show the change.
9. **Write tools** (phase 3, built 2026-11-16, user: "Are, faz 3"; `apps/api/src/mcp/writes.ts`):
   `create_weeks`, `fill_day` (one step: Program placements, Break events, Rotation lists or
   Campaigns), `book_campaign_spots` (at most 62 days at a time) and `undo_change`. Offered only to
   a token made for changing drafts in a company that allows it (10 below); the role decides each call.
   Without `apply: true` each answers with a preview; apply needs the version the preview showed
   (days, campaigns) and is all or nothing. Every applied change has a change id; `audit_event.before`
   / `after` keep what undo needs (the day's rows, the campaign's bookings in the range, the weeks
   made). `undo_change` puts it back only while nobody changed it since; rotation lists are not put
   back. No tool approves, reopens or exports a day.
10. **AI access in Settings** (built 2026-11-17, user: "Ok, besaz"; `docs/design/ai-access-page.md`):
   each person makes and revokes their own tokens under the account menu › AI access (the token is
   shown once); the company admin sets **what AI apps may do** — Off · Read only (the default) · Read
   and change drafts — and the longest token life, sees every token of the company with Revoke, and
   reads **Activity**. The MCP endpoint follows the company first: Off refuses every token, Read only
   hides the write tools.

## The tools of phase 1

| Tool | Module | What it answers |
|---|---|---|
| `list_channels` | — | Channels the role reaches: code, frame rate, day start, today, playlists |
| `get_day_playlist` | playlist | A day's blocks (planned / real, short / over) and, unless `rows: false`, every row |
| `check_day` | playlist | The day page's own checks (core `dayChecks`): steps, issues, short blocks, media not ready |
| `search_media` | catalog | Titles and items by name or code: category, episode, length, media state, rights |
| `list_plans` | orders | A channel's Scheduling plans with this week's first airings, repeats and issues |
| `list_deals` / `get_deal` | orders | Deals: client, dates, value, notes, campaigns per channel |
| `get_campaign` | orders | A campaign: its ads and how often each is booked, the breaks it can book into |

Claude Code: `claude mcp add --transport http 9eye http://127.0.0.1:4100/api/mcp --header "Authorization: Bearer <token>"`.

## Rejected

- **A chat box inside 9eye that calls one provider's API**: 9eye pays for every token and is tied to
  one provider. The agents can still be built on these tools.
- **A tool per REST endpoint (101), or a raw query tool**: models choose badly from long lists, and
  a wrong write in broadcast puts the wrong ad on air.
- **SDK v1** (`@modelcontextprotocol/sdk` 1.32): v2 is the stable line, with fewer dependencies, and
  it uses zod 4 like 9eye.
