# 0009 — Calm UI: lots of information, never a crowded screen

**Status:** Accepted, 2026-10-15 (user). Supersedes the density part of 0003.

## Context

The user liked the first mockups but found the pages a little crowded ("sholoogh"). A new user
must not feel intimidated when they open a screen, while operators still get all the information.

## Decision

- **Calm is the default density:** 14 px text, 13 px small text, 32 px rows and controls.
- **Compact is a per-user setting** (13 / 12 px, 28 px) for power users. Both are the same
  components; only density tokens change (`--fs`, `--fs-sm`, `--row`, `--ctl`).
- **One thing at a time (progressive disclosure):** summary first, details on demand. Detail panels
  open only when something is selected and can be closed. Rare actions live in a "…" menu.
- **One focal point per screen:** e.g. the playlist's build pipeline and issues collapse into a
  single status line ("5 of 7 steps done · 2 issues") that expands.
- **Space, not boxes:** whitespace and hairlines instead of borders; never a card inside a card.
- **Quiet context pickers** (channel, subchannel, date) as text buttons under the page title, not a
  toolbar of bordered controls.
- **Navigation (revised the same day, user):** a slim **top bar** on desktop — company switcher,
  module links (Home, Catalog, Grid, Playlist, Orders, As-run, Reports), search, user menu — and a
  **bottom tab bar on phones** (Home, Schedule, Playlist, Orders, More). The module was first
  called "Grid"; renamed **Schedule** because after 0010 there is no weekly grid
  object — it has two tabs: **Week** (real dates: placed programs, exceptions, day status, "Place
  program") and **Templates** (patterns with validity periods, slot settings, impact preview). No sidebar: the week grid,
  playlist and detail panel need the width. Admin, UI kit, theme and density live in the user menu.
  Sub-sections of a module are tabs under the page title. More than ~8 modules → "More ▾".
- **Home page "Needs attention"** is where users land, not a dense grid.

Mockups v2 (private): Design system, Home, Week grid, Day playlist, Admin.
