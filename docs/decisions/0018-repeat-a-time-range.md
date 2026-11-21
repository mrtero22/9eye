# 0018 — Templates: repeat a time range, creating the block types for each copy

Status: **Accepted** 2026-10-17 (user: "ok besaz")

## Context

A block type is used at most once per day: linked breaks point at an ads
block through its block type, and orders will point at blocks the same way. An ads template with
several breaks an hour therefore needs a separate block type for every break of every hour (well
over a hundred a day).
Building one hour by hand is quick; repeating it for 23 more hours meant creating ~140 block types
and placing ~140 blocks one by one.

## Decision

The Templates page has **Repeat a time range…** (a day's ⋯ menu):

- The blocks of one range of a day (default: the hour of the selected or first block) are repeated
  every interval (default 1 hour) until the end of the day (or a chosen time), on chosen days.
- Each copy gets its own block types, copied from the original's settings: either the **next
  number of each series** (sp 5, sp 6 …; existing unused ones first) or the **name with the copy's
  time** (sp 1 09:00 …).
- A live preview tells what is created, reused and placed. **All or nothing:** any overlap, a type
  already used on a day, a block crossing the range end, or linked breaks that do not fit by
  position (main templates, 0016) stop everything; the new block types are created in one
  transaction, and the blocks are one undo step of the template.

## Consequences

- The model is unchanged (still one block type per block per day); the tool only does the
  repetitive work. Block types created by a repeat stay in the library if the template change is
  undone; unused ones can be deleted.
- API: `POST /api/block-types/bulk` creates several different block types all-or-nothing.
