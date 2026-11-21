# Weeks — approved design (build reference)

Where a channel's dated weeks are made, opened and removed. Proposed 2026-11-11, **approved by the
user 2026-11-12** (without the week details panel); the user chose **a "Weeks" tab on the Playlist
page** (not a page of its own). Part A of the build order is done (see the end). Data:
[data-model.md](data-model.md) §6. Decisions 0015, 0016. Mockup: the "Weeks" boards of the design
canvas.

Our names: a dated weekly grid = **week**; its grid template = **template**.

## The Playlist page gets two tabs

`/playlist` → **Weeks** (this doc) · **Day** (the Day playlist, mockup the Playlist mockup (private), next slice).
Both share the page header: title "Playlist", channel picker, the channel's settings as text
("Week starts Saturday · day starts 06:00 · 25 fps"), and a **Main playlist / Ads playlist** switch
(hidden on a main-only channel). A day opened from Weeks lands in the Day tab on that date.

## Weeks tab — two screens

**No week details panel** (user, 2026-11-12: "not needed"). A week's actions sit in its "⋯" menu;
its name, source template and created / changed facts show in the status bar of the week's own
screen.

### 1. The month (list of weeks)

Calm layout: month list on the left, the table of weeks, no right panel.

1. **Header actions** (right): **Create weeks** (primary), "⋯": Open templates, Download EPG…
   (disabled until EPG exports exist).
2. **Left (220–260 px)**: the year with ‹ ›, the twelve months as a list, each with how many of its
   weeks exist ("4 of 5"); **Today** jumps to the current month. Under it a legend of the day states.
3. **Middle**: a table of the month's weeks in the channel's own week (first weekday first). A week
   belongs to the month its first day is in. Columns: **Week** (number + name, or "No week yet"),
   the **7 days** (date; state; number of blocks), and "⋯".
   - Week number: the ISO week number of the week's first day (week starting Sat 15 Aug
     2026 = 33).
   - Day states: **Not created** (empty cell) · **Draft** · **Published** · **Reconciled** · **Not
     active** (the week has that weekday switched off). Today is marked. A day with a configured
     time change shows a small clock mark with the sentence on hover.
   - Click a day → the Day tab on that date. Click the week cell → screen 2 (the week's grid).
   - Row without a week: one button **Create** (this week, with the dialog's defaults shown first).
   - Row "⋯": Open week · Rename… (≤ 50) · Copy week to other channels… · Delete week….
   - Day "⋯" (hover / keyboard): Open playlist · Open week · Copy this day… · Delete week….

### 2. One week (the grid of that week)

The same editor as Templates (`ScheduleWeek`, the block panel, Add block, Block types, drag and
drop, zoom, undo / redo / save, "Show on blocks"), with three differences:

- Column headers carry **dates** ("Sat 14 Nov"), each with **Open playlist** and "Copy this day…".
- The status bar shows the week ("Week 46 · 14 → 20 Nov 2026 · made from <template> ↗", with
  created / last change on hover) instead of "Valid from → to / Change dates"; the left list is the
  month's weeks instead of the templates. Rename… is in the page's "⋯" menu, as on Templates.
- A change here is a **one-off change of this week only**; the template and other weeks stay as
  they are. A notice says so once ("Changes here apply to this week only.").

Rules beyond the template rules (refused with the reason, all-or-nothing on save):

- A block that already holds events placed from orders cannot be removed; removing asks to type
  `DELETE` and lists the blocks and their orders.
- Days that are published or reconciled, and days in the past, are read-only in the grid.
- "Copy this day…": to the same channel — target week and days, optional time
  range, insert at the beginning / end, leave out break events; or to other channels — channels and
  days. Refused for the same weekday of the same week, past days, published or reconciled days.
- "Copy week to other channels…": channels the person may change;
  per-channel list of what was refused.

## Create weeks (dialog)

One dialog for one week or a run of weeks.

1. **Playlists**: Main and Ads ticked (main-only channel: Main alone). Main is always created
   before Ads.
2. **Weeks**: from week … to week … (shared date picker in week mode; default: the first week
   without one → the same week). "N weeks".
3. **Template**: per playlist, the template whose dates contain the week (shown, not typed). When a
   playlist has several that fit (AURORA COMEDY SD main), a picker — never a silent first pick.
4. **Active days**: the template's, changeable per run.
5. **Names**: preview of "Week 46 2026 <short name> M" / "… Ads" (short name = channel name; the
   pattern becomes a channel setting later). Editable afterwards with Rename….
6. **Check list** before the button is enabled: weeks that already exist (listed, never created
   twice) · weeks outside every template's dates · a linked break with no matching ads block.
   Any refusal → nothing is created (all-or-nothing); a warning (unmatched break) does not block.

What creating a week writes (data model §6): one `week`, 7 `playlist` rows (one per date), each
template block of that weekday as a `playlist_block`, and inside every main-playlist block its
linked-break rows (length 0, in order) and one gap compensator (length 0).

## Delete week

Confirm dialog listing the 7 days. Refused ("This week is in use") when any of its days is
published or reconciled, or holds events placed from orders; the days in the way are listed.

## Build order (each part usable on its own)

| Part | What | Done when |
|---|---|---|
| A | Data model §6 → tables `week`, `playlist`, `playlist_block`, `playlist_event` (linked-break and gap-compensator rows only), migration; core rules: week number, create from template, delete rules | Unit tests in `packages/core`; API tests on `nineeye_test` |
| B | Playlist page shell with the two tabs; Weeks month screen with the week "⋯" menu, Create weeks, Rename, Delete week | Browser tests: create one / a run, refused twice, delete, main-only channel (scenario B), week from Sunday at 29.97 (scenario C) |
| C | One week (grid editor on a week) with the one-off rules, Copy this day, Copy week to other channels | Browser tests; the Templates tests still pass unchanged (shared editor) |
| D | Import of existing weeks from another system (through an adapter) | Listed before writing; `--apply` only |

The Day tab (playlist editor), imports into a day and export come after this slice.

## Built — part A (2026-11-12)

Tables and migration, `packages/core/src/weeks.ts` (15 unit tests), `apps/api/src/services/weeks.ts`
with routes (12 API tests in `apps/api/test/weeks.test.ts`):

| Route | What |
|---|---|
| `GET /api/channels/:id/weeks?kind=main&from=&to=` | Weeks whose first day is in the range, each with its 7 days (state, block count; `id: null` + `not-active` for a day that is off) |
| `POST /api/channels/:id/weeks/check` | The run as it would be made: weeks, problems, warnings. Writes nothing |
| `POST /api/channels/:id/weeks` | Creates the run in one transaction (422 with every problem, else 201 with the weeks and warnings) |
| `GET /api/weeks/:id` | The week with every day's blocks and their rows |
| `PATCH /api/weeks/:id` | Rename (`name`, `version`) |
| `DELETE /api/weeks/:id` | 204, or 409 listing the days in the way |

Body of check / create: `{ kinds: ["main","ads"], fromWeek, toWeek, templates?: { main?, ads? }, activeWeekdays? }`.

Choices made while building, to confirm with the user:

- The default name is "Week <n> <year> <channel name> M / Ads", cut to 50 characters; the year is
  the calendar year of the week's first day.
- Past weeks are created with a warning (the first question below, as proposed).
- An ads-playlist block starts empty; only main-playlist blocks get linked-break rows and a gap compensator.
- The unmatched-break warning compares with the ads template of the same run, else of the existing
  ads week, else the only ads template that fits the week.

## Built — part B (2026-11-12)

`apps/web/src/features/playlist/` (`PlaylistPage`, `dialogs`, `queries`, `model`) on the shared
components, plus the new `WeekTable` / `WeekLegend` in `apps/web/src/ui/`. Route `/playlist`
(`?channel=&playlist=ads&month=YYYY-MM&tab=day&date=`). Covered by `apps/web/e2e/weeks.spec.ts`
(5 browser tests: month list and one week for both playlists; a run and a refused run; rename,
delete and a week in use; the Day placeholder; a main-only Monday channel, a day switched off and
a Sunday drop-frame channel). Checked in Light / Dark, Calm / Compact and at phone width.

Choices made while building, to confirm with the user:

- **Weeks / Day** are the shared `TabBar` under the page header (the mockup drew underlined tabs;
  the design system has one tab look). **Main / Ads** is a `Segmented` in the header actions.
- The month list shows "n of m" per month (green when every week exists); the year has ‹ › and
  **Today**. The table's day cell shows date, state and the block count.
- **Create weeks** in the header starts with the month's first week without one; a row's **Create**
  starts with that week. The dialog asks the server what would happen after every change
  (`/weeks/check`) and shows the names, the checks, or what stops it; the button reads
  "Create n weeks" (n = weeks, not playlists).
- **Open week** and **Copy week to other channels…** are in the "⋯" menu but disabled until part C;
  a click on the week title does nothing yet. **Download EPG…** is disabled as on Templates.
- A click on a day opens the **Day tab**, which only says it is not built yet (next slice).
- Day "⋯" menus (Open playlist · Open week · Copy this day…) come with part C; time-change marks
  come with time changes.

## Questions for the user

- **Past weeks**: may a week be created for dates in the past? Proposed: yes, with a warning (needed
  for imports and tests).
- **Daily grid view** and **grid type** on creation (options some systems keep behind toggles).
  Proposed: leave both out of this slice and list them as open in the spec.
