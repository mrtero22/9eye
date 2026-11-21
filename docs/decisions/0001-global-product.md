# 0001 — A global product for any channel concept

**Status:** Accepted, 2026-10-15 (user).

## Decision

9eye is a commercial product, sold to TV companies anywhere in the world. Every company and channel
may run a different concept, and all of them must be able to use it. No single company — the
sample company Aurora Media included — is the target design.

## Consequences

- No AURORA-specific logic in the core: Aurora Media's box names, broadcast-day start, week start, catalog-list
  rotation, ident patterns, Playout XML export and so on are configuration or plugins.
- What we learn from any one channel or system is research input, not a requirement list.
- Design for every channel type; ship v1 for a chosen segment.
