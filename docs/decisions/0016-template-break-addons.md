# 0016 — Template breaks: picked from a list, applied to many blocks

Status: **Accepted** 2026-10-17 (user)

## Context

In a template, each block holds its linked breaks (external containers) in order, plus one
zero-length gap compensator. Where every break is a hand-placed
row named after its hour (`Ad Pod 06:30`), a 24-hour main template holds hundreds of them, and
hand-typed break titles lead to wrong or missing placements.
Leading systems define a reusable break format per programme / slot type (SMPTE BXF "Format",
CreateCtrl ad break schemes) instead of placing each break by hand.

## Decision

On top of the basic template editing, the Templates page adds two things:

1. **Breaks are picked, never typed.** "Add break" offers the blocks of the channel's ads template
   (with their capacity); the name cannot be typed freely.
2. **Apply to other blocks.** The breaks of one block can be applied to: the same block type on
   other days, all blocks of the same block group, or all blocks of the same length — on chosen
   weekdays. Each break is matched by its **position among the ads-template breaks inside the
   target block's time** (1st, 2nd, …), never by its name — names differ per company and channel
   (amended 2026-10-17). If any target block has no break
   at that position, nothing is applied and the blocks are listed.

The basic editing stays: add / reorder / remove breaks, external container lists ("Use a list",
new / save / manage lists — each channel's own data, no built-in lists), link to the matching
ads-template block, gap compensator. A channel without an ads playlist has blocks without breaks.

## Consequences

- The data model stores a block's breaks as references to ads-template blocks, not free text.
- "Apply" writes the same result as doing it by hand block by block; it is a bulk operation and
  follows the all-or-nothing rule.
