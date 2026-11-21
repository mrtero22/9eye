# 0025 — What AI may do: one panel, part × action, and a tool for every action

Status: **Accepted** 2026-11-17 (user: "Are, besaz" after the mockups; "Are, shoroo kon" for the
first step) · **first step built** 2026-11-17: the table and the Channels and Layouts tools; **Scheduling tools
(6.3) built** 2026-11-17; **Ads tools (6.4) built** 2026-11-17; **Media tools (6.5) built** 2026-11-17; **Playlist tools (6.2) built** 2026-11-17 — every group of
point 6

## Context

The user tried to make a layout and a channel through MCP (Claude Code, decision 0023) and found no
tool for it: the AI tools cover reading, a few draft changes (create weeks, fill a day, change rows
of a day, book spots, …) and, for agents, approving a day (0024). The user wants AI to be able to do
**everything a person can do**, and a **detailed panel** where a company decides, **for each part**,
what AI may do and what it may not — from full access to very limited.

Today the company has one switch, Settings › AI access: Off · Read only · Read and change drafts
(0023), each token is Read or Read and change, and an agent has its parts (Read · Read and change,
0024). A person's role (0007) always bounds all of it. User choices, 2026-11-17: the panel is a
**table of parts × actions**; **every action gets its own tool** with preview and undo (no generic
"call any route" tool); the panel holds for **MCP clients and agents** alike; mockups first.

## Decision

1. **One table, in Settings › AI access, replaces the three-way choice.** Rows are the parts:
   **Media, Layouts, Scheduling, Playlist, Ads, Channels** (Reports and As-run join when they are
   built). Columns are the actions: **Read · Change · Create and delete · Approve · Export**.
   "Approve" is: approve or reopen a day for air (Playlist), confirm a plan (Scheduling), confirm a
   campaign (Ads); "Export" is a day's playout file (Playlist). A cell that has no meaning shows a
   dash.
2. **Each cell is Allowed, Ask first, or Off.** Read and Export are Allowed or Off.
   - **Allowed** — the AI applies it after its preview (the AI app asks its person as it always
     does).
   - **Ask first** — the AI prepares it, and it waits in 9eye, in **Waiting for you**, until a person
     who may do it approves it there: the same change cards as agents (0024), saying which app and
     whose token ("Claude on my laptop · Dana Ellis"). Approving a day for air is asked twice.
   - **Off** — the AI does not get the tool at all.
   **Agents always ask first** (0024: every change of an agent waits for a person); for them the
   table decides only what is Off.
3. **Presets** set the whole table at once: **Read only**; **Drafts** (what "Read and change drafts"
   allows today: change drafts in Playlist and Ads, the rest Read; since the Ads tools, Ads › Create
   and delete is Off in it); **Full** (everything Allowed —
   whatever a person with the same role could do); and **Custom** as soon as a cell is changed. The
   company switch **On / Off** stays above the table (Off: no token works, no agent runs). Today's
   companies move over: Off → Off, Read only → Read only, Read and change drafts → Drafts.
4. **Three limits, the smallest wins**: the person's **role** (0007) — the **company table** —
   the **token's own table** (a person can narrow a token when making it: "Same as Aurora Media",
   "Read only" or Custom, never wider than the company) or the **agent's parts** (0024).
5. **Never open to AI**, shown locked under the table: people and roles, companies, AI access and
   tokens, connections and sign-in. No tool exists for them.
6. **A tool for every action**, each with a preview first, apply at the version the preview showed,
   and undo (a create is undone by deleting what it made; a delete only while what it removed can
   be put back — otherwise it says so and asks first). Built in this order:
   1. **Channels and Layouts** (what the user needed first): create a channel, change its settings;
      create, clone, rename (name, dates, weekdays) and delete a layout; create, change and delete
      block types and break lists; break positions.
   2. **Playlist**: rename and delete a week; export a day (Export).
   3. **Scheduling**: create a plan, change it (name, dates, items, time windows), place airings,
      move and remove airings, duplicate, split, move airings to another plan, delete, confirm.
   4. **Ads**: clients, deals and campaigns — create, change, delete.
   5. **Media**: categories, titles and items — create, change, delete; a series of episodes;
      segmentations; rotation lists (create, clone, shuffle, take an item out); relations.
   Every tool belongs to one cell of the table (`part`, `action`), so the panel decides it.
7. The **table and its first tools ship together** (step 6.1); each later group of tools arrives
   already governed by the table. Settings › Activity shows what an AI did and, for Ask first, who
   approved it.

## First step — built 2026-11-17

Points 1–5 and 6.1 (the table, its limits, and the Channels and Layouts tools). Not committed.

- **API, the table** — `apps/api/src/aiPolicy.ts`: parts, actions and what each holds
  (`PART_INFO`, `ACTION_INFO`), presets and `presetOf`, `normalize`, `companyTable` (a company
  without a table yet reads its old choice: Read and change drafts → Drafts, else Read only),
  `tokenTable`, `narrower` (cell by cell, the smaller), `TOOL_CELL` (every tool → its part and
  action; a tool not listed is on wherever AI is on). Migration `20261117080223_ai_policy`:
  `tenant.ai_policy`, `access_token.policy` (JSONB, null = same as the company), `agent_change`
  gets `token_id`, `user_id`, and `agent_id` / `run_id` may be empty (a change an AI app asked
  first). `tenant.ai_access` is saved as `on` / `off` from now on.
- **API, the rules** — `mcp/auth.ts`: a token works with the narrower of its own table and the
  company's (`Principal.policy`); `mcp/tools.ts`: Off hides the tool; where the cell is **Ask
  first**, an MCP call with `apply: true` saves the change, with its preview, as waiting in
  Agents › Waiting for you (the same request twice is one change) and answers the app that it
  waits for a person. Approving it (`agents/service.ts` `decideChange`) applies it with what the
  token's person **and** the approver may do, at the version of the preview; the audit log keeps
  it via the token, by the approver. A cell turned Off after the change was made: approving
  refuses ("AI may not do this in … now"). Agents: the tools of their parts minus what the
  company table has Off (`agents/runner.ts`).
- **API, routes** — `PUT /api/admin/ai-access {on, table, maxDays}`; `GET /api/admin/ai-access`
  and `GET /api/me/ai-access` answer the table, its preset and its shape (parts, actions, what has
  no meaning); `POST /api/me/ai-tokens {company, name, days, limits}` with `limits` Same as the
  company · Read only · Custom (a custom table wider than the company is refused, naming the cell).
- **Tools** (`apps/api/src/mcp/setup.ts`, for MCP clients and agents, each with a preview, apply
  at the version and undo): `get_channel`; `create_channel`, `edit_channel`; `create_layout`,
  `clone_layout`, `rename_layout` (name, dates, weekdays), `delete_layout`; `create_block_type`,
  `edit_block_type`, `delete_block_type` (refused while a layout uses it); `create_break_list`,
  `edit_break_list`, `delete_break_list`; `edit_break_positions`. Undo (`undoSetup`): a new channel
  or layout is taken away while nothing uses it, a deleted layout comes back, a change is put back
  at its version. Agents: the Layouts part's "Read and change" gives the layout tools.
- **Web** — `ui/PermissionTable.tsx` (the table, On · Ask · Off per cell, a dash where a cell has no
  meaning, cells capped and greyed with the reason) and `PermissionLegend`; `lib/aiTable.ts`
  (presets, caps, counts); Settings › AI access (`features/admin/AiAccessSection.tsx`): AI on,
  Start from, the table, the locked lines, longest token life, each token's limits; Account › AI
  access › New token: Same as <company> · Read only · Custom (the small table, capped by the
  company and the person's role); Agents › Waiting for you: an AI app's change with the person,
  "AI app · via <token> · asked first".
- **Tests** — API: `test/aiAccess.test.ts` (8, the table: Off hides a tool, Ask first waits and is
  applied on approval), `test/setup.test.ts` (5, the new tools with preview, apply and undo); the
  whole API suite 175 passed. e2e: `ai-access.spec.ts` (the table, a token's own limits, an Ask
  first change approved in Waiting for you), `agents.spec.ts` (the agent team's company now has a
  table: Drafts with Playlist › Approve on Ask first); the whole e2e suite 84 passed.
- **Not built yet** (at the time): the Export column had no tool; the next groups of tools (6.2–6.5)
  — all built since, below.

## Scheduling tools (6.3) — built 2026-11-17

User: "Scheduling tools" — all of them; confirming a plan asks once (it does not put a day on air).
`apps/api/src/mcp/plans.ts`, for MCP clients and agents, each with a preview, apply at the version
the preview showed, and undo_change (`undoPlans`; `restoreOrders` in services/orders.ts puts plans
back all or nothing, each only at the version the change left it at). Not committed.

- **Read** (Scheduling › Read): `get_plan` — settings (kind, status, dates, limits, time windows),
  items with their places ("item 3") and how often each is placed, the blocks of its layout with
  their times, and the airings of a span of days with their codes ("airing 3f9a1c2e").
- **Create and delete**: `create_plan` (a draft with its items from Media — a title brings all its
  episodes in order — limits and time windows in clock times; born without airings),
  `duplicate_plan`, `split_plan`, `delete_plan` (undo brings it back).
- **Change**: `edit_plan` (name, dates, colour, first episode, start again, limits, time windows,
  add items, take out items no airing uses; dates that would leave airings outside are refused),
  `place_airings` (auto · copy_week · rotation for trailers, stings and graphics · blocks one by
  one · repeats of a first airing; the page's own rules in @9eye/core: `autoPlace`, `copyWeek`,
  `rotate`, `nextItemFor`), `remove_airings` (by code, or a span of days and/or blocks; never all by
  accident), `shift_episodes` (`shiftAirings`), `replace_items` (an item of the plan or of Media),
  `move_airings` (to a plan with the same dates, channels and kind; both versions).
- **Approve**: `confirm_plan` (Confirmed, or back to Draft): filling a day's Program placements then
  places its airings; days stay drafts until a person approves them.
- Every preview lists what changes in the airings: `+` new, `−` taken out, `~` changed, with the
  day, the block's time and name, and the episode. Undo is a change too: an older change of the same
  plan cannot be undone over a newer one (as for days).
- Agents: the Scheduling part gives `list_plans`, `get_plan` and, with "Read and change", the eleven
  write tools (`agents/parts.ts`); approving or undoing a change reloads the Scheduling page
  (`useDecide`).
- Tests: `test/plans.test.ts` (6), an agent test ("phase C2"), the MCP test lists eleven read tools;
  the whole API suite 182 passed, web unit 11, the whole e2e suite 84 passed.

## Ads tools (6.4) — built 2026-11-17

User: "Ads tools" — all of them. `apps/api/src/mcp/ads.ts`, for MCP clients and agents, each with a
preview, apply at the version the preview showed, and undo_change (`undoAds`). Booking spots,
taking them out and confirming a campaign were there before. Not committed.

- **Read** (Ads › Read): `list_clients` — type, country, contacts, VAT number, tolerance, deals,
  version, id.
- **Create and delete**: `create_client`, `delete_client` (only without deals), `create_deal` (client,
  dates, currency, value, notes, channels), `delete_deal` (only without campaigns),
  `create_campaigns` (one draft per channel on its main layout, from a day to the deal's end, with
  the ads it may book; a channel not in the deal joins it), `delete_campaign` (only without booked
  spots). Undo of a make deletes it only while nobody changed it since (and, for campaigns, while
  nothing is booked); undo of a delete brings it back unless something of the same name was made.
- **Change**: `edit_client`, `edit_deal` (a channel a campaign uses stays; campaigns that would run
  outside new dates are named), `edit_campaign` (name, dates within the deal holding every booking,
  add ads, take out ads that are not booked).
- Clients, deals and campaigns are named by id or name (a part of the name when only one fits);
  ads of a campaign as "V2", as get_campaign shows them.
- **Drafts preset changed** (user's choice, 2026-11-17): Drafts is Playlist › Change and Create and
  Ads › **Change** — weeks, days and bookings; it no longer makes or deletes clients, deals or
  campaigns (Ads › Create and delete is Off). Tables companies saved keep what they saved; a company
  without a table yet (old "Read and change drafts") reads the new Drafts.
- Agents: the Ads part gives `list_clients` too and, with "Read and change", the nine new write
  tools; approving or undoing a change reloads the Ads pages (`useDecide`).
- Tests: `test/ads.test.ts` (4), an agent test ("Ads tools"), the MCP test lists twelve read tools,
  the AI access e2e counts the Drafts table anew; the whole API suite 187 passed, web unit 11, the
  whole e2e suite 84 passed.

## Media tools (6.5) — built 2026-11-17

User: "Media tools" — all of them. `apps/api/src/mcp/media.ts`, for MCP clients and agents, each with
a preview, apply at the version the preview showed where the thing has one, and undo_change
(`undoMedia`). Changing one item's fields (`edit_media`) and adding to a rotation list were there
before. Not committed.

- **Read** (Media › Read): `list_categories`; `get_title` (fields, version, its items with episode,
  code, length, media state, rights, cuts and their parts, the next free episode);
  `get_rotation_lists` (all lists, or one list's items numbered in order, the one played last).
- **Create and delete**: `create_category`, `create_title`, `create_item` (code from the media
  source's pattern when not given; programmes take the next free episode), `create_episodes`
  ("<name> - N", each with one cut of equal parts; refused when a number exists), `delete_media`
  (categories, titles or items with everything under them — refused when anything is used in
  plans, playlists, campaigns, rotation lists or as a sting; undo brings it all back with its
  relations), `create_cut`, `create_rotation_list`, `clone_rotation_list`, `delete_rotation_list`
  (refused while a block type or layout uses it).
- **Change**: `edit_category` (name, code, colour), `edit_title` (title, code, original title,
  season, length, parts, valid dates, genres, synopsis, notes), `recut` (new equal parts; undo puts
  the old parts back), `edit_rotation_list` (name, settings, take items out, move items; the item
  played last keeps its mark), `shuffle_rotation_list` (the order is drawn on apply; undo puts the
  old one back), `edit_relations` (stings pre / post, graphics from a template, time windows
  allowed / rejected, product codes for ads — replaces a category's, title's or item's own rows
  of one kind; inherited rows stay).
- Drafts reads Media and changes nothing in it (as before).
- Undo of relations compares rows with their keys in order: the audit log (JSONB) does not keep
  the order keys were written in.
- Agents: the Media part gives the three read tools too and, with "Read and change", the fifteen new
  write tools; approving or undoing a change reloads the Media page (`useDecide`).
- Tests: `test/media.test.ts` (5), an agent test ("Media tools"), the MCP test lists fifteen read
  tools; the whole API suite 193 passed, web unit 11, the whole e2e suite 84 passed.

## Playlist tools (6.2) — built 2026-11-17

User: "Ok play list rest ro ham anjam bede"; approving opens to AI apps under the table; Export is
Allowed or Off. `apps/api/src/mcp/playlist.ts`, for MCP clients and agents. With this group every
tool group of point 6 is built. Not committed.

- **Read**: `list_weeks` (number, name, playlist, dates, layout, days approved / drafts / off,
  version, id). **Export**: `export_day` — the day's Playout XML playout file as text, with its file
  name, the rows without a playout file and whether the day is still a draft; it changes nothing
  in 9eye (a file over 400 kB is left to the day page). It needs the role's Playlist › Export.
- **Change**: `rename_week`. **Create and delete**: `delete_week` (refused while a day is approved,
  reconciled or holds rows; undo makes the week again from its layout, with its name). Both at the
  version the preview showed.
- **Approve**: `approve_day` and `reopen_day` are no longer for agents only: an AI app gets them
  where the company's table has Playlist › Approve (decision 0023's "an AI app never approves a
  day" is replaced by the table). Ask first: the change waits in Agents › Waiting for you and a
  person approves a day for air twice; Allowed: the app applies it after its person agrees. The MCP
  instructions say so.
- **Read and Export are Allowed or Off** (the table, the page and `normalize`): a read asked first
  counts as Allowed, an export asked first as Off.
- Agents: the Playlist part gives `list_weeks` and `export_day` with "Read" (Export still decided
  by the table) and `rename_week`, `delete_week` with "Read and change"; approving or undoing a
  change reloads the Playlist page.
- Tests: `test/playlist.test.ts` (4); the changes and MCP write tests follow the table for
  approving; the MCP test lists sixteen read tools for a Read only company; the whole API suite 197
  passed, web unit 11, the whole e2e suite 84 passed.

## The Nth break of each block; campaigns by name — 2026-11-17

User: "Yani … bezar too break 2vom har block ba position masalan commercial bottom. Mitoone?" then
"Are anjam bede". Not committed.

- `book_campaign_spots` takes `break_in_block` (2 = the second break of every block): day by day,
  each block of the main layout gives its Nth linked break (in their order); `breaks`,
  `break_name_contains` and `between` narrow it further. The preview says how many blocks have no
  Nth break. With `position` (a break position by name, e.g. "Commercial Bottom") every spot takes
  that position. `bookSpots` (services/commercialOrders.ts) has `nthInBlock`; the Ads page does not
  use it.
- `get_campaign`, `book_campaign_spots`, `confirm_campaign` and `remove_campaign_spots` take a
  campaign by id **or name** (`campaignRef` of mcp/ads.ts).
- Tests: `test/ads.test.ts` (the 2nd break of each block in a position, undone); the whole API suite
  198 passed, web unit 11, the whole e2e suite 84 passed.

## Rejected

- A list of every tool, each switched on or off (chosen against by the user: long and hard to keep).
- One generic tool that calls any route of the app (chosen against by the user: no preview, no undo).
- Letting agents apply without asking (0024: every change of an agent waits for a person).
