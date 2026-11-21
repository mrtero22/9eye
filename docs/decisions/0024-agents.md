# 0024 — Agents: a team of agents that work in 9eye, with each other and with people

Status: **Accepted** 2026-11-17 (user: "Ok, besaz"); **phases A, B and C1 built** 2026-11-17 (below)

## Context

The user wants agents on the API of Grok, Claude or ChatGPT that can do everything in Scheduling,
Playlist, Ads, Media and Layouts, with a person's approval; agents inside every page and agents on
a schedule; new agents can be made and each managed, with its own settings and its own chat (to
give it work, or change its skill by talking); and agents that work together — the Playlist agent
checks, hands an error to the agent that can fix it, that one fixes it and reports back. The model
to follow is Grok Bot (https://x.ai/bot, read 2026-11-17): bots as teammates in a shared chat, one
job each, handing work to each other with the team seeing every step, approval cards, memory that
grows, routines, and a gallery to start new bots. Its "own computer" and meeting features do not
apply to 9eye. 0023 built what agents need: MCP tools with preview, version check and undo, a role
rule on every route, the audit log and Settings › AI access. 9eye cannot serve a large model itself.

Two drafts were rejected by the user on 2026-11-17: an Agents page with a settings form per agent
and a separate desk (far from the work, not a teammate), and fixed agents per part only (no new
agents, no chat per agent, no agents working together).

## Decision

1. **Agents are teammates.** A company makes as many agents as it wants, each with **one job**, a
   name and mark, the **parts** it works on and what it may do in each (Read · Read and change ·
   Nothing — its tools follow), its channels, a model, a **role** it acts with, its **skill**, its
   **memory**, its **routines**, and the agents it **works with**. New agents start from a gallery
   (Playlist checker, Gap filler, Media fixer, Ads booker, Weeks builder, Rights watcher, …), empty,
   or from a description (the agent drafts its own skill for a person to check).
2. **Every agent has its own page**: **Chat** (only the person and the agent: give it work, or tell
   it how to work from now on — a change to its skill comes back as a card, **Save to its skill**
   or **Only this time**; small preferences go to its memory, shown as "Saved to memory"),
   **Settings** (about, model and role, what it works on, skill with its history, memory with
   remove, works with, routines, limits and use) and **Work done**.
3. **Rooms**: shared chats (e.g. # playlist-checks) where people and agents talk. Agents post what
   they found, **@mention another agent to hand work on**, and report back ("fixed, check again" →
   "checked again: fine"). Everyone sees every step. A person can correct an agent there; the agent
   saves it to its memory.
4. **In every page**: the **Agent** button opens a panel with the agents of that part; it sees what
   the page shows, and its change is previewed on the page (new rows green, what stays wrong amber)
   with Approve / Reject (mockup PlaylistAgent).
5. **Everything, with a person's approval** (user, 2026-11-17): agents may prepare any action of
   the parts they work on, approving a day and exporting included, but **every change waits for a
   person** — as a card in the room, the agent's chat or the page, and in **Waiting for you** (one
   list for all, with a count in the top bar). Changes that go to air ask twice. Applied changes keep
   their change id and undo; chained changes apply only in order.
6. **Working together, safely**: a hand-off is a tool the runner gives an agent ("ask an agent it
   works with"); it goes at most **3 agents deep**, never back to an agent already in the chain,
   and each agent acts with its own role. Every step is a message in the room and in Activity.
7. **Initiative**: routines (a time, or an event: a week created, a campaign confirmed, a check
   failed) start an agent without anyone asking.
8. **Runner and providers**: an **agent runner inside the API** runs the loop; the model thinks at
   the provider, the tools run in process. One adapter per provider — Claude (Anthropic Messages
   API), ChatGPT (OpenAI API), Grok (xAI API, OpenAI-compatible). **The company's own key** per
   provider at first (Settings › AI access, encrypted, never shown again); whether "Platform + AI
   agents" later includes the tokens is the user's decision. Limits: steps per run, tokens per
   month per agent.
9. **"Everything" needs the tools**: each part's actions become tools with preview / apply / undo,
   in this order — Playlist, Scheduling, Ads, Media, Layouts; and the tools of rooms (post, hand
   off), memory and skill changes.

## Phase A — built 2026-11-17

User: "Ok, besaz", then "Are, faz A". Keys are the company's own and are entered by a person
("kilid ro khodet vared mikoni").

- **Provider keys**: Settings › AI access › Keys for agents (`/api/admin/ai-providers`): Claude,
  ChatGPT, Grok; AES-256-GCM at rest (`src/secrets.ts`), only the last 4 characters shown again,
  `apiKey` hidden in the audit log.
- **Runner** (`apps/api/src/agents/runner.ts`), in the API process, in the background of the request
  that started it: system prompt = job + skill + memory + parts + rules + 9eye's words; the room or
  chat so far (last 30 messages); the loop until the model ends, at most `maxSteps` model turns and
  `monthlyTokens` a month. A restart marks running runs failed. Stop from the conversation.
- **Providers** (`providers.ts`): Claude through `@anthropic-ai/sdk` (beta Messages with the
  server-side refusal fallback on Opus 5.5 / Sonnet 5.5 / Fable, effort high, prompt caching; a new
  agent starts on **Claude Opus 5.5**); ChatGPT and Grok through `openai` (Grok at
  `https://api.x.ai/v1`). Tests use a scripted provider (no network, no cost).
- **What an agent may do** = its role ∩ its parts (Read · Read and change) and channels ∩ the person
  it works for (who asked; for an approval, who approves). The company policy applies: Off → agents
  do not run; Read only → no write tools and no approvals.
- **Tools** are the MCP tools of 0023 (one definition, `toolDefs` / `invokeTool`, every call in the
  audit log as `agent`): list_channels; Playlist get_day_playlist, check_day, create_weeks, fill_day;
  Media search_media; Scheduling list_plans; Ads list_deals, get_deal, get_campaign,
  book_campaign_spots. A write tool only previews for an agent; a preview that can be applied
  (`applyWith`) becomes a **change card** (one per identical change). Plus remember,
  propose_skill_change and hand_off.
- **Change cards**: Approve applies it at the previewed version (newer → "changed since"), with
  agent ∩ approver; the person's role must allow changing that part; Reject; **Undo** while nobody
  changed it since. Waiting for you lists them; the top bar counts them.
- **Rooms**: @mention by whole name starts that agent; **hand-off** only to agents it works with,
  never to one already in the chain, at most 3 hand-offs in a chain; the answer goes back to the
  agent that handed it (a "report" run), and an approved change of a handed-off agent reports too.
- **Chat** per person and agent; **memory** (remember → "Saved to its memory", removable in
  Settings); **skill cards** (Save to its skill — people who can change Settings; Only this time;
  Dismiss) and the skill's history (settings or chat, who, when).
- **Gallery**: Playlist checker, Gap filler, Media fixer, Ads booker, Weeks builder, Day reporter
  (Rights watcher waits for rights data in the tools), or Start empty.
- **Who**: every member sees agents and rooms, chats, decides changes their role allows; people who
  can change Settings (`admin:edit`) make and change agents, rooms and keys.
- Messages, chats and stops are not in the audit log (they change no 9eye data); every tool call
  of an agent and every decision is.

Later: **C+** change tools for every part (Layouts, Media, Scheduling first have none), approving /
exporting a day with "ask twice", chained changes, "describe it and it writes its skill".

## Phase B — built 2026-11-17

User: "ok berim soragh faz b"; the panel on all five parts now ("Har 5 safhe hamin alan"),
routines on a time and two events ("Saat + 2 event").

- **The agent in a page**: an **Agent** button at the end of every page header of Scheduling,
  Playlist, Ads, Media and Layouts (a slot of `PageHeader`, `HeaderExtra`, set by the app shell)
  opens a panel docked on the right (`SideSheet`; on wide screens the page makes room). It lists
  the agents that work on that part (pick one; remembered), says what the page shows ("Sees this
  page: …" — each page tells it with `useAgentPage`), and holds the person's chat with that agent:
  each message carries the page, so "this day" means the day on screen. Quick requests per part.
- **Preview on the grid** (Playlist › Day): a waiting `fill_day` change of the day on screen has
  **Preview on the page**: the Day tab runs that step on the saved day and shows the result —
  new rows green with "new" — under a bar "<agent>'s change, not saved yet" with **Reject**,
  **Hide** and **Approve and save** (refused while the person has unsaved changes of their own).
  Approving applies it on the server at the previewed version, as any change card. The other
  parts show the panel without a grid preview until they have change tools (phase C).
- **Routines** (`agent_routine`, migration `20261117061400_agent_routines`): **at a time** (HH:MM on
  chosen weekdays, in a time zone; clock changes handled) or **when something happens** — a week is
  created, a campaign is confirmed (optionally only on some channels). A routine **works for the
  person who made it** (their role ∩ the agent's) and answers in a room or in that person's chat.
  The API checks every 30 s; a due routine is claimed once (its next time moves first); one more
  than an hour late (the API was down) only moves on. Every member makes their own; its maker or
  someone who can change Settings changes, pauses, runs now or deletes it. Agent › Settings ›
  Routines; after an approved change in a page's panel, **Make it a routine** (every day at a time).
  Messages of a routine's run say "routine “name”"; the side list says "Idle · next 18:00".
- **Events**: `src/events.ts` — services say what happened after it is saved (`createWeeks`, a
  campaign going from draft to confirmed); listeners never stop them.
- Write previews now keep the day (`fill_day`) and dates (`book_campaign_spots`) they showed, so an
  approval later applies exactly that; a change card names what it changes (`target`).

## Phase C1 — built 2026-11-17

User: "ok faze c ro anjam bedim"; "C1 alan, C2 baad"; approving a day asks twice, export later;
chained changes go on after the approval. New tools in `apps/api/src/mcp/changes.ts` (the MCP
clients of 0023 get them too, except approving / reopening a day), each with preview, apply at
the version the preview showed, and undo_change:

- **Playlist**: `edit_day` — replace the item of a row, take rows out, put a catalog item in after a
  row or at the end of a block, move a row (rows named by the code `get_day_playlist` now shows,
  "row 3f9a1c2e"; breaks and gap holders stay; an item without a length is refused);
  `approve_day` and `reopen_day` (agents only; "Read and change" on Playlist lets an agent prepare
  them, and the role must approve days).
- **Layouts**: `get_layout` (read: blocks per weekday with codes, block types) and `edit_layout` —
  add a block of a type at a time on weekdays, take out, move, change its length; checked as a save
  is (`templateProblems`); weeks made already keep their blocks.
- **Media**: `edit_media` — title, episode, length, starts / expires, media state, notes of an
  item (only those fields are written, at its version); `add_to_rotation_list`.
- **Ads**: `confirm_campaign` (a draft → confirmed: routines on "a campaign is confirmed" start) and
  `remove_campaign_spots` (bookings over a range, optionally only some breaks or weekdays).
- **Approving twice**: a change that puts a day on air (`approve_day`) needs a second "yes" — the
  card says "Puts the day on air: you approve it twice", Approve opens "Approve this day for air?",
  and the server refuses an approval without `confirm: true`. Deciding a change needs the grant its
  tool needs (`TOOL_GRANT`: approving days needs Playlist › Approve).
- **Chained changes**: a write tool takes `then` ("what you do next once this is applied"); after
  the approval the agent goes on by itself (an "approved" run in the same room or chat) and prepares
  the next change with a preview that is now right. Shown on the card as "Then it goes on: …".
- **Preview on the Day grid** for both day changes (`fill_day`, `edit_day`): the server works it out
  (`GET /api/agents/changes/:id/day`), new or changed rows are green.
- Migration `20261117070152_agent_change_then` (`agent_change.then`).

**C2** — Scheduling, built 2026-11-17 with decision 0025's Scheduling tools (0025 "Scheduling tools
(6.3)"): an agent with Scheduling "Read and change" prepares plans — create, change, place airings,
take out, move episodes, replace items, move airings, duplicate, split, delete, confirm (asked once)
— each a change card a person approves. Later: exporting a day once automatic exports exist.

## Rejected

- An Agents page with a settings form per agent and a separate desk (first draft).
- Five fixed agents, one per part, without new agents, chats per agent or hand-offs (second draft).
- Changes without approval (offered to the user, not chosen).
- A model on 9eye's server; going through the providers' remote-MCP features (needs 9eye on the
  internet and splits the loop; approvals, limits, rooms and logs stay in 9eye with the runner).
