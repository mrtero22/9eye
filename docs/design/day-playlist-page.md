# Day playlist — approved design (build reference)

_Approved by the user 2026-11-13, with the Add options in a left sidebar. Parts 1 to 3 are built (see the end)._

The **Day tab of the Playlist page**: one channel playlist (main or ads) on one broadcast day, as
blocks and their events, frame-accurate. Proposed 2026-11-12 (user: "build the page of one day's
playlist now"; part C of Weeks — the week's own grid — waits). Mockup:
the Playlist mockup (private) (calm look of 2026-10-15). Data: [data-model.md](data-model.md) §6.
Our names: linked break, break events, program placements, rotation list, note, reconciliation,
playlist check.

## Where it sits

`/playlist?tab=day&date=YYYY-MM-DD` (+ `channel`, `playlist=ads`). Opened by a click on a day in
the Weeks tab, or by the tab itself (today). The page header is shared with Weeks: channel picker,
settings text, Main / Ads switch. A day without a week says so and offers **Create this week**
(the Create weeks dialog on that week).

## Layout (as in the mockup)

1. **Header actions**: state badge (Draft / Published / Reconciled), Unsaved-changes badge, Undo,
   Redo, Find, **Add** (shows / hides the sidebar), "⋯" (Tools, View, Export), **Publish /
   Unpublish**, **Save** (primary).
2. **Under the header**: the date as the shared date picker (quiet, ‹ ›, the week's days marked by
   state); a published day's **read-only notice** with Unpublish; the **day's total** ("Day runs
   25:14:07.12 · ends 07:14:07 next day · 01:14:07.12 past 24 hours"); a **Find in playlist** field
   (+ Advanced); and the issues line that opens **Issues**.
3. **Left sidebar "Add to playlist"** (user, 2026-11-12: "the Add options are better in a sidebar";
   220–250 px, can be hidden): a plain list of what can be added — each item enabled by the
   selection, with the reason under it while it is not ("Select a block first", "Unpublish the day
   first") — then **Import into this day**, then **Steps for this day** (each with its state and a
   run-again button). Never forms that open inside the sidebar: a pick opens the catalog picker, a
   dialog or the right panel.
4. **The table** (the one focal point): a row per block, its events under it. Events have a drag
   handle (move inside the day) and a **Media** column that is empty unless the file is not ready
   ("Not ready", amber; also listed under Issues). A day without a week shows "No week has been
   created for <date>…" with **Create this week** instead of rows.
   - **Block row**: collapse caret, planned start, block name in its block-type colour, **gap /
     over** (real length − planned length: "Gap 00:01:53.00" amber, "Over 00:04:07.11" red), real /
     planned length.
   - **Event row**: tick, start, duration, title with a content-type colour mark (program,
     commercial, promo, filler, ident, jingle — the shared `--ct-*` tokens), break. Start times
     **run back to back through the whole day**; a block's planned start never resets them.
   - **Linked-break row** (main playlist): the break's name and its filled length; the spots copied
     from the ads playlist sit under it, indented, with the break's name in the Break column.
   - **Gap compensator** (length 0) closes every main block; a **gap row** ("Gap of 00:01:53.00 ·
     Fill gaps automatically") shows where a block is short (View → Show gaps).
   - Ads playlist: one block per break; a notice says its times only run on from the day start and
     the real air times are in the main playlist.
   - Footer while rows are ticked: count and total length, Cut, Copy, Paste after…, Find &
     replace, Delete, Clear.
5. **Right panel** (one at a time, only while a row is selected):
   - **Event**: kind and title, start, duration, TC in / TC out (editable; "apply to every use of
     this segment", "restore"), break, media, graphics (count, Add graphic), note, **Insert
     after…**, Move up / Move down, Remove. On-screen logos and GPI triggers sit under a closed
     "Logos and GPI triggers" line (rarely used).
   - **Block**: planned start and length, real length, gap / overlap, Add jingles…, Open template.
   - **Linked break**: filled length, "Filled from: ads playlist · same break", Open in ads
     playlist, Unlink.

## Menus

- **Add to playlist** (the sidebar; what is enabled follows the selection): Content · Rotation list · Note (a row
  selected) · Graphic (an event selected) · Jingles (a block selected) · Linked break · Manual ads;
  on an ads playlist also Auto-place ads · Auto-place promos. **Import into this day**: main —
  Acquisitions · Program placements · Jingles · Graphics · Break events · Rotation lists; ads —
  Rotation lists.
- **Tools**: Find & replace… · Refresh · Clone… · Fill gaps automatically · Remove invalid
  placements… · Sync linked breaks… (main) · Refresh from catalog… · Unplaced ads report (ads).
- **View**: Show gaps · Show main block titles (ads) · Collapse / Expand all blocks · Columns &
  checks… (row fields, graphic fields, playlist checks of the channel).
- **Export**: Export to <the channel's default> · Export to a file system… · Download EPG….

## Rules

- A playlist is saved whole with its `version` (someone else saved first → refused, nothing
  written), as Templates and orders are. Undo / redo cover every change.
- **Published** and **reconciled** days are read-only until unpublished / unreconciled.
- Every import shows a result: **placed / not placed**, with the reason per row in plain words
  (block not found, not enough room, clash-code rule, break-position order, …), and lets a
  not-placed item be put in by hand. Running one again asks: all again / only some / just look.
- Inserting needs a selected position; conflicts (pass limit of a clash code, a refused time
  window) are listed before anything is inserted; into a linked break it asks **Insert and link /
  Insert without linking**.
- Lengths and times are frames of the channel's frame rate; a 29.97 drop-frame channel shows `;`.

## Build order (each part usable on its own)

| Part | What | Done when |
|---|---|---|
| 1 · See a day | Data model: the remaining `playlist_event` columns (title, production / segment, TC in / out, fixed, hold, note, related event, order reference, …), migration. API: read a day (blocks, events, running starts, gap / over per block, state), publish / unpublish. Page: header, date picker with the week's states, table with collapse / expand and Show gaps, right panel read-only, the ads notice | A day of a created week opens and shows its blocks, linked-break rows and gap compensators; scenario B (main only) and C (29.97 drop-frame) |
| 2 · Change it by hand | Add: Content (the shared catalog picker → production → segment), Note, Jingles, Linked break; Insert after…; move, cut / copy / paste, delete, TC in / out, fixed / hold; Save with version, Undo / Redo; ticks footer | A day is filled by hand, saved, published; read-only when published |
| 3 · Fill it from what exists | Import **Program placements** (confirmed orders of the Scheduling page → events, a programme split across its linked breaks), **Rotation lists** (gap filling, rotation state), **Break events** (the ads playlist's spots under their linked break); Fill gaps automatically; result dialogs; Steps for this day and Issues | The sample LUMEN PLUS HD orders land in a day as planned (unit tests of every engine) |
| 4 · Send it | **Export to Playout XML** (the verified format; download, then file system through a connection), file names per exporter | The exported file of a sample day matches the reference file item by item |
| 5 · The rest of the tools | Find in playlist, Find & replace, Clone, Refresh from catalog, Remove invalid placements, Sync linked breaks, Columns & checks, Graphics and logos / GPI on events, EPG | Each with its own tests |

**Waits for other modules:** Auto-place ads / promos, Manual ads and the Unplaced ads report need
commercial orders (the Orders page, not specified yet); Acquisitions needs its module;
reconciliation needs as-run. Their menu items are shown but disabled, saying why.

## Built — part 4, Playout XML export (2026-11-16)

User: "too safhe playlist bayad ye export xml ham biarim". `packages/core/src/playout-xml.ts` writes the
file (4 unit tests; the first writes a sample day of AURORA SD character for
character) · `apps/api/src/services/exports.ts`: `GET /api/channels/:id/days/:date/export?format=playout-xml`
→ `{ fileName, content, items, noFile, draft }` · Day page, "⋯" → **Export → Export to Playout XML** (the
channel's default export; others say they are not built yet) downloads the file and says how many
items it holds and which rows have no playout file.

- The file is made from the **saved main playlist** of the day (with unsaved changes the item says
  "Save the day first"); on the ads playlist it exports the main playlist of the same day.
- One item per row in playlist order; linked-break rows, gap compensators and notes are left out.
- `file` = the production's Additional data, `category` = its notes, `star` = its STAR field, `color`
  = the content type's colour, `inp` / `outp` = the row's TC in / out in the catalog's frame rate
  (a row without TC out: TC in + its length), `title` without a trailing " - 0".
- Root `name` = `<company short name with _>_YYYY_MM_DD.xml - <day start with frames>` (the short
  name `aurora-media` gives `aurora_media`). Root `id` = the time of the export in ms.
- Item ids: 9eye runs on from a number of the broadcast day (days since 1 Jan 2020 × 10 000 + 1), so
  two days never share an id and exporting a day again gives the same ids.
- Checked: a whole day's file (835 items) parsed and written again by the writer — 819 of 835 items
  equal; the 16 that differ only carry `notes="MOVED"`, added by a checking tool after the export.
- Not yet: export to a file system (a connection), several days or channels at once, the other
  formats (no samples), EPG.

## Built — part 1, see a day (2026-11-13)

`packages/core/src/day.ts` (6 unit tests) · migration `20261113053207_day_playlist_events` ·
`apps/api/src/services/days.ts` (9 API tests): `GET /api/channels/:id/days/:date?kind=main|ads`
(the day laid out, its week, why it is missing, the state of the days around it),
`POST /api/days/:id/publish` and `/unpublish` (`{ version }`) · `apps/web/src/features/playlist/DayTab.tsx`
with the new shared `PlaylistTable`, `ActionList` / `ActionItem` and `DetailList`
(`apps/web/src/ui/`); `EditorLayout` takes `left={null}` to hide the sidebar ·
`apps/web/e2e/days.spec.ts` (5 browser tests; `fillDay` in the fixture writes rows straight into the
database, as nothing can add them yet). Checked in Light, Dark + Compact and at phone width.

What works: opening a day from Weeks or by date (‹ › and the calendar with the days' states); the
table with running start times, a break's filled length, spots indented under their break, gap /
over per block and the gap line (View → Show gaps), collapse / expand; the day's total and end; the
"media not ready" column and notice; the details panel for a row, a linked break (→ the ads
playlist) and a block; Publish / Unpublish with the read-only notice; a day without a week
(Create this week) or on a weekday that is off; the ads playlist with its notice.

Choices made while building, to confirm with the user:

- Everything that changes rows is **shown but disabled** and says "Not built yet" (or "Unpublish the
  day first"): the sidebar's Add and Import items, Undo / Redo, Save, Tools, Export, Insert after…,
  Remove. Steps for this day and Issues are not shown yet (they come with the imports, part 3).
- The time separator before frames is the product's own (`06:20:22:00`, `;` for drop-frame), not
  the mockup's dot.
- A gap line is shown only in a block that already plays something; an empty block says "Gap" in
  its header only. A new day's total reads "Nothing is placed yet".
- Media state comes from the catalog item (`media_status`); a row without a catalog item shows none.
- The ticks column, the drag handle and the cut / copy / paste footer come with part 2.

## Built — part 2, change a day by hand (2026-11-13)

`packages/core/src/dayEdit.ts` (10 unit tests): `insertRows`, `removeRows`, `moveRows`,
`nudgeRow`, `updateRow`, `setTcRange`, `rowsToTake`, `breakOf`, `validateDay`. API (4 more tests
in `apps/api/test/days.test.ts`): `PUT /api/days/:id` (`{ version, blocks: [{ id, rows }] }`, the
whole day, all-or-nothing, every problem listed; refused while published or reconciled; the title of
a catalog row is always the catalog's) and `POST /api/days/catalog-rows` (catalog items as rows: the
kind follows the content type's family — program → program, advert → commercial, filling →
filler). Browser: `DayTab.tsx`, `editor.ts` (draft + history), `dayDialogs.tsx`; shared
`SelectionBar` and the ticks of `PlaylistTable`. 3 browser tests in `apps/web/e2e/days-edit.spec.ts`.

What works: select a block (adds go at its end) or a row (adds go right after it); **Add** in the
sidebar — Content and Jingles (the shared catalog picker; jingles from fillers), Note (a dialog),
Linked break (main playlist: the breaks of the day's ads playlist, one already linked in the block
disabled), Paste; at a linked break or one of its spots the question **Insert and link / Insert
without linking**; **Move up / Move down** in the row's panel; ticks with **Cut / Copy / Delete**
(a linked break takes its spots along); **TC in / TC out** (the length follows), **Fixed start**,
**Hold**, the row's note, a note row's text; **Undo / Redo** (also Ctrl+Z / Ctrl+Y), **Save** (also
Ctrl+S), "Unsaved changes"; Publish waits for the save; leaving the day (another day, the Weeks tab,
another channel or playlist, closing the browser tab) with unsaved changes asks first; a refused or
stale save shows its reasons, with **Reload the day** on a conflict. A week whose day holds rows can
no longer be deleted (the Weeks rule).

Rules (as the code has them): the gap compensator stays the last row of its block and cannot be
moved or removed; a spot stays linked only while it sits in the unbroken run of spots right under
its break — moved away it becomes a plain row; a removed break leaves its spots as plain rows; a cut
is pasted once, a copy as often as wanted (with new ids); a note and a linked break are never spots.

Choices made while building, to confirm with the user:

- **No drag and drop yet** (the mockup's handle): Move up / down and Cut / Paste do the same work.
- **A whole production goes in** (TC in 0, TC out = its catalog length); picking a segment of it
  comes later. An item without a catalog length goes in at 0 with a warning to set TC out.
- Lengths and TC are read in the channel's frame rate; a catalog in another frame rate than the
  channel (not the case at Aurora Media, both 25) is not converted yet.
- Ads playlist: Content adds spots by hand; the auto-place items stay disabled (commercial orders).
- Rotation list, Graphic, Manual ads, every Import, Tools and Export stay disabled ("Not built yet").

**Added 2026-11-16 — drag and drop** (user: imported rows must move by drag and drop). A row of a day
that is not approved shows a grip on hover: drag the row anywhere in the day — a line shows where
it lands (over a row's top half: before it; bottom half: after it; on a block's header: at the end of
the block; never below the gap holder). A ticked row takes every ticked row with it; a linked break
takes its spots. Dropped at a linked break it asks **Move and link / Move without linking**, as Paste
does, unless spots only change places inside their own break (they stay linked). One Undo step per
move. The grip also moves a row with the arrow keys (one place, inside its block); Move up / Move
down stay in the row's panel. Core: `InsertAt.first` (above a block's first row) for `moveRows`;
`PlaylistTable` takes `onMove` / `onNudge`; e2e `days.spec.ts` "rows move by drag and drop".

## Built — part 3, fill it from what exists (2026-11-13)

`packages/core/src/dayFill.ts` (22 unit tests): `placePrograms` with
`splitTargets` (§6c — slots of linked breaks, the best-fitting slot, segment i right before its i-th
break, the rest before the next programme or at the end), `fillBreaks` (§5.4), `fillRotation`
(§7 — the walk from where the list left off, the five gates: once a day / days since last use,
starts, expires, channels, time windows; whole seconds; random lists shuffled), `dayChecks` (the
steps and issues of a day). Migration `20261113130042_playlist_event_rotation_list`
(`playlist_event.rotation_list_id`). API (8 tests in `apps/api/test/daysFill.test.ts`):
`POST /api/days/:id/run` (`{ step, mode, version, blocks, listId?, blockIds? }` — runs one step on
the person's draft and gives it back with what was placed and a report; nothing is saved),
`GET /api/rotation-lists`, `GET` a day now carries `checks` (the airings it should play, the ads
playlist's breaks, the channel's default list), `PUT` a day accepts the segments, orders and rotation
lists a step set (checked) and moves a rotation list on. Browser: `fillDialogs.tsx` (the run dialog
with its result, the Issues dialog), shared `StepItem` and `DotItem` with an action; 2 browser tests
in `apps/web/e2e/days-fill.spec.ts`.

What works: **Import into this day** — Program placements, Break events, Rotation lists (main; the
ads playlist has Rotation lists only); **Steps for this day** in the sidebar, each with its state
("2 airings to place", "All 2 linked breaks match the ads playlist", "2 blocks still have gaps") and
**Run / Run again**; an issues line under the date bar opens **Issues** (airings not in the day,
airings whose block the day does not have, rows of orders that no longer place them there, breaks
that differ from the ads playlist, breaks the ads playlist does not have, blocks with gaps, media not
ready), each with the step that resolves it; **Tools → Fill gaps automatically** and a gap row's
**Fill gaps automatically** (that block only). Every run first shows what it would do —
placed / not placed with the reason in plain words, what was already there, what was taken out,
notes (draft orders left out, promo orders not placed here) — then **Put into the day** (one Undo
step; Save keeps it). Run again asks **Only what is missing** (default) or **All again** (what the
step placed before is taken out first); Cancel is "just look".

**Changed 2026-11-16 (user: the popup before a run is extra; the button should import at once).** A
run no longer opens a dialog: Import into this day, Run / Run again, Auto-place ads, the Issues
buttons and Fill gaps automatically put what the step places into the day at once (one Undo step;
Save keeps it) and say so in a short note — "Program placements: 2 airings placed. Save to keep it.",
"Gap of Run Block 1: 3 items put in.", "…: nothing new, it is all in the day already." — with
**Details** (the placed / not placed table, the notes) when something did not go in or a note was
left. Mode: only what is missing, unless an issue says what the step placed is out of date
(`programs-stale`, `breaks-differ`, `commercials-stale`): then all again. Rotation lists: each block's
own list, else the channel's default list (the API now falls back to it). The Unplaced ads report
stays a dialog (a preview by nature). Checked on the development database
with a sample day of AURORA SD (13 Nov 2026): every airing's parts placed before its
linked breaks, the opening Billboard 1 left as the block's first row; every break matched.

Choices made while building, to confirm with the user:

- **No golden fixtures yet**: the engines are covered by unit tests; a comparison with recorded days
  of a live channel is still to do.
- **Program placements**: series and programmes orders only (a series places its items once, other
  orders their passes; a repeat its first airing's item). Promo, jingle and graphics orders are
  named in a note and not placed (promos go into the ads breaks — Auto-place promos, not built).
  A production plays the segments of its first segmentation; one without segments plays whole (its
  catalog length); one with neither is not placed ("It has no length in the catalog").
  "Only what is missing" counts an airing as there when its block holds a row of its order.
- **Break events** copy the ads block's content rows in order; "Only what is missing" fills only
  breaks without spots, "All again" copies every break again.
- **Rotation lists**: templates do not choose a list (it is chosen when the day is
  filled), so the dialog takes **one list for every block that fills its gaps** — by default the
  channel's default list (Channel settings, matched by name) — or "Each block's own list" when a
  block names one. Only the gap at the end of a block is filled (rows have no fixed start time yet,
  so gaps before fixed rows do not exist here). Items per block, overlap and "allow production
  repeats" are not in our model yet. Several lists rotating per block is not built: one list per run.
- **A rotation list moves on when the day is saved**: its last item becomes the first item of the
  production of the last new row it put in, and the items used get the day as "last
  used". A pasted copy is placed by hand: no order and no rotation list.
- **Steps and Issues are read from the draft in the browser**, so they follow unsaved changes too.

## Questions for the user

1. **Is the mockup still what you want** for this page (it was drawn 2026-10-16/17 but never
   marked approved)?
2. **Part 3 before part 4?** Proposed order as above: by hand → imports → export. If a playable
   file matters first, export (part 4) can come right after part 2.
3. **Sample data:** build on the sample companies (Aurora Media, B and C).
