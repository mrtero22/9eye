# UI foundation

Decisions: [0003](../decisions/0003-ui-design-system.md), [0009](../decisions/0009-calm-ui.md).
**Built (2026-10-17):** tokens in `apps/web/src/ui/tokens.css`, components in `apps/web/src/ui/`;
the rules for building pages are the project skill `.claude/skills/9eye-ui/SKILL.md`.
Mockups v2 (private) —
boards: Design system, Home, Week grid, Day playlist, Admin. v1 was "too crowded"; v2 applies the
calm rules below. **Status: waiting for the user's feedback on v2.** Sample data is one series
channel; music and live-sport screens are still to be drawn.

## Principles

1. **Calm by default.** 14 px text, 32 px rows; Compact (13 px, 28 px) is a per-user setting.
2. **One thing at a time.** Summary first, details on demand; panels open only on selection and
   close again; rare actions in "…".
3. **Color means status.** Grays carry the interface; blue only for selection and the one primary
   action; red / amber / green only for error / warning / OK.
4. **Space, not boxes.** Whitespace and hairlines; never a card inside a card.
5. **Time is always mono:** tabular Geist Mono, `HH:MM:SS:FF`.
6. **Same place, same thing:** title + quiet context pickers top-left, one primary action
   top-right, details on the right.

## Density tokens

| Token | Calm (default) | Compact (per user) |
|---|---|---|
| `--fs` | 14px | 13px |
| `--fs-sm` | 13px | 12px |
| `--row` | 32px | 28px |
| `--ctl` | 32px | 28px |

Set by a class on the root (`.ds.compact`); components only ever use the tokens. A `--hairline`
color (#F0F0F2 light / #19191C dark) separates rows.

## Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #FAFAFA | #0A0A0B | App background |
| `--surface` | #FFFFFF | #111113 | Cards, tables, panels |
| `--surface-2` | #F4F4F5 | #1A1A1D | Hover, subtle fill |
| `--surface-3` | #E9E9EC | #232327 | Tracks, pressed |
| `--border` | #E4E4E7 | #26262A | Dividers |
| `--border-strong` | #D4D4D8 | #38383E | Inputs, buttons |
| `--text` | #18181B | #F4F4F5 | Primary text |
| `--text-2` | #52525B | #A8A8B0 | Secondary text |
| `--text-3` | #6B6B74 | #8B8B94 | Meta, placeholders |
| `--accent` | #2563EB | #2563EB | Selection, focus, primary action |
| `--red` | #DC2626 | #EF4444 | On air, error |
| `--amber` | #D97706 | #F59E0B | Next, warning |
| `--green` | #16A34A | #22C55E | OK, validated |

Each status color also has `-soft` (badge background) and `-text` (badge text) variants.

### Content types — the same color on every screen

| Token | Light | Dark |
|---|---|---|
| `--ct-program` | #64748B | #94A3B8 |
| `--ct-commercial` | #EA580C | #F97316 |
| `--ct-promo` | #0D9488 | #14B8A6 |
| `--ct-filler` | #A1A1AA | #71717A |
| `--ct-ident` | #7C3AED | #A78BFA |
| `--ct-jingle` (jingle / sponsor) | #DB2777 | #F472B6 |

The full CSS (with `-soft` variants) is in the mockup files' `<style>` block.

## Type scale

| Style | Spec |
|---|---|
| Page title | 22 / 600 / −2% |
| Section | 16 / 600 |
| Body | `--fs` / 400 |
| Small, table headers | `--fs-sm` / 400, text-2 or text-3 (sentence case, no uppercase labels) |
| Timecode | Geist Mono, tabular numbers |

## Shape and size

Spacing on a 4 px grid. Page padding 32 px. Radius 4 (badge), 6 (control), 10 (card). Controls
grow to 44 px on touch screens.

## App shell

- Top bar, 52 px: company switcher, module links (Home, Catalog, Schedule, Playlist, Orders,
  As-run, Reports; active = full-strength text + 2 px underline), search (`Ctrl K`), user menu (Admin,
  UI kit, Theme Light / Dark, Density Calm / Compact).
- Phones (≤ 720 px): the module links hide and a bottom tab bar appears (Home, Schedule,
  Playlist, Orders, More).

## Key screens (mockups)

| Screen | What it does |
|---|---|
| Home | "Needs attention" + tomorrow's readiness per channel |
| Catalog | Five sections side by side (Content types → Contents → Productions → Segmentations → Segments), each collapsible to a strip with the selected item, with "New", an actions menu per level, search + advanced search, filters, refresh, select all, item checkboxes, media markers, and a results footer; the form panel of the focused item on the right. Modes Catalog · Graphics · Lists |
| Schedule › Week | Real dates for one channel: the program placed in each slot (repeats marked), empty slots dashed, day exceptions marked, playlist status per day. Click a slot for episode, pattern and order. **Place program** (0012): pick a program → the panel says whether it **creates a new order** ("TV Series Drama · new title · Lumen Plus HD") or **adds a pattern to the existing order** of that program on this channel → slot, days, repeats, episodes → switches "Follow the series" and "Also on LUMEN SD" (linked paired order) → conflict check naming the other order (all-or-nothing) → "Create order" / "Add pattern". **Add exception**: replace slots on one date only |
| Schedule › Templates | Templates with validity periods (Active / Scheduled / Draft); the layout per weekday group (Sat–Thu, Fri); slots changed versus the active template outlined; slot settings (type, soft / hard start, duration, fill list, breaks inside); impact banner before a template takes effect |
| Playlist | One channel-day; layer filter All · Programs · Breaks (0011); one status line for the build steps and issues; detail panel on selection |
| Admin | Roles (module × action + channel scope), users with memberships, companies, integrations |
- Page header = title, quiet context pickers under it, one primary action top-right, rare actions
  in "…"; module sub-sections as tabs.
- Detail panel on the right only while something is selected, with a close button.

## Page templates

Home ("Needs attention" + tomorrow's readiness), list (table + filters), form / detail, timeline
editor (week grid, day playlist), settings / admin.
