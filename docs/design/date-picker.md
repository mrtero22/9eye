# Date picker — shared component (build reference)

One date picker for every date in 9eye. Asked by the user on 2026-10-17 ("a date picker that
matches our UI / UX, used wherever it is needed"). Mockup:
[mockups/DatePicker.dc.html](mockups/DatePicker.dc.html) (the component itself) and the "Date
picker" section of the Main mockup (private) (Design system board). The Playlist,
Scheduling and Templates mockups already use it. Build it once in the shared UI
(`apps/web/src/ui/`). Pages never draw their own calendar.

## API

| Prop | Values | Meaning |
|---|---|---|
| `mode` | `day` · `week` · `range` | One day; one channel week; a first and last day |
| `variant` | `field` · `quiet` · `inline` | Typeable input with a calendar button; quiet text button for page headers; calendar always shown |
| `value` / `from`, `to` | `YYYY-MM-DD` | Calendar days (never a moment, never a `Date` in local time) |
| `weekStart` | the channel's first weekday | First column of the calendar; week and whole-week ranges follow it |
| `today` | `YYYY-MM-DD` | The channel's current broadcast day, from the server (see Rules) |
| `min`, `max`, `limitText` | days + reason | Days outside are dimmed and cannot be picked; the reason shows on them and in the error |
| `wholeWeeks` | boolean | Range snaps to whole channel weeks (start = first weekday, end = the day before it) |
| `step` | boolean | Quiet variant: ‹ › move one day (day) or one week (week) |
| `marks`, `legend` | day → `ok` · `warn` · `error` · `info` · `muted` | A small dot under the day, explained in the legend |
| `labelHidden`, `noWeekday`, `fill` | boolean | The label only names the field for screen readers; a day field without the weekday ("22 Oct 2026"); the field takes its container's width |

**`StartEndPicker`** (same file): a start and an end picked apart — one label over two narrow day
fields with an arrow between, each opening its own one-day calendar; the start is limited by the end
(and an optional `min`), the end by the start. As wide as its column (the fields use `fill`), so it
lines up with the rest of a sidebar. Used where the user wants the two days chosen separately (order
dates, user 2026-10-23).
| `label`, `help`, `width`, `align` | | Field label, help line, width, popover side |
| `onChange` | `{ value }` or `{ from, to }` | Called once per complete pick |

## Behaviour

- **Field**: type or pick. Accepted typing: `17 Oct 2026`, `Sat 17 Oct`, `Oct 17`, `17/10/2026`,
  `17.10.26`, `2026-10-17`, `today`, `tomorrow`, `yesterday`, `+7`, `-2w`. A missing year means the
  year of today. The text is checked on Enter or when leaving the field; a wrong value keeps the
  text and says what is wrong ("There is no 31 September 2026.", "Must be inside the order: …",
  "The end is before the start …").
- **Range**: two typed ends, one calendar. The first click is the start, the second the end (a
  second click before the start swaps them); the band follows the pointer. Summary: days and
  channel weeks.
- **Week**: hovering shows the whole week a click takes; the label is "17 – 23 Oct 2026".
- **Quiet**: the page-header button (Playlist day, Scheduling week) with ‹ ›, and a "Today" /
  "This week" mark, or a button to go back to it.
- **Calendar**: month title opens a month grid (‹ › then move by a year); today underlined;
  selection in the accent colour; days of other months lighter; presets (Today, Tomorrow, Next
  <first weekday> · This week, Next week, In 2 weeks · This week, Next 4 weeks, Rest of the month, or
  1 / 4 / 13 whole weeks).
- **Keyboard**: Down opens the calendar from the field; arrows move a day or a week, PgUp / PgDn a
  month, Home / End the channel week, Enter picks, Esc closes. Grid with `role="grid"`, days with
  full names ("Thursday 15 October 2026, today, Published") and `aria-selected` / `aria-disabled`.

## Rules

1. **Calendar days, never shifted.** Values are `YYYY-MM-DD` strings; all arithmetic is on the
   date alone. The browser's time zone is never used, so a day never moves when the user is in
   another country (decision 0004; a common bug class in scheduling tools).
2. **The channel decides the week**: first column = the channel's first weekday (Aurora Media: Saturday,
   Friday or Sunday; scenario B: Monday).
3. **Today is the broadcast day**: before the channel's day start, today is still yesterday's
   broadcast day; with a channel time zone, today is taken in that zone.
4. **Month as a word** on screen (`Sat 17 Oct 2026`), never `10/17` or `17/10`. Typed numbers
   are read day first. **To confirm with the user:** month-first typing for US users (scenario C),
   as a per-user setting.
5. **Limits explain themselves**: every `min` / `max` comes with its reason.
6. Clock-change days (channels with a time zone) can be marked with `info` ("25-hour day").

## Built (2026-10-22)

`apps/web/src/ui/DatePicker.tsx` (logic and typing in `ui/dates.ts`, unit-tested). `today` comes
from the server as `channel.today` (`@9eye/core` `broadcastToday`: the channel's time zone, else the
server's clock, before the day start = yesterday). The field opens its calendar on a click, on Tab
and on Down — not when a dialog or popover puts the focus in it. Used now in Templates (new / clone
template, Change dates: whole weeks; block type validity), Channel settings (the day of the export
file name, quiet with ‹ ›) and Scheduling (week bar, order dates, new order, split, change end date,
replace items, bulk edit).

## Where it is used

| Page | Where | Mode | Limits · dots |
|---|---|---|---|
| Playlist | Day under the title | Day · quiet, ‹ › one day | Dots: published / not published (no dot: no playlist yet) |
| Scheduling | Week bar above the grid | Week · quiet, ‹ › one week | Weeks that touch the order's dates |
| Scheduling | Order dates · New order | `StartEndPicker` (two day fields; user, 2026-10-23) | Start up to the end, end from the start; a new order from today |
| Scheduling | Split order | Day · field | Inside the order |
| Scheduling | Replace items | Range · field | From tomorrow on |
| Templates | Change dates | Range · field, whole weeks | Starts on the channel's first weekday, ends the day before |
| Admin · Channels | Clock changes | Day · field | Dots: existing changes |
| As-run · Reports | Period | Range · field with presets | — |

New places use the same component with one of these modes; no new kinds without asking.
