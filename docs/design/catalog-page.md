# Catalog page — design (build reference)

Completed and **approved 2026-10-22** (user). Mockup:
the Catalog mockup (private), with the sample company's catalog (2026-10-22). Decision 0015.

## What the user said

- The Catalog keeps the arrangement the user asked for: five collapsible columns and the form on the
  right (2026-10-22). The "list → own page, no right panel" rule does not apply to this page.
- Complete it: every action and dialog, full editable forms, sample data, the shared date and
  catalog pickers.

## Layout (unchanged)

Header: "Catalog", modes **Catalog / Graphics / Rotation lists**, a short confirmation after an action.
Columns (each collapsible to a narrow strip showing the selection), then the form panel.

- Catalog: Content types → Contents → Productions → Segmentations → Segments.
- Graphics: Graphic sources → Graphic templates → Graphic objects.
- Rotation lists: Rotation lists → List items.

## A column

Header: collapse, title, **Create** (per level: Create / Create production / Create segment / Add
productions), "⋯" actions. Toolbar: search, **Advanced search** (blue while on; tooltip lists the
conditions), **Order by** (field list, ↑ / ↓), **Show expired** filter (contents and productions),
**Refresh**, tick-all. Rows: tick, content-type colour, name, a short meta on the right (counts,
length or "no length" in amber, "template", segment TCs, list order), the last inserted list item
marked; the selected row shows **Relations**. Footer: number of results, "Ordered by …".

## Actions ("⋯" per column)

| Column | Actions |
|---|---|
| Content types | Create from template (one ticked), Delete selected items |
| Contents | Create from template, Bulk edit, Schedule content to platforms (off: needs the non-linear module), Delete selected items |
| Productions | **Create series**, Create from template, Bulk edit, Schedule content to platforms, Delete selected items |
| Segmentations | Create (dialog), Create from template, Delete selected items |
| Segments | **Regenerate**, Create from template, Delete selected items |
| Rotation lists | Create rotation list, **Clone**, Delete selected items |
| List items | **Add productions** (shared catalog picker), **Shuffle**, Delete selected items |
| Graphics columns | Create, Create from template, Delete selected items |

A disabled action says why ("Tick exactly one item", "Select a content").

## Form panel

Entity and name; "Unsaved" while edited; **Relations**. Fields in collapsible groups (closed groups
show "N fields"), every field editable with the right control: text, number and timecode (mono),
long text, choice, switch, many-values chips ("+ Add"), colour, date (shared date picker; an empty
date shows "No date · Set date"), read-only values on grey. Required fields marked `*`. Footer
Cancel / **Save**, or **Create** for a new item (also from a template: prefilled, "(copy)").

| Entity | Groups |
|---|---|
| Content type | Content type (name, id, colour, type) · Grid (6 switches) · EPG and press (8 switches) |
| Content | Content · Dates · Description · Logos · Channels and companies |
| Production | Production (id with the source's pattern; "No length in the catalog") · Dates · Custom fields (STAR, GRAPHICS) · Description · Channels and actions · Media (status, available, proxy, published, external id, thumbnail, additional data = file path; View proxy / Go to the asset / Resync disabled without a MAM) |
| Segmentation / Segment | Segmentation or Segment (TC in / out / duration) · Media |
| Rotation list | Rotation list (name, last item inserted, insertion days interval) · Rules (5 switches) |
| List item | name, production, segmentation, order, inserted at |
| Graphic source / template / object | as in the spec; templates: Start · End · Frequency and layer |

## Dialogs

- **Create series**: content, title, initial episode (next free number), number of episodes,
  duration, segments, source; preview of the titles; "Create N productions".
- **Bulk edit** (contents, productions): field list with Set value / Clear field and the value;
  more than 50 ticked → red message, Apply disabled (a real case: all 108 episodes of one series).
- **Delete**: the ticked items with "Used in orders or playlists" / "Can be deleted"; if any is
  used, nothing is deleted (all-or-nothing) and the reason is shown.
- **Create / Regenerate segmentation**: name, source, number of segments, duration, production
  (and segmentation); preview of the segments' TCs; regenerate warns what it replaces.
- **Advanced search**: conditions (field, Contains / Is / Is empty / Between, value), + Condition,
  Clear, Search.
- **Relations**: tabs by level (spec §4): Linear relations, Graphics relations, Time windows,
  Product codes (advertising), Linear rights, Broadcast history; "!" on tabs with unsaved changes;
  add rows (jingle, graphic, time window); Save.
- **Broadcast history** (decision 0019): filled from 9eye's own published playlists — channel,
  date and time, block, first airing / repeat, source "Playlist"; as-run lines replace them once
  Reconciliation exists. The mockup shows Harbor Nights 20–25 from the week of 17 Oct.

## Rules

- All-or-nothing deletes and bulk edits; every action states what it will change first.
- Dates are calendar days (shared date picker); TCs in the catalog's frame rate.
- No other product's names or wording in the product.

## Done when

The page works on a full sample catalog (programmes, fillers, promos and commercials; lists and
graphics), with every action and dialog above, the shared pickers, and
undo-free Save / Cancel per form. Browser tests cover create / create from template / save,
series, bulk edit limit, delete blocked by use, segmentation regenerate, advanced search, each
Relations tab, list add / clone / shuffle.

## Decided

- Page approved as in the mockup (2026-10-22).
- Broadcast history from 9eye's playlists, later from as-run (decision 0019).

## Built (2026-10-22) — choices made while building, to confirm with the user

Page `apps/web/src/features/catalog/` at `/catalog`; shared `BrowserColumn` / `BrowserRow`,
`FormPanel` (+ `FormGroup`, `ChipsField`, `ReadValue`, `OptionalDateField`, `TimecodeField`,
`NumberField`, `SwitchField`) and `TabBar` in `apps/web/src/ui/`. API `/api/catalog/columns|items|
delete-check|delete|bulk-edit|contents/:id/series|productions/:id/segmentations|segmentations/:id/
regenerate|rotation-lists/:id/clone|items|shuffle|relations|lookups`
(`apps/api/src/services/catalogBrowse.ts`, `catalogItems.ts`, `catalogOps.ts`); shared rules in
`packages/core/src/catalog.ts`. Data model draft 8 §4b.

- **The sample catalog is test data** (user, 2026-10-22): content types, sources, logos, secondary
  actions, custom fields, time windows and graphics; series with many episodes, films, commercials,
  promos and fillers; rotation lists. Relations are not in the sample.
- **Broadcast history** shows "Not broadcast yet …" until the Day playlist exists (user: later; 0019).
- **Template productions** are marked in the Id (`[TEMPLATE]-…`), not the title; they are hidden in
  the catalog picker and shown as "template" here, as designed.
- **Production Id of a new production**: when left empty it is made from the source's pattern
  (tokens %T content type Id, %C content Id, %P episode, %A next production number). Aurora Media's sources
  are set to "production id" (not a custom pattern) and its Ids (`TV S-008089 - 1`) follow no pattern,
  so new Aurora Media Ids use `%T-%C-%A` unless typed.
- **Create series** refuses episode numbers that exist already (nothing created); each new
  production gets one segmentation with equal segments when a duration is given.
- **Bulk edit** applies at once in one transaction; values are typed
  (dates `YYYY-MM-DD`, channels / companies by name separated by commas, Source by name).
- **Delete** is a soft delete of the items and everything under them, refused (nothing deleted) when
  any is used by an order item ("Used in orders or playlists"), a rotation list item, a linear
  relation (jingle), a block type (rotation lists) or a graphics relation (graphic templates); a
  segmentation or segment counts as used when its production is in an order (mockup rule).
- Segmentations and segments have no media status field, so their Media group leaves it out.
- **Relations**: a graphics row takes its timing from the graphic template; graphic, segment, layer
  and channel are chosen per row. Add jingle opens the shared catalog picker (pick one).
- **Rotation lists**: Add productions refuses productions already in the list; Shuffle renumbers
  the items 1 … N and keeps the "last inserted" number; Clone names copies "(Clone)", "(Clone1)" …
- Date fields use the week start of most of the company's channels and the server's date.
- Not built: column widths per user, Play video / proxy / resync (no MAM), Schedule content to
  platforms (non-linear module), the advanced-search field "Created by" (no users yet).
