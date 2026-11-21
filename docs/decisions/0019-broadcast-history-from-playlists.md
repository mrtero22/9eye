# 0019 — Broadcast history comes from 9eye's own playlists, later from as-run

**Status:** Accepted, 2026-10-22 (user).

## Context

The Catalog's Relations dialog has a **Broadcast history** tab for productions. Where the history
comes from decides whether it can be trusted: a history kept apart from the playlists is easily
empty, even for episodes that aired the week before.

## Decision

- 9eye fills Broadcast history from **its own playlists**: every event of the production in a
  published day playlist whose start has passed, per channel: date and time, block, playlist.
- When Reconciliation (as-run) exists, a matched as-run line replaces the planned one and is marked
  as aired; unmatched planned lines stay marked "planned".
- The tab shows the source of each line ("Playlist" / "As-run") and the total per channel.

## Consequences

- The tab is useful from the first day, without as-run.
- The history is only as good as the playlists until Reconciliation is built.
