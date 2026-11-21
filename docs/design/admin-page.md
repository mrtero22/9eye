# Admin page and channel settings (build reference)

Mockup: the Admin mockup (private) (board "Admin", updated by the user on
2026-10-17). Built in session 5 to match it: `apps/web/src/features/admin/`, API
`/api/channels…` and `/api/admin/…`. Routes: `/admin/<section>`, a channel at
`/admin/channels/<id>` (Templates header: "Change in channel settings").

## Layout

Page header "Admin" with one line: "Settings for <company>: channels, people, rules and
connections. Changes apply to this company only." Left: every section, grouped (Organisation ·
Channels · Scheduling rules · On screen · Content · Output · Audience · System); sections not built
yet say **later** and open a short "not built yet" page. Built: **Companies, Users, Roles,
Channels, Plugins and MAM**.

| Section | What it shows |
|---|---|
| Channels | Table: channel (name + code), playlists (Main / Ads), day starts, week starts, frame rate, default rotation list; search; **New channel**. A row opens the channel |
| Channel | Breadcrumb "Channels / name", name + code; change count, Discard, Save. Cards in a two-column grid: **Channel** (name, code, channel group), **Time** (frame rate, broadcast day starts, first weekday, time zone, date locale), **Playlists** (main always, ads switch, age logo position), **Defaults** (rotation list for gaps, break list, shortest break), **Export and EPG** (default export, EPG types, allowed exports, BXF times in UTC), **Checks and reconciliation** (playlist checks, tolerance). Right column: **Used by** (templates, opens Templates), **What can change** (the rules below with a status dot), **Export file name** (today's file of the default export) |
| Roles | Roles on the left with member counts; a module × action table (View · Edit · Approve · Export; "—" where an action does not exist); channels the role can work on (all / selected); Save changes; New role |
| Users | Table: user, companies and roles, MFA, last active, ⋯ (change role, remove from this company); Invite user |
| Companies | A card per company: mark, name, live with N channels or not set up, templates and exports, Open settings / Set up company; Add company |
| Plugins and MAM | A row per connection: name, what it is for, status, Connect / Configure; Add connection. "Credentials are encrypted and never shown again after saving." |

## Channel rules — one save, all-or-nothing (unchanged from session 4)

- **Frame rate and day start** are locked (disabled, lock icon) while the channel has templates or
  block types: their times are stored in frames counted from the day start. The server refuses
  too; the day start is compared as a time of day.
- **First weekday:** while any template does not start on the new first weekday and end on the
  day before it, the Time card says so, lists those templates with "Open", and Save is disabled.
  The server refuses as well and lists them.
- **Ads playlist off:** blocked while the ads playlist has templates or block types, or a main
  template has linked breaks.
- Name and code unique; time zone and date locale must be known; the default export must be an
  allowed one (picking a default adds it); a stale save is refused (version).

## Choices made while building (to confirm with the user)

- Roles, users, companies and connections are stored for real (decision 0007, data model §2),
  without sign-in yet: a development **Local user** (platform admin) is company admin of every
  company; invited people cannot log in until sign-in exists.
- Platform admin is a flag on the person (data model §2), shown as the first, fixed row of Roles;
  Company admin can do everything and cannot be changed; a company keeps at least one company admin.
- Connections are never shown as "Connected": nothing is tested against the other system yet, so a
  row is "Not connected" or "Set up, not checked". The mockup's row for an older traffic system is
  left out (no other product's name in the product, 0015).
- Channel group, rotation list for gaps and playlist checks are shown as in the mockup but cannot
  be chosen yet (channel groups, the catalog and playlist checks come later). The default rotation list
  is kept by name (the list in the system the channel came from).
- Exports offered: Playout XML, BXF, BXF Amagi, CSV, QMS, Nexio, ADC (the ones with a known file name);
  more come as plugins (0005).
