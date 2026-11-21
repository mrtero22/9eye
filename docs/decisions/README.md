# Decisions

One file per decision. Status is **Accepted** (the user decided) or **Proposed** (waiting for the
user). Do not re-open an accepted decision unless the user does; to change one, add a new file that
supersedes it. Numbers 0002, 0010–0014 and 0020 are internal notes, kept outside the repository.

| # | Decision | Status |
|---|---|---|
| [0001](0001-global-product.md) | A global product for any channel concept; no single company is the target design | Accepted 2026-10-15 |
| [0003](0003-ui-design-system.md) | One design system: Light + Dark, English, neutral (density superseded by 0009) | Accepted 2026-10-15 |
| [0004](0004-time-model.md) | Integer frames, fps per channel, optional time zone per channel | Accepted 2026-10-15 |
| [0005](0005-configurable-core.md) | Fixed core + channel profiles + rules + plugins + modules | Accepted 2026-10-15 |
| [0006](0006-billing-later.md) | Sales and billing come later | Accepted 2026-10-15 |
| [0007](0007-tenancy-and-roles.md) | Shared database with tenant isolation; roles = module × action × scope | Accepted 2026-10-15 |
| [0008](0008-mam-adapters.md) | Any MAM through adapters; our own MAM later, same interface | Accepted 2026-10-15 |
| [0009](0009-calm-ui.md) | Calm UI by default, Compact per user; progressive disclosure; Home; top nav (bottom bar on phones) | Accepted 2026-10-15 |
| [0015](0015-a-new-product.md) | **A new product in name, words and code:** our own data model, API, screens and words; nothing copied; made-up names only | Accepted 2026-10-16 |
| [0016](0016-template-break-addons.md) | Template breaks are picked from the ads template (never typed) and can be applied to many blocks at once | Accepted 2026-10-17 |
| [0017](0017-code-stack-and-layout.md) | Code stack and layout: npm workspaces, shared core, Express + Prisma + Postgres, React + Vite + Tailwind + Radix | Accepted 2026-10-17 |
| [0018](0018-repeat-a-time-range.md) | Templates: repeat a time range, creating the block types for each copy (all-or-nothing) | Accepted 2026-10-17 |
| [0019](0019-broadcast-history-from-playlists.md) | Broadcast history comes from 9eye's own playlists, later from as-run | Accepted 2026-10-22 |
| [0021](0021-sign-in.md) | Sign-in: e-mail and password, a session cookie, every page and API route behind it; too many tries lock it | Accepted 2026-10-27 |
| [0022](0022-public-website.md) | The public website: static Astro site in `apps/site`, AI-first, two plans per channel; noindex until the brand and domain are final | Accepted 2026-10-27 |
| [0023](0023-mcp-server.md) | MCP server inside the API (`/api/mcp`) for Claude, ChatGPT, Grok or own agents; personal access tokens; a role rule on every REST route; an audit log; in phases — read only first, writes on drafts only, never approve or export | Accepted 2026-11-16 |
| [0024](0024-agents.md) | Agents as a team (model: Grok Bot): make any number, each with its chat and settings; rooms where they hand work to each other; the agent in every page; everything with a person's approval; a runner in the API on the company's own Claude / ChatGPT / Grok key | Accepted 2026-11-17 · phases A, B, C1, C2 built |
| [0025](0025-ai-permissions.md) | What AI may do: one table in Settings › AI access, parts × actions (Read · Change · Create and delete · Approve · Export), each Allowed / Ask first / Off, presets, narrower per token and agent; a tool with preview and undo for every action, Channels and Layouts first | Accepted 2026-11-17 · built: the table and every tool group (Channels and Layouts, Scheduling, Ads, Media, Playlist) |
