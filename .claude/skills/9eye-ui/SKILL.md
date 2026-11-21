---
name: 9eye-ui
description: The 9eye design system — tokens, shared components and the calm page layout. Use before building or changing any page or component in apps/web (Templates, Playlist, Catalog, Admin, …), so every screen looks and behaves the same.
---

# 9eye UI — one design system for every page

Decisions: `docs/decisions/0003-ui-design-system.md`, `0009-calm-ui.md`. Foundation:
`docs/design/ui-foundation.md`. The look to follow is the calm mockups of 2026-10-15 in
`docs/design/mockups/` (e.g. the Week mockup (private) for the Templates page). Each page also has a page doc
in `docs/design/` (e.g. `templates-page.md`) — read it before building that page.

## Hard rules

1. **Pages use only shared components and tokens.** No page-specific CSS, no hex colours, no
   Tailwind default palette (it is switched off: only token colours exist). If a page needs
   something new, add it to `apps/web/src/ui/` as a component first.
2. **The one exception is data colour** — a colour that comes from the customer's data (block type,
   content type). Pass it through `dataTint(color, percent)` / `safeColor()` from `ui/color.ts` (or
   `Swatch`); never hard-code one.
3. **Never another product's look, layout or wording** (0015): no copied CSS, icons, texts or screen arrangement.
   Our own words: the word list named in `CLAUDE.local.md` (private).
4. **Every time on screen goes through the channel's timecode** (`@9eye/core` `formatTc`,
   `formatClock`), in `font-mono` with tabular numbers. Never assume 25 fps; drop-frame shows `;`.
5. **Sentence case, English, no uppercase labels.** Short, plain sentences; say what will happen
   ("The blocks of those days are replaced.").
6. **Accessible:** every icon-only button has `aria-label` (and `title`); popovers and dialogs are
   Radix-based (focus trap, Escape closes); toggles use `aria-pressed` / `role="switch"`.

## Tokens — `apps/web/src/ui/tokens.css` is the single source

Theme = class on `<html>`: `ds` (always), `dark` (Dark theme), `compact` (Compact density). Both are
per-user settings in the user menu (stored in localStorage by `app/prefs.ts`).

| Group | Tokens (CSS variable → Tailwind class) |
|---|---|
| Surfaces | `--bg` `bg-bg` · `--surface` `bg-surface` · `--surface-2` `bg-surface-2` (hover, subtle fill, status bar) · `--surface-3` `bg-surface-3` |
| Lines | `--hairline` (rows, separators) · `--border` (cards, panels) · `--border-strong` (inputs, secondary buttons) |
| Text | `--text` `text-text` · `--text-2` `text-text-2` (secondary) · `--text-3` `text-text-3` (meta, placeholders) |
| Accent | `--accent` (selection, focus, the one primary action) · `--accent-soft` (selected row) · `--accent-text` |
| Status | `--red` / `--amber` / `--green` with `-soft` (badge background) and `-text` (badge text). Only for error / warning / OK |
| Content types | `--ct-program` `--ct-commercial` `--ct-promo` `--ct-filler` `--ct-ident` `--ct-jingle` (+ `-soft`) — same colour on every screen |
| Density | `--fs` (14 / 13) · `--fs-sm` (13 / 12) · `--row` (32 / 28) · `--ctl` (32 / 28) — Calm / Compact |
| Shape | radius 4 badge, 6 control, 8 list item, 10 card / panel / popover; `--shadow` for floating layers only |

Spacing on a 4 px grid; page padding 32 px (16 px on phones). Fonts: Geist (UI), Geist Mono
(times, ids, numbers), self-hosted via `@fontsource-variable`.

## Components — `apps/web/src/ui/` (import from `@/ui`)

| Component | Use |
|---|---|
| `AppShell` (in `app/`) | Top bar 52 px (company switcher, module links, search, user menu with Theme and Density); bottom tab bar ≤ 720 px |
| `PageHeader` | Title (22 / 600), quiet context row under it (`ContextPicker`, `ContextText`, `ContextLink` for a quiet link such as "Change in channel settings"), actions on the right |
| `ContextPicker` | Text-button picker with search list (channel, playlist, date) — never a bordered toolbar control |
| `Button` | `variant`: `primary` (one per screen, top right) · `secondary` (bordered) · `ghost` · `danger` (red text, ghost); `size`: `lg` (40, a form that stands alone: sign-in) · `md` (`--ctl`) · `sm` (28) · `xs` (26) |
| `IconButton` | Square ghost button with an `Icon`; `label` is required (aria-label + title) |
| `Icon` | Our icon set (`ui/icons.tsx`); add new glyphs there only |
| `Badge` | `tone`: `neutral` · `green` · `amber` · `red` · `accent` — status only; `round` for a change count |
| `Chip` | Small rounded status chip in column headers ("Same as Saturday", "Own layout") |
| `DayToggles` | Seven weekday toggles in the channel's week order; `tone` `plain` (active days) or `accent` (choosing days) |
| `Switch` | On / off option with a title and one-line description (`SwitchRow`) |
| `Field`, `TextField`, `SelectField`, `TextArea`, `ColorField` | Label above control, 12 px label in `text-2`; `TextField` takes `mono`, `suggestions` (a typed list, e.g. time zones) and `large` (40 px) |
| `PasswordField` | Password with a show / hide eye button and "Caps Lock is on."; `large`, `ref` |
| `CommitField` | Timecode / date input that commits on Enter or blur, shows the refusal under it and restores the value on Escape (mono) |
| `SearchField` | Search input with icon |
| `Segmented` | Two to four mutually exclusive options (Theme, Density, "In date / All dates / Other channels") |
| `RadioList` | Larger choices with a sentence each ("Same block type on other days") |
| `Checkbox` | Plain checkbox with label; without children a bare box with an aria `label` (matrix cells) |
| `Popover` | Floating panel anchored to a button (pickers, small forms); `title`, body, footer |
| `Menu` (`MenuItem`, `MenuCheck`, `MenuLabel`, `MenuSeparator`) | "⋯" menus; rare actions live here; destructive items last, `danger` |
| `Dialog` | Modal for create / rename / delete / manage; footer with Cancel + one primary |
| `ConfirmDialog` | Destructive or discarding confirmations |
| `EditorLayout` | The calm body: left list, main area, optional panel (wraps on narrow screens) |
| `StatusBar` | `surface-2` strip above a grid (name, dates, active days, small actions) |
| `SidePanel`, `PanelSection` | Right details panel: 48 px header with title + close; one at a time. Sections with a title and a small aside |
| `ListItem` / `ListGroup` | Left list entries (name, meta line, badge), grouped with a small `text-3` caption |
| `RowList` | Bordered list of compact rows (linked breaks) with an optional footer row |
| `Swatch` | 8 px colour square for a data colour |
| `Notice` | Inline message (`tone` amber / red / neutral) — refusals, warnings, empty states |
| `EmptyState` | Dashed box with one sentence and an optional action |
| `WeekGrid` | Timeline editor: 7 columns + hour axis from the channel's day start, a line at every hour, positioned blocks with name / time / badge, column header with chip and ⋯ menu, zoom levels 24–400 px per hour (zooming keeps the middle hour in view); optional `drag` (move / copy blocks, drop things from outside) and `place` (click an empty spot to put something there, with a hover preview) — the page judges every preview (time + what / why not) |
| `WeekTable`, `WeekLegend` | A month as a table of channel weeks (Playlist → Weeks): a row per week with title, name and an optional action or "⋯" menu, seven day cells in a status tone (`draft` · `published` · `reconciled` · `off` not active · `none` not created) with date, state and a quiet meta line; today is outlined; a day with `onClick` is a button. The legend names the tones |
| `PlaylistTable` | A day playlist (Playlist → Day): a row per block (collapse caret, planned start, name in its data colour, "Gap …" amber / "Over …" red, real / planned length) and its rows under it (start, duration, title with a content-kind mark in the `--ct-*` colours or a data colour, a link / note icon, spots indented under their break, Break and Media columns); an optional closing gap line per block; a row with `onCheck` gets a tick box ("Tick <title>"). The page makes every time string with the channel's timecode |
| `SelectionBar` | A bar that stays at the bottom while rows are ticked: "2 rows ticked", a total, the actions (Cut, Copy, Delete) and Clear |
| `ActionList`, `ActionItem` | A sidebar list of things that can be done ("Add to playlist"); an item that cannot be used is disabled and says why under its name |
| `StepItem` | A step of a sequence in a sidebar ("Steps for this day"): a state dot (`none` / `todo` / `partial` / `done`), a short state line and a small Run / Run again button that says why while it is disabled |
| `DetailList` | Label / value facts in a details panel (mono for times, amber / red for a warning); items without a value are left out |
| `EditorLayout left={null}` | Hides the left column (a sidebar the person closed); the main area takes its room |
| `Toaster` / `useToast()` | Short confirmations after save / apply; errors stay on screen as `Notice` |
| `SectionNav` | Grouped sections of a module on the left (Admin); sections not built say "later" |
| `SectionHead` | A section's title (17 / 600), one line under it, actions on the right |
| `Breadcrumb` | "Channels / AURORA SD" above a detail view |
| `Card`, `InsetRow` | Settings cards (radius `--radius-panel` 12) in an auto-fit grid; a quiet `surface-2` row inside a card |
| `DotItem`, `StatusDot` | A rule or state with a status dot (green OK, amber blocked / warning, neutral locked or off); `DotItem` takes an `action` on the right (Issues: the step that resolves it) |
| `Pill`, `AddPill` | Round chips for chosen values (accent) with remove; dashed "Add" pill as a menu trigger |
| `Table`, `TableRow` | A table in a card with one grid template for header and rows; rows can link or open |
| `Avatar`, `Monogram` | A person's initials; a company's letter mark |
| `InlineRadios` | Two or three inline radio choices (All channels / Selected channels) |
| `DatePicker` | **The one date picker** (`docs/design/date-picker.md`): `mode` day / week / range, `variant` field (typeable, calendar button) / quiet (page header, ‹ › with `step`) / inline; the channel's `weekStart` and `today` (`channel.today` from the server, never the browser's date); `min` / `max` with `limitText`, `wholeWeeks`, `marks` + `legend`. Values are `YYYY-MM-DD`. Pages never draw their own calendar. `StartEndPicker`: a start and an end picked apart (one label, two day fields with →; order dates) |
| `CatalogPicker` | **The one catalog picker** (`docs/design/catalog-picker.md`): a dialog with content types → contents → productions and a search; `pick` series / items / one, `families`, `already` (production ids, "In this order"), `date` (validity), trigger styles dashed / button / small / none (controlled `open`). Pages never build their own catalog browser |
| `ScheduleWeek`, `ScheduleLegend` | A channel week of template blocks with what orders place in them (Scheduling): day columns with a note, hour axis from the day start, cells in looks first / repeat (order colour), passes with a "4×" chip, other (grey), missing (dashed amber), template, outside (hatched); zoom `SCHEDULE_ZOOM`; an optional small icon button per cell (`action` + `onCellAction`, quick placement's "Add repeats of …") |
| `DataTable`, `ProgressBar` | Full-width list table: sortable heads, quiet group rows (empty label = no group row), rows that open on click / Enter with an actions cell that does not, a toolbar line and a footer; a thin done / this-week bar in a data colour |
| `ToggleChip` | Round on / off filter chip: `accent` (tick), `strong` (one of a set with its count), `amber` (warning filter) |
| `SwatchPicker` | A few data colours as a radio group (block colour of an order); the last can be shown but off ("grey, kept for …") |
| `CheckLine` | A check before an operation: green tick or amber mark with one sentence (Copy week) |
| `BrowserColumn`, `BrowserRow` | A column of a hierarchy browser (Catalog): header with collapse, title, Create and "⋯"; toolbar with search, advanced search (accent while on), order by, an optional Show-expired filter, refresh and tick-all; rows with tick, data-colour swatch, media dot, last-inserted bar, meta (amber "no length") and Relations on the selected row; a footer count. Collapsed: a 44 px strip with the selection |
| `FormPanel`, `FormGroup`, `Req`, `SwitchField`, `ReadValue`, `ChipsField`, `OptionalDateField`, `TimecodeField`, `NumberField` | The form beside a browser: entity + name, "Unsaved", Relations, collapsible groups ("N fields" when closed), Cancel / Save or Create, a server refusal above the footer; label-left switches, grey read-only values with disabled actions, many-values chips with "+ Add", a day that may be empty ("No date · Set date", else the date picker + Clear), timecodes in a given frame rate, numbers (`NumberField`: whole by default; `decimals`, `max`, a `suffix` such as "%" inside the box, a `hint`) |
| `SortableTable` | A table whose rows are put in order by the person (Admin → Break positions): a grip on each row to drag it (an accent line shows where it lands) or, focused, to move it with the arrow keys; a click on the rest of the row opens it (`selected` stays highlighted); `onMove(from, to)` |
| `BreakBoard`, `SPOT_TONES` | The week board of a commercial order: one column per day (header: day, date, a quiet tag such as "own layout", a meta line; a click selects the day), one row per hour (a click selects the hour); each day's blocks as quiet grey cards (a block over several hours is one tall card, blocks sharing an hour sit together), their breaks as plain lines (time, name); a booked break is a white line with the spot's colour bar and mark, an amber / red dot marks a nearly full / over-full break; `overlay` floats over the right side (the open break). `SPOT_TONES`: the token colours of an order's spot versions |
| `TabBar` | Tabs of a dialog (`role="tab"`); a tab with unsaved changes shows a red "!" |
| `SignInLayout`, `Wordmark`, `PRODUCT_NAME` | The screen before sign-in (`docs/design/sign-in-page.md`): mark + corner action on top, the form in the middle, a quiet footer, a picture on the right from 1024 px. The product name and mark live only in `ui/brand.tsx` ("9eye" is a codename) |
| `PageHeader` `back` / `mark`, `EditorLayout wide`, `Notice` tones `accent` / `green`, `MenuItem note`, `SelectField inline` | A quiet back link above the title and a data-colour square before it; a 280–310 px left sidebar with no right panel (pages that show a schedule); a running mode bar (quick placement) and success notes; a second line under a menu item; a label-left select in filter rows |

## The calm page layout (every editor page)

```
PageHeader: Title                                   [badge] [undo] [redo] [secondary…] [⋯] [Primary]
            Context picker · settings text
┌ left list (220–260 px) ┐ ┌ status bar (surface-2) ──────────────┐ ┌ SidePanel (300–360 px) ┐
│ grouped items          │ │ legend · zoom                         │ │ only while something   │
│                        │ │ grid or table (surface, border, r10)  │ │ is selected / opened   │
└────────────────────────┘ └──────────────────────────────────────┘ └────────────────────────┘
```

- One focal point; details only on demand; rare actions in "⋯"; never a card inside a card.
- Rarely used fields go to the details panel or an "All details" dialog.
- Wrap order on narrow screens: list, then grid, then panel.
- Bolder layouts (horizontal timelines, outline + cards) were rejected — do not propose them.
- **One exception, the Catalog page** (user, 2026-10-22, `docs/design/catalog-page.md`): collapsible
  `BrowserColumn`s (content types → contents → productions → segmentations → segments) and a
  `FormPanel` on the right, 720 px high, wrapping on narrow screens.
- Admin-style pages (mockup the Admin mockup (private)): page header with a one-line description, `SectionNav`
  on the left, the section on the right (`SectionHead` + table, list or cards). A detail view:
  `Breadcrumb`, title, change count + Discard + Save; `Card`s in a two-column grid and a narrow
  right column of facts (`DotItem`). Conflicts show inside the card that causes them and disable
  Save; server refusals as a red `Notice` listing what is in the way.

## Checking a page in a real browser

`apps/web/e2e/shot.mjs` takes a screenshot of the running app (Chromium in the git-ignored `.cache/`):
`PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright node apps/web/e2e/shot.mjs /templates out.png 1440 1000 '[{"click":"Saturday, 07:00"}]'`
(write `out.png` to the session scratchpad, then look at it). Every page but `/sign-in` needs a
session (0021): prefix `SHOT_AS=<a platform admin's e-mail>` — the shot signs in with a 10-minute session
that it deletes afterwards. Actions: `click`, `clickText`, `type`, `press`, `eval`, `wait`, `reload`.
Browser tests: `npm -w @9eye/web run e2e` (each spec signs in with `signIn(page)` from `e2e/fixture.ts`).

## Checklist before finishing a page

- Light and Dark, Calm and Compact all look right (switch them in the user menu).
- No colour outside tokens / `dataTint`; no new CSS file under `features/`.
- Times use the channel's frame rate; try a 29.97 drop-frame channel.
- Keyboard: Tab order, Escape closes popovers / panels, focus ring visible.
- Phone width (≤ 720 px): bottom tab bar, nothing overflows the page.
