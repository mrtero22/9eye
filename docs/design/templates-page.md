# Templates page — agreed design (build reference)

The page for building each channel's template. Agreed with the user over 2026-10-16/17.
Mockup source: the Week mockup (private). Build it to look and behave like that mockup.
Decisions 0015, 0016.

## What the user said

- The page is **"Templates"**, not "Schedule" or "Scheduling". "Scheduling" is a different page,
  not designed yet.
- It is for building the template of each channel. UI / UX must be **simple, clear and easy**.
- Look = the calm mockups of 2026-10-15. Bolder layouts (horizontal timeline, outline + cards)
  were rejected.
- Weekly grids (dated copies, month view) are **not** on this page; they are on the Weeks page
  ([weeks-page.md](weeks-page.md)).

## Layout

1. **Page header**: "Templates"; channel picker (dropdown with search over all channels); the
   channel's settings as text ("Week starts Saturday · day starts 06:00 · 25 fps", from the channel,
   never hard-coded) and a link **Change in channel settings** (Admin → Channels → this channel). Right: Unsaved-changes badge, Undo, Redo, **Block types**, **Add block**,
   "⋯" menu, **Save** (primary, enabled only with changes).
2. **Left**: the channel's templates grouped "Main playlist" / "Ads playlist", each with name,
   "In use", valid period. A channel may have several (AURORA COMEDY SD main has 2) or main only.
3. **Status bar** above the grid: template name, "Valid <from> → <to>" with **Change dates**
   (from = first day of the channel's week, to = last day), active-day toggles (Sa…Fr).
4. **Week grid**: 7 columns (weekday names only, no dates), hour axis from the day start; blocks
   in their block-group colour with name and time; a link icon with the block's break count; zoom
   − / +. Column header: day name + "Same as <first day>" / "Own layout" / "Not active", and a ⋯
   menu: Copy this day to… (checkboxes; replaces those days), Add a block on this day,
   Make this day active / not active.
5. **Right panel** (one at a time): **Block**, **Add block**, **Block types**.

## Block panel

- Name, day, time; block type with Change; start and length (timecode of the channel); switches
  "Fill gaps from rotation list" and "Opens with linked break"; note; All details; Remove block.
- **Linked breaks** (main template only), in order: number, colour, name, capacity (the length of
  the ads-template block, e.g. 5 / 18 min), ↑ ↓ to reorder, ↗ open that block in the ads template,
  × remove. Last line: "Ends with a gap compensator (length 0), added automatically".
  - **Add break**: list of the ads-template blocks for the block's hours (and the next hour), with
    capacity; already used ones disabled; search over all. Names are never typed (0016).
  - **Use a list**: the channel's own break lists (no built-in lists), plus New list…, Save these
    breaks as a list…, Manage break lists….
  - **Apply to other blocks…**: scope = same block type on other days / all blocks of this block
    group / all blocks of this length; weekday toggles; preview "N blocks get these K breaks".
    Matching is by **position among the ads-template breaks inside each target block's time**
    (1st, 2nd, …), never by name. If any target has no match: list them, Apply disabled, nothing
    changes (all-or-nothing).
- On an **ads-template** block: "Linked from the main template" — which main blocks on which days
  use this break, each opening that block.
- A **main-only channel** says it has no ads playlist; its blocks have no breaks.

## Add block panel

1 · Where: day, start (default: right after the selected block). 2 · Breaks inside: a break list
of the channel (main template only). 3 · Block type: searchable list with group and length.
Blocks may not overlap.

## Block types panel (library)

Search; New; scope "In date" / "All dates" / "Other channels";
channel filter; collapsible block groups with their block types and a ⋯ menu each.

## "⋯" menu

New template…, Clone this template…, Rename…, Linked-break lists…, Print, Download EPG…,
"Show on blocks": block headers / block events / overlap / notes (check items), Delete template….

## Done when

Everything above works against: the sample AURORA SD main + ads templates; a
main-only channel whose week starts Monday (scenario B); a 29.97 drop-frame channel (scenario C,
times shown with `;`). Save / Undo cover every change.

## Built (2026-10-17, session 3)

`apps/web/src/features/templates/` on the shared components; API in `apps/api`; rules in
`packages/core`. Covered by e2e tests (`apps/web/e2e/templates.spec.ts`). Choices made while
building, to confirm with the user:

- **Break lists store positions** (1st, 2nd, … ads-template break inside a block's time), not
  names, following the position rule of 0016 — so one list fits every hour. "Use a list" shows,
  per list, the breaks it gives this block or why it does not fit. "New list…" picks positions,
  with example names from the selected block.
- **Add block** starts at the end of the selected block, else at the first free time of the day.
  The block-type list offers the template's own playlist first, then the same kind of playlist of
  other channels (AURORA SD uses LUMEN SD's and AURORA FIT SD's block types); a type already used that
  day is shown but disabled (a block type is used once per day).
- **Rename** and **Change dates** are draft changes (saved with Save, undoable). New, Clone and
  Delete template act at once (with the unsaved-changes question first).
- **Download EPG…** is in the menu but disabled until EPG exports exist. **All details** shows the
  block's full data; limits per content type and the rotation list are edited once the catalog exists.
- Times of a 29.97 drop-frame channel: the first label of a minute (`18:12:00;02`) is shown as
  `18:12`; lengths in words are real time (a 2-minute break shows "2 min").
- **Drag and drop** (added 2026-10-17 on the user's request): drag a
  block type from the Block types panel or from the Add block list onto a day to add a block (from
  Add block it also gets the chosen break list, refused where the list does not fit; the panel
  stays open for the next one); drag a block to move it to
  another time or day; hold Ctrl or Alt to copy it. Snapping follows the zoom: 1-minute steps when
  a minute is at least 2.5 px tall (5-minute steps otherwise), and a block sticks to a neighbour's
  edge or the day's start / end only within 6 px (8 px when placing by clicking); a dashed preview shows the time, red with the reason where it
  cannot land (overlap, already on this day, not valid on this day, past the day end). A move keeps
  everything of the block, its linked breaks too (as changing its start does). Each drop is one
  undo step. The week grid also draws a line at every hour.
- **Place by clicking** (user, 2026-10-17): Add block has "Add at a time" / "Place on the grid";
  in the Block types panel a click on a name does the same. The picked block type is armed (a bar
  above the grid: "Placing 1H RUN (1–6) … Esc to stop"); every click on an empty spot of a day adds
  it there (same snapping, edges within 8 px), with Add block's break list. On a day that already has it, the next type of its
  numbered series goes in (same group and name before the number: RUN 1 → RUN 2 → …); when the
  series is used up on that day, the click is refused with the reason. A hover preview shows time
  and block type. Each click is one undo step; Esc, Stop, closing the panel or another template ends it.
- **Zoom** (user, 2026-10-17): eight levels, 24 to 400 px per hour, so 5-minute ads breaks show
  their name; zooming keeps the hour in the middle of the view; main and ads templates each keep
  their own zoom in this browser.
- **Repeat a time range…** (day ⋯ menu, decision 0018): repeats the blocks of a range (default:
  the hour of the selected or first block) every interval until the end of the day, on chosen days;
  each copy gets new block types — next numbers of each series (unused existing ones first) or the
  name with the copy's time. Live preview of what is created / reused / placed; all-or-nothing.
