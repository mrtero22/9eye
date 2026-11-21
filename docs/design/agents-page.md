# Agents: a team in rooms, one page per agent, and the agent in every page (build reference)

Decision [0024](../decisions/0024-agents.md) (accepted; phases A, B and C1 built 2026-11-17). Model: Grok Bot (https://x.ai/bot) — its
way of working, in 9eye's own look and words. Mockups (2026-11-17, third version):

- [mockups/AgentTeam.dc.html](mockups/AgentTeam.dc.html) — Agents: the sidebar and a **room**
  where agents hand work to each other.
- [mockups/AgentProfile.dc.html](mockups/AgentProfile.dc.html) — **one agent**: Chat, Settings,
  Work done; the **New agent** gallery.
- [mockups/PlaylistAgent.dc.html](mockups/PlaylistAgent.dc.html) — the **agent in a page**
  (Playlist): the panel and the preview on the grid.

Status: **phases A, B and C1 built** 2026-11-17 — `/agents` (Waiting for you, rooms, agents: Chat,
Settings with Routines, Work done; New agent gallery), Settings › AI access › Keys for agents; the
Agent button and panel on Scheduling, Playlist, Ads, Media and Layouts, with the preview on the Day
grid and "Make it a routine". Not yet: "Approve both" (built instead as "Then it goes on": the agent continues after each approval), the agent's own "Run
now" in its header (Run now is per routine), the preview on the other parts' pages; Scheduling's change tools (phase C2). Phase C1 added the
change cards' "Puts the day on air: you approve it twice" and "Then it goes on: …", and the preview
of row changes on the Day grid. In the build the gallery has
Day reporter instead of Rights watcher. Sample data in the mockups is the fictional Aurora Media.

## Agents (top bar, count of what waits for a person)

**Sidebar**: New agent · **Waiting for you** (count) · **Rooms** (# playlist-checks, # ads-desk, …;
a dot when there is something new) · **Agents** (mark with a state dot — idle green, working blue,
waiting for you amber, off grey — and a status line: "Idle · next at 18:00", "Working · AURORA TV SD
18 Nov") · a quiet line "Providers and keys are in Settings › AI access".

**A room**: title and who is in it; messages from people and agents (an "agent" tag, time, and for
a routine "· routine "Check tomorrow""); an agent's findings as a short list with **@mentions** of
the agent that should fix each; replies by those agents indented under the message (a thread); a
**change card** (state: Waiting for you · Approved · applied · Rejected; what and where; Approve /
Review on the page / Reject; "Approve both" for chained changes); the follow-up ("Done: version 9.
@Playlist checker please check again" → "Checked again: fine now ✓"); a person's correction and the
agent's "Saved to its memory: …". The box: "Message #room — type @ to bring in an agent". Footer:
"Agents hand work to each other here and everyone sees each step. Every change waits for a person."

## One agent

Header: mark, name, its job, state, **Run now**. Tabs:

- **Chat** — only the person and the agent. The agent answers, works, and for a lasting instruction
  shows a **skill change** card (the skill with the new line marked green) with **Save to its skill**
  / **Only this time**; a small preference becomes "Saved to memory: …". The box: "Tell <agent>
  what to do, or how to work from now on…".
- **Settings** — **About** (name, its job, model, acts as), **What it works on** (Playlist,
  Scheduling, Ads, Media, Layouts: Read · Read and change · Nothing; its channels), **Skill** (text;
  who changed it last and where; History), **Memory** (what it learned and from whom; remove),
  **Works with** (agents it may hand work to; its rooms; "A hand-off goes at most 3 agents deep"),
  **Routines** (time or event + the request), **Limits and use**.
- **Work done** — its runs: what, when, where, state.

**New agent** (dialog): a gallery of jobs (mark, name, one line, parts) — Playlist checker, Gap
filler, Media fixer, Ads booker, Weeks builder, Rights watcher — **Start empty**, or "describe it,
and the agent writes its own skill for you to check".

## The agent in a page

As drawn on the Playlist page: the **Agent** button (pressed while open) → a panel with the part's
agents, "Sees this page: …", the conversation with folded steps, change cards, quick actions, the
box; the change previewed on the grid (new rows green with "new", what stays amber) with Reject /
Approve and save; after approving, "Make it a routine". Same panel on Scheduling, Ads, Media, Layouts.

## Not in the first build

Changes without approval; agents across companies; cost in money (tokens only).
