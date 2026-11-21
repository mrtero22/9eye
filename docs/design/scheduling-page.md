# Scheduling page — design (build reference)

The page for placing programmes, promos, idents, music clips, jingles and graphics into a
channel's template blocks over a date range. Proposed 2026-10-17, reworked into two steps on
2026-10-18, **Approved 2026-10-18**. Mockup source:
the Scheduling mockup (private) (all three screens in one file; the
boards SchedulingOrder / SchedulingNew open it on the order and new-order screen), with sample LUMEN
PLUS HD data for the week of Sat 17 Oct 2026. Build it to
look and behave like that mockup. Decision 0015.

## What the user said

- Promo, ident and music orders are on this page too, with a filter (2026-10-17).
- The page name was left to us: **Scheduling**, in the top navigation between Templates and
  Playlist. Commercial orders (under contracts) stay for the later "Orders" page.
- Look = the calm mockups of 2026-10-15; our own arrangement and wording.
- **2026-10-18:** the one-page design (order list + week + right panel) was too crowded. Make it
  **two steps**: first a page with the list of orders and their facts; clicking one opens a page
  with only that order; **New order** opens its own page. Pages that show a schedule have **only a
  left sidebar and the schedule grid — no right panel**, so the grid keeps its full width.
- **2026-10-23:** Quick placement also places **repeats**: while it is on, every first airing of
  the order shows a small copy button; pressing it makes clicks on empty blocks add repeats of that
  first airing (asked by the user). It never refuses a block another
  programme order holds: it places there as usual; the block's panel and the order's issue warn.
- **2026-10-23:** **Shift airings…**: the pattern (airing days, blocks, repeats) never changes; the
  episodes move N airing days — past airings too (no "from tomorrow" limit). Later: the chosen
  episode and the ones after it, its day empties, the weekly pattern goes on at the end. Earlier,
  the mirror: the chosen episode and the ones before it, its day empties, the weekly pattern goes on
  before the start (asked by the user, 2026-10-23).

## Screen 1 · Order list (the Scheduling page)

1. **Header**: "Scheduling"; channel picker (search over all channels); the channel's week start,
   day start and frame rate as text (from Channel settings). Right: "⋯" (export the list, print,
   columns) and **New order** (the page's one primary action).
2. **Filters**: search; mode chips with counts (All, Series, Programmes, Promos, Jingles, Graphics —
   all five modes always offered); Status (All / Confirmed / Draft); Dates (running this week /
   starting later / ended / any dates); **Needs attention** with its count.
3. **Table**, full width, grouped by mode (group row: "Series 9 · episodes in list order"):
   Order (colour, name) · Mode · Status · Dates ("23 Sep 2026 → 22 Nov 2026", "Ends soon") · This
   week (series: "Sat–Thu · 15:00" / "Ep. 21–26 · 6 first, 36 repeats"; promos: "4 passes a block" /
   "Every day, every hour") · Progress (series: bar + "20 of 40 aired"; promos: items) · Needs
   attention (the order's first issue in amber) · row "⋯" (Open, Duplicate…, Split…, Report,
   Delete…). Order and Dates sort. Clicking a row opens Screen 2. Footer: "13 of 13 orders running
   this week · 177 orders on LUMEN PLUS HD in all".

## Screen 2 · One order

1. **Header**: back link "Scheduling · LUMEN PLUS HD"; order name with its colour; Confirmed / Draft,
   mode, dates, progress. Right: Unsaved-changes badge, Undo, Redo, **Copy week to the whole
   order**, "⋯" (order actions and "Show in the week": other orders' programmes, linked breaks,
   block names), **Save**.
2. **Left sidebar** (about 300 px), one of two views:
   - **Order details** (default) — see "Order details" below.
   - **Block** — opens when a block is clicked, with "‹ Order details" to go back; see "Block"
     below.
3. **Schedule grid** (the rest of the width):
   - Week bar: the shared date picker in week mode (‹ › one week, limited to the order's dates);
     **This order / All programmes**; legend; **Calendar / Table**; zoom − / +.
   - Grid: 7 columns of the channel's week with dates; hour axis from the day start (rows after
     midnight belong to the same broadcast day); one cell per template block. Column header: day,
     date and a short count ("1 first · 5 repeats"; with All programmes: "2 without a programme").

## Screen 3 · New order

Same frame as Screen 2. Header: back link, "New order", "LUMEN PLUS HD · saved as a draft until you
confirm it"; Cancel and **Create draft**. Left sidebar: the form (see "New order form"). Grid: a switch on the week bar, **Empty / Confirmed programmes** (user, 2026-10-18). Empty = the
channel's template blocks only, with their names. Confirmed programmes (default) = every programme
of a confirmed order already placed (drafts left out) and the free blocks marked "Free", so the
operator sees where the new order can go. It cannot be clicked until the draft exists. After
Create draft the page becomes Screen 2 of the new draft, on its first complete week.

## Week grid cells

- **This order, series / programmes**: first airing = filled with the order's colour and a strong
  left edge, episode title, "First airing"; repeat = light fill, "Repeat" (just the word; the day
  distance is shown in the Block sidebar and the table, user 2026-10-18); another order's programme = plain text in grey (hidden when "other orders" is off);
  a block without any programme = dashed amber "No programme".
- **This order, promos / jingles / graphics**: light fill with the number of passes as a chip
  ("4×"), the programme underneath in grey; days outside the order's dates are hatched.
- **All programmes**: every block in its programme order's colour, first airings strong, repeats
  light; a click opens that order on that block.
- Optional: linked-break count per block, block-type name as the second line (zoomed in).
- Click = select the block (ring) and show it in the left sidebar.

## Order details (left sidebar)

- Issue box (amber) with one action, e.g. "Last episode airs Mon 26 Oct; no order places a
  programme at 13:00 after it" → New order from Tue 27 Oct…; "Draft: its 6 passes in every block
  are left out of the playlist" → Confirm order; "Ends Mon 19 Oct, no other series-promo order"
  → Change end date….
- Status **Confirmed / Draft**; dates (start and end picked apart, `StartEndPicker`; user,
  2026-10-23); template (from the channel);
  limits (maximum airings, time windows) with Edit.
- Series: first episode to place; **Start again when episodes run out** (reuse the items in a
  loop).
- **Episodes / Items**: count, Add from catalog; series progress bar (aired / this week / later /
  not placed) and the list around this week with state; Show all.
- Series: **This week's pattern**, read from the week: first airings (days · time), regular
  repeats grouped by day distance ("Same day 19:00, 23:00, 03:00, 07:00", "Next day 11:00"), other
  repeats ("9 on Sat, Fri, Thu, some replay last week"); last first airing vs. the order's end.
- Promos: **Passes** (per block, days, total this week) and **Rotation…** (passes per day, share %
  per item totalling 100 %, Equal shares, Place).
- All fields, Report.

## Block (left sidebar)

"‹ Order details"; block-type name; day, date, time range.

- **In <order>**, by case:
  - First airing: episode, "episode 21 of 40", Change episode…, Remove; **Repeats** of it (day,
    time with the calendar day for night hours, distance) — each opens that block; **Add repeat**
    (when: same broadcast day … +6 days; block).
  - Repeat: "Repeat of …", "First aired Thu 15 Oct · +2 days", Change what it repeats… (previous
    days / episodes), Open first airing, Remove.
  - Empty for this order: Add first airing, Repeat an earlier airing…; when another order already
    has a programme here, an amber warning names it first.
  - Promos: passes in this block (− / +) and the items placed in it.
- **Other orders in this block** with what they place (episode, passes, draft) — each opens that
  order.
- **From the template**: the block's linked breaks (filled in the ads template).
- **Block colour in this order** (grey is kept for blocks without airings).
- Delete this order's airings here (only this order's).

## Order "⋯" menu

Quick placement (click empty blocks to add first airings, a bar with Stop / Esc, like "Place on the
grid" in Templates; the copy button on a first airing switches the clicks to its repeats — same rules
as "Add repeat", kept across weeks; pressed again, or Esc, goes back to first airings, and a second
Esc stops), Auto-place…, Rotation… (promos), Split order…, Move airings…, Shift airings… (programme
orders: "From this first airing" — the selected block's first airing by default —, Airing days,
Later / Earlier; a live preview: how many episodes move, the airing days left empty, the new ones
from the weekly pattern, or why nothing moves — the order ends (later) or starts (earlier) too
soon, a new airing on a block this order uses; blocks of other programme orders are only named),
Replace items…,
Refresh durations, Duplicate order…, Report, Clear all airings…, Delete order….

## Copy week to the whole order

Popover from the header button: "Copies 17 – 23 Oct to the other 9 weeks of the order (23 Sep 2026 →
22 Nov 2026)". Checks: complete week of the channel inside the order (else amber: pick a complete
week); counts of this week's first airings and repeats (empty week → amber: copying empties the
other weeks); repeats that replay last week, carried in a second pass. Result line ("40 first
airings and about 240 repeats; episodes 1–40, the last on Sun 8 Nov; 0 blocks taken by other
orders"). All-or-nothing.

## New order form (left sidebar of Screen 3)

1 · How it places items: five mode cards, each with its one-line description. 2 · Where and when:
channel chip ("+ Channel" makes a multi-channel order, explained in its tooltip; the template is
in the chip's tooltip), Name, Dates (start and end picked apart, from today on). 3 · Episodes / items:
shared catalog picker. After the pick the step shows the picked list in the same shape as the
order's Episodes section (user, 2026-10-18): count with **Add from catalog** on the right, a line
with total length and how many have no length, the list (number, title, length, × to remove),
**Show all N**. In an existing order, items added from the catalog join the end of the Episodes /
Items list marked **Added** until saved.
Below step 3, as on the order page: **First episode to place** (series; defaults to the first
picked episode) and **Start again when episodes run out** (series), then **Limits** with Edit (all
modes) — they shape what "Copy week to the whole order" creates, so they are set before it. No help lines
under the fields (user, 2026-10-18: too much text); the page header already says it is saved as a
draft until confirmed.

## Table view

The order's airings of the shown week: select, Day, Time (night hours with the calendar day),
Block, Episode / Items, Kind ("Repeat · first aired last Thu") / Passes. Bulk edit… and Delete for
the selected rows. A row opens its block in the calendar.

## Rules

- All operations show what will change first and are all-or-nothing.
- Week and broadcast day come from the channel; repeat distances count broadcast days.
- Two programmes in one block are allowed but always warned before and listed as an
  issue. Quick placement is the exception (user, 2026-10-23): it places without a warning before;
  the block's panel lists the other order and the order gets the issue.
- Times go through the channel's timecode format (29.97 drop-frame channels show `;`).
- No other product's names or wording in the UI.
- Every date (week bar, order dates, new order, split, replace) uses the shared date picker
  ([date-picker.md](date-picker.md)).
- Every pick from the catalog (new order items, Add from catalog, replace items) uses the shared
  catalog picker ([catalog-picker.md](catalog-picker.md)).

## Done when

Everything above works against the sample LUMEN PLUS HD orders (series with
alternating days, a weekly replay day, the three ident orders and the series-promo order); a
main-only channel with a programmes-mode order (scenario B); a 29.97 drop-frame channel
(scenario C). Save / Undo cover every change.

## Decided with the approval (2026-10-18)

- The two-step design is approved.
- Status names: **Confirmed / Draft**.
- Idents and music stay promo-mode orders; the mode filter is enough — no sub-filter under Promos
  for now.

## Built (2026-10-22) — choices made while building, to confirm with the user

Code: `apps/web/src/features/scheduling/`, API `apps/api/src/services/orders.ts`, shared rules and
operations `packages/core/src/orders.ts`. Addresses: `/scheduling?channel=…` (list),
`/scheduling/new?channel=…&from=…`, `/scheduling/<order>?week=…&date=…&block=…&view=table|report&ch=…`.

- **Every change is local until Save** (one undo step each): placing, repeats, passes, colours, status,
  dates, items, Copy week, auto-place, rotation, replace items, refresh durations, clear, bulk edit.
  Split, Move airings, Duplicate and Delete work on the saved order (they say "Save first").
  Leaving the order with unsaved changes asks: Cancel, Save and leave, Discard changes.
- **Copy week** works in one pass: first airings of every week of the order are numbered
  again from the first episode to place (series), then every repeat of the reference week follows
  its first airing — also repeats that replay the week before. Repeats outside the reference week
  are not copied. It replaces the channel's other weeks; the popover names blocks other
  programme orders hold, items that run out and repeats left without a first airing.
- **Quick placement / Add first airing** give the new first airing the next episode at once (the
  episode after the one before it in time) — the mockup said "when the week is copied".
- **Issues** are computed on read, one per order, in this order: nothing placed (any more) while the
  order runs · two programmes in one block (from today) · a confirmed series whose last episode airs
  within 14 days and whose blocks nobody takes after it (fix: New order from the next day) · a draft
  with airings to come (fix: Confirm order) · episodes never placed · a promo order ending within
  14 days with no confirmed order of its mode and content type after it.
- **Auto-place**: series / programmes need an allowed time
  window and fill every block inside it day by day with the next item, skipping blocks other
  programme orders hold; promos / jingles / graphics put N passes of the whole list in every block
  inside the windows. **Rotation**: passes per day split by share (largest remainder), interleaved,
  spread evenly over the day's blocks inside the windows, on every day of the order.
- **Duplicate** makes a draft. **Split** removes repeats (from the split date on) whose first airing
  stays in the old order, and says so first. **Move airings** moves the airings whose items are all
  among the chosen ones, with their repeats; the target must have the same dates, channels and mode
  (ad rate and company come with pricing and contracts).
- Days outside the order are hatched for every mode, not only promos.
- **Report** replaces the grid: per item (first airings or blocks, repeats or passes, lengths) and per
  week; prices come with pricing (0006).
- **Multi-channel**: All fields → add a channel (its main template for the order's dates); the week
  bar then has a channel switch.
- Graphics-mode orders can be created; their items come from the graphics catalog, which is not
  built yet.
- Data: the sample LUMEN PLUS HD orders; scenario B
  (NORTHLIGHT ONE: a programmes-mode film order and a series) and C (KMTR 7, 29.97 DF: a series and
  a promo draft) are seeded.

## Open, for the user

- The choices above.
