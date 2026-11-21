# 0006 — Sales and billing come later

**Status:** Accepted, 2026-10-15 (user: "foroosh va billing ro badan ok mikonim").

## Decision

v1 has no ad sales, rate cards, GRP guarantees, invoicing or billing. They will be added later,
either as an optional module or by connecting to the customer's own billing system.

## Consequence

Keep the data model open for it: orders carry price fields as optional data, and nothing in the core
assumes they are absent forever.
