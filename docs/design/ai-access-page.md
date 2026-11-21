# AI access and Activity (build reference)

Decision [0023](../decisions/0023-mcp-server.md) (MCP). Mockups: [mockups/AiAccess.dc.html](mockups/AiAccess.dc.html)
(Settings › AI access and Settings › Activity) and [mockups/MyAiAccess.dc.html](mockups/MyAiAccess.dc.html)
(the account menu › AI access). Status: drawn 2026-11-17; **built 2026-11-17** (user: "Ok, besaz"):
`apps/web/src/features/account/` (page `/account/ai-access`, the shared token table) and
`apps/web/src/features/admin/AiAccessSection.tsx`, `ActivitySection.tsx`, `activityWords.ts`.
Not built yet: the **Day** filter of Activity (the API has `day`; the page needs a date picker that
does not depend on a channel). Sample data in the mockups is the fictional Aurora Media.

Two places, nothing more: each person makes and revokes **their own** tokens; the company admin
sets **what AI apps may do in the company**, sees **every token** of it and the **Activity** log.
No model or API-key settings (the model is the customer's), no per-role tool lists (roles decide).

## What AI may do, part by part (decision 0025)

**Built 2026-11-17** (user: "Are, besaz"; [0025](../decisions/0025-ai-permissions.md) "First
step"): it replaces the three-way choice and the token's Read / Read and change described further
down, which stay only as the history of 0023. Mockups, 2026-11-17: [mockups/AiPermissions.dc.html](mockups/AiPermissions.dc.html)
(Settings › AI access), [mockups/AiTokenLimits.dc.html](mockups/AiTokenLimits.dc.html) (a new token
with its own limits), [mockups/AiWaiting.dc.html](mockups/AiWaiting.dc.html) (Agents › Waiting for
you, with a change an AI app asked first). Sample data: the fictional Aurora Media.

- **Settings › AI access** — "What AI may do in <company>": an **AI on** switch, **Start from**
  Read only · Drafts · Full · Custom, and the table: rows **Media, Layouts, Scheduling, Playlist,
  Ads, Channels** (each with a quiet line of what it holds), columns **Read · Change · Create and
  delete · Approve · Export** (each with a quiet line: "Look things up", "What exists", "New things,
  or take away", "Confirm, or put on air", "Files out of 9eye"). A cell is a small On · Ask · Off
  control (Read: On · Off), green / amber / plain; a cell without meaning is a dash; under a cell
  what it is when that is not plain ("Approve or reopen a day for air", "A day's playout file",
  "Confirm a plan", "Confirm a campaign"; "asked twice"). Under the table: the three words
  explained, a locked line "Never open to AI: people and roles, companies, AI access and tokens,
  connections and sign-in", and "9eye's agents always ask first: for them this table decides only
  what is Off". Save / Discard with the count of changes. The tokens table shows each token's
  limits: "Same as the company · follows this table", "Read only", "Custom" (with a line).
- **Account › AI access › New token** — **What it can do**: Same as <company> · Read only · Custom;
  Custom shows the same table, smaller; each cell steps through what is allowed when clicked, and a
  cell the company or the person's role caps is greyed, its tooltip saying why ("Aurora Media
  allows up to Ask first", "Your role cannot approve days for air"). Under it the person's role in
  words.
- **Ask first** — what an AI app prepared waits in **Agents › Waiting for you** beside the agents'
  changes: the person's initials, "AI app", the time, "via <token name>", the rule that made it
  wait ("Layouts › Create and delete: Ask first"), the change in words, Approve / Reject; and what
  the app told its person ("It waits for you in 9eye › Agents › Waiting for you…"). A day for air
  opens "Approve this day for air?" — the second approval.

## Account menu › AI access (every person)

Page header "AI access", one line: "Connect Claude, ChatGPT or your own agent to 9eye. It works as
you, with your role, in one company." Primary action **New token**.

- **Your tokens** (table): name, company, what it can do (since 0025: Same as the company · Read
  only · Custom, with its cells in a line; before: Read · Read and change drafts), made, last
  used, expires (or Expired / Revoked, muted), **Revoke** (asks once; takes effect at once).
- **New token** opens the details panel on the right:
  1. Name ("Claude on my laptop"), company (the companies the person can open), **What it can do**
     (Read only · Read and change drafts), **Expires in** (30 · 90 · 180 · 365 days). Under the
     choice, the person's role in that company in plain words ("Traffic operator — can change
     Playlist and Plans and campaigns"). Options the company does not allow are disabled with the
     reason ("Aurora Media allows read only", "Aurora Media allows up to 90 days").
  2. **Make token** → the token, once: "Copy it now — it is not shown again", a Copy button, then
     **Connect** tabs: Claude Code (the `claude mcp add` line with the token filled in), Claude
     Desktop (steps), ChatGPT ("Needs 9eye on the internet: comes with sign-in from ChatGPT",
     0023 phase 4), Other app (address + header). **Done** closes the panel.
- Footer line: "Anyone with the token can work as you. Revoke it if it leaks."

## Settings › AI access (company admin: Settings view to see, Settings edit to change)

In the Settings nav under Organisation, after Roles: **AI access**, **Activity**.

- **What AI apps may do in <company>** — replaced by the table of 0025 (above); as built for 0023,
  one choice, saved with Save / Discard as on a channel:
  - **Off** — no AI app can connect; its tokens stop working (they are kept, so turning it on again
    brings them back).
  - **Read only** — read playlists, plans, media and campaigns, and check days.
  - **Read and change drafts** — also create weeks, fill days and book campaign spots, always after
    a preview and with undo. A person's role still decides.
  - Always shown, locked: "No AI app can approve, reopen or export a day." (Since 0025 the table
    decides: Playlist › Approve and Playlist › Export.)
  - **Longest token life**: 30 · 90 · 180 · 365 days (default 90). New tokens only.
- **Tokens in this company** (table, count in the title): person (name + e-mail), token name, what
  it can do, made, last used, expires, **Revoke**. "Show expired and revoked" switch (off: only
  working tokens). A token whose person left the company shows "Left the company" and no longer
  works (the API already refuses it).

## Settings › Activity (Settings view)

"Every change in <company>, from the app or an AI app, newest first." Filters: **From** All · App ·
AI apps; **Person**; **Day**. Table: when (time; day groups), who (name; for AI "via <token name>"),
what (in words, below), item, result (Done · Refused, with the reason), and **Undone** when a later
change undid it. AI reads are listed muted (they change nothing). A row opens the details panel:
what was sent (the input, secrets shown as hidden), the change id, the channels, and for an MCP
change what undo would put back. "Load older" at the end (the API pages by `before`).

**Words for actions** (one table in the web app, keyed by the audit `action`): `PUT /days/:id` →
"Saved the day"; `POST /days/:id/publish` → "Approved the day"; `POST /channels/:id/weeks` →
"Created weeks"; `POST /commercials/orders/:id/book` → "Booked spots"; `tool fill_day` → "Filled the
day (<step>)"; `tool book_campaign_spots` → "Booked spots"; `tool create_weeks` → "Created weeks";
`tool undo_change` → "Undid a change"; `tool get_…` / `list_…` / `check_day` / `search_media` →
"Read …". An action without words shows as "Changed <item>".

## API (built 2026-11-17, `apps/api/src/services/aiAccess.ts`)

- Since 0025: `GET /api/me/ai-access` answers each company's table, preset and what the person's
  role can do, and the table's shape; `POST /api/me/ai-tokens` takes `limits` (`same` · `read` ·
  `custom` with a table, never wider than the company); `GET/PUT /api/admin/ai-access` hold
  `{on, table, maxDays}` (`tenant.ai_policy`, migration `20261117080223_ai_policy`). As built for
  0023:
- `GET /api/me/ai-access` (the person's tokens and the companies they can make one for, with the
  policy, longest life, their role and whether it can change anything), `POST /api/me/ai-tokens`
  `{company, name, access, days}` (the token text once; refused when the company is off, edit when
  the company allows read only or the role cannot change anything, days over the company's longest
  life), `DELETE /api/me/ai-tokens/:id` (own only). Before the company step: any signed-in person.
  Making and revoking go to that company's Activity, never the token.
- `GET /api/admin/ai-tokens`, `DELETE /api/admin/ai-tokens/:id` (Settings view / edit; this company).
- Company policy: `tenant.ai_access` (`off` · `read` · `edit`, **default `read`**) and
  `tenant.ai_token_max_days` (30 · 90 · 180 · 365, default 90) — migration
  `20261116182542_company_ai_access`; `GET/PUT /api/admin/ai-access`. The MCP endpoint refuses every
  token of a company that is Off (403), and hides the write tools when it is Read only, whatever the
  token says.
- `GET /api/admin/activity` takes `person` and `day` too, and names the token of an MCP event.
- The terminal script (`npm -w @9eye/api run token`) stays for platform admins.
