# Catalog picker — shared component (build reference)

One picker for everything taken from the catalog. Asked by the user on 2026-10-18 ("Pick from
catalog needs one UI / UX we can use wherever we want; it is used in many places"). Mockup:
the CatalogPicker mockup (private) (the component, with a sample
catalog) and the "Catalog picker" section of
the Main mockup (private). The Scheduling (New order, Add from catalog) and
Playlist (Add · Content) mockups already use it. Build it once in the shared UI
(`apps/web/src/ui/`); pages never build their own catalog browser.

## Shape

A dialog over the page (never a new page), closing back to where it was opened. Size: width
`min(1240px, viewport − 64px)`, height `min(760px, viewport − 64px)` (user, 2026-10-18: wider, so
long promo / ident names are not cut); columns 220 px · 280 px · the rest for productions.

1. **Header**: title ("Pick the series", "Add episodes", "Add content") and one line of context
   ("To Harbor - Lumen Plus · new episodes join the end of the list"); close.
2. **Toolbar**: search (titles and house IDs of the whole catalog, `/` focuses it); kind tabs when
   more than one kind is allowed (Programmes · Fillers & promos · Commercials, the catalog's three
   content-type families); filters: Ready media only, Valid on <date> when the page gives a date.
3. **Three columns**, the same path as the Catalog page: content types of the
   kind (with counts) → contents of the type (with production counts; a dot where something is
   already picked) → productions of the content.
   - Production row: tick (or radio for one), episode number, title, house ID, length (mono).
   - Marks on the row: **In this order** (greyed and not pickable when the page passes `already`),
     **No length in catalog** (amber; Harbor Nights has 17 of 40 without one), media not ready, not
     valid on the date. The template production (`[TEMPLATE]`, chapter 0) is hidden and counted in
     the header ("1 template episode hidden").
   - Series pick: "Episodes 1 to 40" range above the list (all by default), Select all / none.
4. **Search results** replace columns 2–3: matching contents first (click opens them), then
   productions grouped by "Type › Content".
5. **Footer tray**: what will be taken and its length ("Spider Noir · 10 episodes (1–10) · 4 h
   27 min known · 2 without a length"); Clear (multi), Cancel, primary ("Use 10 episodes", "Add 3
   items", "Pick"). Keyboard line: / search · ↑ ↓ move · Space tick · Enter use · Esc close.

## API

| Prop | Values | Meaning |
|---|---|---|
| `pick` | `series` · `items` · `one` | One content with its episodes in order (all or a range); several productions from any contents (kept while browsing); exactly one production |
| `families` | `program`, `filling`, `advert`, `graphics` (comma list) | Kinds that may be picked; `graphics` opens the graphics catalog |
| `startType`, `startContent` | names / ids | Where it opens (e.g. the order's own content) |
| `already` | production ids | Marked "In this order" (built: ids instead of the mockup's `content#episode` keys) |
| `date` | day | Validity check against starts / expires |
| `title`, `context` | text | Header |
| `trigger`, `triggerStyle` | text; `dashed` · `button` · `small` · `none` | The opening control; `none` when a menu opens it |
| `showResult` | boolean | In a form: after the pick the field shows what was taken, with Change |
| `variant` | `dialog` · `inline` | Inline only for the design board |
| `onPick` | `{ mode, content, type, items: [{ content, title, chapter, houseId, length }] }` | Once per pick |
| `onClose` | | When it closes without or after a pick |

## Built (2026-10-22)

`apps/web/src/ui/CatalogPicker.tsx`, reading `GET /api/catalog/types|types/:id/contents|contents/:id/productions|search`.
Also: `open` / `onOpenChange` (trigger style `none`), `frameRate` (lengths in the channel's
timecode). "Ready media only" and "Valid on <day>" are filters; a row not valid on the day is marked.
The graphics family shows a note until the graphics catalog exists. Used now by Scheduling (New
order, Add from catalog, Replace items).

## Where it is used

| Page | Where | Picks | Kinds | Marks |
|---|---|---|---|---|
| Scheduling | New order · Episodes / items | Series or items (by the order's mode) | By mode (series / programmes → programmes; promos / jingles → fillers & promos; graphics → graphics) | Valid on the first airing date |
| Scheduling | Order details · Add from catalog | Items, opening on the order's content | The order's kind | Already in this order |
| Scheduling | Replace items | One item | The order's kind | Already in this order |
| Playlist | Add · Content | Items | All kinds | Valid on the day, media ready |
| Playlist | Find & replace | One item | Same kind as the event | Valid on the day |
| Templates | Rotation list of a block | Items | Fillers & promos | — |
| Catalog | Rotation lists · add items | Items | All kinds | Already in the list |
| Orders (commercials) | Spots of an order | Items | Commercials | Already in the order |
| Acquisitions, rights | Titles of a package | Series or items | Programmes | Already in the package |

New places use this component with one of the three pick modes; no new kinds without asking.

## Notes from the sample catalog

- Many content types in three families (programme; filling: promos, fillers, idents, music;
  advertisement); a large type holds hundreds of contents.
- Every series content seen has a `[TEMPLATE]-…` production with chapter 0 — hidden by default.
- Lengths are often 00:00:00 for later episodes; the picker shows it before the pick, the
  playlist checks it again.
- Order item lists can differ from the catalog now (an episode can be shorter in the order than
  in the catalog) — that is what "Refresh durations" on an order is for.
