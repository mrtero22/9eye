# 0008 — MAM connection through adapters

**Status:** Accepted, 2026-10-15 (user).

## Context

Every company may run a different MAM (Compact MAM, for example). Later we will
build a MAM of our own for 9eye, but 9eye must still connect to any MAM.

## Decision

- The core never depends on a specific MAM. A tenant configures zero or more MAM connections; each
  one is an **adapter** implementing the same interface (decision 0005, plugins).
- First adapter: Compact MAM.
- Our own future MAM connects through **the same adapter interface** as everyone else's — no
  private shortcuts — so third-party MAMs stay first-class.
- **No-MAM mode:** media can be registered by hand or imported from a file (CSV), for customers
  without a MAM or with one we have no adapter for yet.

## What the core needs from any MAM

| Need | Used for |
|---|---|
| Search / list assets, get one by ID | Catalog |
| Duration and frame rate | Timing, validation |
| Segments: SOM / EOM, break points (trims) | Splitting programs into parts around breaks |
| File name / location | Export to playout |
| Technical metadata: aspect, audio tracks, subtitles | Validation, compliance |
| Readiness / QC status | "No media" and "not ready" warnings before air |
| Proxy URL, thumbnails (optional) | Preview in the UI |
| Change feed: webhook or polling cursor | Keeping the catalog in sync |

The core keeps its own media record (asset ID + which adapter) mirrored from the MAM, so scheduling
keeps working while a MAM is unreachable; the UI shows each record's sync status.

## Open

Compact MAM: API documentation and test access are still needed.
