# Orders page — commercial contracts and orders (proposal)

_Proposed 2026-11-13 (user: "first we build the commercial part"; Day playlist part 4, export,
waits). Revised 2026-11-14: the order page is a **week board** where each day shows its own boxes
and breaks (user: a channel's boxes and breaks differ from day to day; booking by hand must be very
easy, clear and professional). Mockup: the
"Orders" board of the design canvas (the Orders mockup (private)). Our own
arrangement and words (0015)._

## What it is for

A sales or traffic person books a campaign: the **company** (advertiser or agency), its **contract**
(the campaign: dates, channels, currency), and per channel a **commercial order** that books **spots**
(versions of the advert) into **ad breaks** on days. The ads playlist of each day then takes those
spots in (**Auto-place ads**), and the main playlist takes the ads breaks in (Import break events,
built).

A typical channel group: one contract per campaign, named after the client; one order per channel;
every spot one pass, mostly in one position; one to six breaks per hour block; several versions per
order spread over the breaks; no prices, ratings, clash codes or multi-channel orders.

## Where it sits

`/orders` (the Orders link of the top bar). Three levels, each its own URL:

1. **Contracts** (`/orders`) — with a **Clients** tab (`/orders/clients`).
2. **One contract** (`/orders/contracts/:id`) — its details and its orders, one per channel.
3. **One commercial order** (`/orders/:id`) — the week board of one channel (part B).

**Built 2026-11-14 (part A, user: "build the commercial page"):** levels 1 and 2. Advertisers and agencies
are called **clients** in 9eye (table `client`), because Admin → Companies already
means the companies that use 9eye. API under `/api/commercials/` (clients, contracts,
`contracts/:id/orders`, `orders/:id`); `features/orders/` (OrdersPage, ClientsTab, ContractDialog,
ContractPage); commercial orders are orders of mode `commercials` with a `contract_id`, kept out of
Scheduling's list and week. Not yet: Duplicate contract, Change currency, Move order, Duplicate to
other channels, Report (part D), and opening an order (part B). Commercial orders and booked spots
come with part B.

## 1. Contracts

Page header: title, **New contract** (primary). A filter row: search (contract or company), state
(**Running** — the default — Upcoming, Ended, All), channel, company. A list table (shared
`DataTable`):

| Contract | Company | Dates | Channels | Orders | Spots booked | |
|---|---|---|---|---|---|---|
| NOVAMART | NOVAMART | 23 Oct – 4 Dec 2026 · ends in 3 weeks | 19 | 19 | 15 532 | ⋯ |

Row actions (⋯): Open, Duplicate, Delete (only without placed spots in published days). Ending soon
(≤ 7 days) shows an amber note in Dates.

**Clients** tab: the list (name, type, country, contracts; a search) and a form panel: Name, Type
(Advertiser, Agency, Advertiser and agency), Country, Address, Billing address, Web, E-mail, Phone,
VAT number, Notes, **Tolerance** (how far a spot may air from its booked time when the as-run is
matched; off by default).

## 2. One contract

Header: contract name, company, dates, state; actions **New order**, ⋯ (Duplicate contract, Change
currency, Delete).

- **Orders** (default tab): one row per order — channel, dates, spot versions, spots booked, this
  week, state (Confirmed / Draft), ⋯ (Open, Duplicate to other channels, Move to another contract of
  the same company, Delete). **New order** asks for one or more channels (of the contract) and makes
  one order per channel, named "<channel> - <contract> - START <date>" (Aurora Media's naming; editable), on
  the channel's main template, with the contract's dates.
- **Details**: Name, Company, Start / End date, Channels, Currency, Total agreed, notes; computed
  totals (spots booked, placed, aired — aired comes with reconciliation).
- **Report**: later (part D).

## 3. One commercial order — the week board

The order's own layout, not the Scheduling calendar. A channel's days do **not** share one set of
breaks. On a typical channel, most
weekdays are alike, but one day splits an hour into two 30-minute boxes and another has a long box
with breaks of its own and fewer breaks in the evening. Sales books those days' own breaks by hand.
So the board
never lines breaks up across days: it lines up **hours**, and each day shows what its own template
has.

- **Header**: order name, state, channel · template · dates · spots booked; Undo / Redo, **Book
  spots…**, ⋯ (Copy week to the whole order, Rotation…, Move spots…, Split order…, Replace spots…,
  Clear all spots…, Duplicate order, Report), Save (primary).
- **Left panel** (stays in view while the board scrolls):
  - **Book with**: the order's spots (versions, from the catalog picker, advert family), each with
    its colour mark V1, V2…, length and how many are booked this week. The chosen one is what a
    click books.
  - **New bookings get**: position (default: the company's default break position) and passes (1).
  - **Order details** (closed by default): name, contract, channel, template, start / end, state
    (Confirmed / Draft), clash codes and limits.
- **The board**: the week picker (channel week) above; **one column per day**, **one row per hour**
  (13:00 – 01:00 by default — the hours the order books — or evening only; later the whole day).
  Each **box** of a day is one quiet grey card (a dot in the colour of its block type and its full
  name, on two lines when long); a box longer than an hour is one tall card over its hours, two
  30-minute boxes are two small cards in one hour. In the card, **its breaks** in time order, one
  plain line each: the time, then the kind ("13:30 Ad Pod"), no frames. Only a **booked** break
  stands out: a white line with the spot's colour bar and its mark (and ×2 when the same spot is
  booked twice in the break, as Aurora Media does on Friday 22:30). How full a break is with **all** orders
  is not drawn on every line: a small dot marks the exceptions (amber from 90 %, red when over);
  hover and the break's panel give the figures. A day whose boxes differ from the rest of the week
  has a small **own layout** tag in its header (hover: at which hours). Each day header also gives
  its spots and seconds. (First drawing, 2026-11-14: a frame and a fill line on every break —
  refused as cluttered; the rule now is that empty breaks stay quiet and only bookings and
  exceptions carry colour.)
- **Booking by hand** — two click modes:
  - **Book** (default): click an empty break and the chosen spot is booked there at once (one Undo
    step; a toast says what was booked, with Undo). Click a booked break to open its panel.
  - **Select**: click breaks, an **hour** (its label) or a **day** (its header) to select them;
    Shift-click selects in Book mode too. A bar then offers **Book V1 in N**, **Remove from N**,
    **Same breaks on every day** (adds the same breaks on every other day that has them and says
    what it left out: "Fri has no Billboard 5 14:45: left out"), and Clear.
- **One break's panel** (floats over the board's right side): the day, its box and the box's
  time; how full the break is (sold / free, all orders); this order's spots in it — spot, position,
  passes, remove; book once more; and **the same break on the other days**: one chip per day —
  booked ✓ (opens that day's break), free (a click books it), or dashed and disabled when that day
  has no such break — plus "Book on the N other days that have it".
- **Toolbar** (one line): the week, Book / Select, then two small menus — which breaks (All / SP /
  Ad Pod) and which hours — and Booked only.
- **Book spots…** (dialog, for whole date ranges; 9eye's way to do in one go what Aurora Media does by
  hand): a table of **every break name of the week × the days** — ● booked already (keeps its
  spot), + will be booked, – that day has no such break — with a "Days with it" column ("6 days ·
  not Fri"); quick picks (All Ad Pod, All Billboard 1, All Billboard 5, an hour range, None); weekdays on / off;
  from / to (this week to the order's end by default); position; passes; the spots and how they are
  spread — **rotate over the breaks, starting again each day** (Aurora Media's rule: break 1 → V1, break 2 →
  V2, …) or **the same spot everywhere**. It counts what it books ("Books 84 new spots: 28 a week ×
  3 weeks (14 Nov – 4 Dec) · 0:21:00") and lists what each day skips; one Undo step.
- Rules: a spot goes only into a break that day's template has; dates inside the order; the spot's
  length is read from the catalog; a break may hold the same spot more than once. Saved whole with a
  version (409 on conflict), as Scheduling orders.

The mockup shows NOVAMART's AURORA SD order, week 46: the sample company's bookings (29
spots a day) on AURORA SD's main and ads templates. How full the breaks are is example figures.

**Built 2026-11-14 (part B):** `/orders/:orderId` (`OrderPage.tsx`, `BookSpotsDialog.tsx`, the shared
`BreakBoard`). How full a break is now counts the real booked spots of every other commercial order
(plus this one's); a break's start is its block's start in the channel's ads template on that day,
shown in the channel's timecode, its name without a trailing clock. Differences from the mockup:
no SP / Ad Pod filter (break names are the customer's own) — Whole day (the default: every hour with a
block) / Booked hours (first to last hour with a saved booking, never the edits in progress — 2026-11-14:
with it as the default the first booking of an empty week hid every other block) and Booked only remain; Save keeps the week shown (moving to another week with changes asks first); Book
spots… counts on the server and books at once (it needs the week saved first), so it is not an
Undo step; spots are added from the catalog picker (commercials) and removed while unbooked; the
order's name, state and dates are saved from "Order details". API: `GET /commercials/orders/:id`,
`PUT` (name, state, dates, spots), `GET` / `PUT …/week` (the week's bookings replaced whole), `POST
…/book` (`apply` false = count only). A booked spot is an `airing_item` with `break_type_id` and
`position_id`; its airing names the main-template block of the day. Not yet: Copy week to the
whole order, Rotation, Move / Split / Replace / Duplicate, Report (part D).

**Added 2026-11-16 — the sidebar's Break field** (user: when the break is the same, a click on the
block should be enough; each option one break). "The one I click" (the default, as before) or one
break by its **name without the hour**: Aurora Media names every hour's breaks alike (Billboard 1 06:00, Billboard 2 06:10,
Ad Pod 06:30, Billboard 5 06:45, Billboard 6 06:50, Ad Pod 06:53), so the options are "Billboard 1 :00", "Billboard 2 :10",
"Ad Pod :30", "Billboard 5 :45", "Billboard 6 :50", "Ad Pod :53" — one break in each block (a 1-hour block has both
Ad Pods; the bare name "Ad Pod" would be two). A name without a clock is offered as it is. With a
break chosen the board is compact: one line per block, its name only; the booked mark is that
break's, this order's spots in the block's other breaks show muted beside it; a block without that
break is greyed. Book: a click on a block books into that break (a booked one opens it); Select:
blocks, days and hours select that break of each block, so "Book V1 in N" fills them. The spot list
scrolls inside the sidebar so the fields below it stay in view.

## 4. How the spots reach the playlist (Day tab, ads playlist)

- **Auto-place ads** (sidebar Add item, now enabled on the ads playlist; also a step in "Steps for
  this day"): each booked spot of the day's confirmed commercial orders goes into its break of the
  ads playlist, in break-position order, while the break has room (a
  fixed-point loop, room in the break, position order, the same spot never back to back, clash
  codes). The result dialog as in part 3: placed / not placed with the reason.
- **Manual ads**: pick a commercial order, then its booked spots of that day, and put them in at the
  selected place.
- **Unplaced ads report** (Tools): every booked spot of the day not in the ads playlist, with why.
- **Issues**: "N booked spots are not in the ads playlist", "N spots in the ads playlist are no
  longer booked".
- Then the main playlist's **Import break events** brings the breaks in, as built.

**Built 2026-11-16 (part C).** Core `fillCommercials` (`dayFill.ts`): the booked spots of the day's
confirmed commercial orders, each pass into an ads-playlist block of its ad break (the block whose
block type is the booked break); a block takes a spot while its length holds its rows plus the spot;
the spot never sits next to itself; spots keep break-position order (a row that is not a booked
spot counts as the default position); spots, blocks and gaps are tried in random order and
the pass repeats until nothing more goes in; the report lists spots by break time; the reason shown is the first met (no such break · no
room left · would air right after itself · break position does not fit · no length). A placed row
keeps its booking: `playlist_event.airing_item_id` (and `order_id`); saving a day refuses a row whose
booking is gone. Saving an order's week keeps the ids of the booked spots that did not change, so
the links hold. Day page, ads playlist: **Auto-place
ads** in the sidebar, the step **Commercial orders** (Import into this day and Steps for this day;
since 2026-11-16 they run at once — only what is missing, all again when spots are no longer booked),
**Unplaced ads report** in Tools (the same run shown as "Can go
in" / "Cannot go in", with "Put what can go in into the day"), **Manual ads** (an order, its booked
spots of the day — those still missing a pass ticked — put in at the selected place, linked to their
booking), issues "N booked spots are not in the ads playlist" and "N spots in the ads playlist are
no longer booked". Draft orders are left out and said so. Not done: clash codes / product codes
(the sample company has none), pre- / post-roll jingle pairs, and placing several channels at once.

## 5. Break positions (Admin) — built 2026-11-14

Admin → Break positions (`BreakPositionsSection.tsx`): a table of the company's positions in break
order — order, colour, name with a Default badge, price modifier, content types ("Any" when none) —
with a grip on each row (drag it, or focus it and use the arrow keys); a click opens the position in
a side panel: name, colour, order with Move up / Move down, Default position (turning it on turns
the others off), price modifier in % (decimals, −100 … 10 000), content types (none = any), Remove
position. "Add position" adds one at the end (the first is the default). The list is saved as a
whole with **Save changes** (a change count and Discard beside it), all-or-nothing; a position
without a name blocks Save; someone else's change in between stops the save with Reload.
API: `GET` / `PUT /admin/break-positions` (`rows` in order + `deletedIds`). The sample company
has eight (Channel Ident 1 … Promos 8; **its default is Commercial**, not Commercial Top).

## Data (data model §7b, to add)

- `company`: tenant, name, type, country, address, billing address, web, email, phone, vat number,
  notes, tolerance (frames, null = off).
- `contract`: tenant, company, name, start / end date, currency, total agreed, notes, version;
  `contract_channel` (contract, channel).
- `order`: + `contract_id` (commercial orders), mode **`commercials`**; clash-code fields later.
- `airing_item`: + `break_type_id` (the ads block type: the break), `position_id`; a commercial
  airing is one main block on one date, its items the booked spots.
- `break_position`: tenant, name, order, is_default, colour, content type ids, price modifier.
- `playlist_event` (ads playlist rows a commercial order put in): `order_id` (exists) + the booked
  item, so the unplaced report and Issues can compare.

## Build order (each part usable on its own)

| Part | What | Done when |
|---|---|---|
| A · Companies and contracts | Data, Companies tab, Contracts list, one contract with its orders (create one order per channel), Break positions in Admin | The sample company's contracts and clients are listed |
| B · Book spots | The order page: week board (each day its own boxes and breaks), Book / Select modes, the break panel, Book spots…, Copy week to the whole order, Save | NOVAMART's AURORA SD order shows its spots for a week, Thursday's and Friday's own breaks included |
| C · Into the ads playlist | Auto-place ads (with its tests), Manual ads, Unplaced ads report, steps and issues | A day's ads playlist holds every booked spot that fits |
| D · Reports and the rest | Order and contract reports, Rotation, Move, Split, Replace, Duplicate; later prices and ad rates (0006), the booking system import, multi-channel orders | Each with its tests |

## Questions for the user

1. **The week board** (days side by side, hours lined up, each day with its own boxes and breaks;
   a click books the chosen spot) instead of the Scheduling calendar for commercial orders — OK? It
   is our own arrangement. (Replaces the first proposal, a grid of fixed
   break rows × days, which could not show days with other breaks.)
2. **Book spots…** as a 9eye addition (Aurora Media's rule: rotate the versions over the breaks, starting
   again each day) — OK?
3. **New order** makes one order per chosen channel, named as Aurora Media names them — OK?
4. Prices, ad rates, ratings and multi-channel orders after parts A–C (Aurora Media uses none of them) — OK?
