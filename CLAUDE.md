# 9eye — global broadcast scheduling & traffic platform

> "9eye" is the product's name (final, user 2026-10-29; it started as a codename). Maintainer notes
> that only concern one machine are in `CLAUDE.local.md` (not in git) — read it too when it exists.

## What this is

A commercial, multi-tenant product for TV channels anywhere in the world:
**catalog / media → grid → playlist → orders & placement → export to playout → as-run**.

Any company, any channel concept: series, film, music, news, sport / live, kids, FAST / OTT,
public (no ads), multi-feed / time-shifted. **No single company is the target design.**
Never put customer-specific logic in the core. Anything that differs between customers or channels
is configuration (channel profile, rules) or a plugin — see `docs/decisions/0005`.

## Start here — every new session

1. Read `CLAUDE.local.md` when it exists: it names the maintainer's handoff (current state, next
   step, open questions).
2. Read `docs/decisions/README.md`: accepted decisions. Do not re-open them unless the user does.
3. Do the task.
4. At the end of a chunk of work, update the handoff when there is one (and add a decision file when
   something was decided), so the next session can continue without this conversation.

## Working with the user

- Docs and code are in English.
- **Ask before ANY write**: files, git commits, database, Docker, services, package installs,
  deploys, Apache. Say exactly what will be written and where, then wait for an OK.
  Read-only commands are fine.
- Keep scope minimal: build only what was asked; never change other behaviour on the side.
- Bulk operations are all-or-nothing: on any conflict, create nothing.
- Give one recommendation with its reason, not a survey of options.
- **No real customer or third-party product names in the repository** (user, 2026-11-17): code,
  docs, file names, tests and sample data use made-up names (the sample company is Aurora Media).
  `npm run check:names` checks it.

## Ports

Reserved for 9eye (all bound to `127.0.0.1`):

| What | Value |
|---|---|
| API | port 4100 |
| Web (dev) | port 4101 |
| Public website (dev) | port 4102 |
| Postgres | Docker container `9eye-db`, port 5442 |

No global installs (`npm -g`, `apt`) without asking. Host Node is v20; `/opt/node24` also exists.

## Product rules

- **A new product:** our own data model, API, screens and words, designed from the behaviour a
  broadcaster needs (decision 0015).
- **Use the calm look of the 2026-10-15 mockups** (user, 2026-10-16): page header with channel
  picker and actions on the right, list on the left, simple vertical grid or table in the middle,
  details panel on the right; actions in an Add button and a "⋯" menu; rarely used fields in the
  details panel. Bolder layouts (horizontal timelines, outline + cards) were rejected — do not
  propose them unless asked. Screens must be simple and clear.
- **Build screens from their mockup** in `docs/design/mockups/` and their page doc (e.g. `docs/design/templates-page.md`). Data in mockups is sample data.

- **UI:** one design system; every page is built only from shared tokens and components.
  No page-specific styling. See `docs/design/ui-foundation.md` and decision 0003.
- **Time:** integer frames, frame rate per channel, optional time zone per channel (decision 0004).
- **Customer differences** = configuration or plugin, never a code fork (decision 0005).
- **MAM:** any MAM through an adapter; never depend on one (decision 0008).
- **Sales / billing:** later (decision 0006).
- **Secrets:** encrypted at rest, never sent back to the browser, never committed.

## Layout

Decision 0017. Run commands: `README.md` ("Run it locally").

```
packages/core/         frames / timecode, weeks, template rules — shared by API and web
apps/api/              Express + Prisma (schema in prisma/), port 4100; tests on the nineeye_test DB
apps/web/              React + Vite + Tailwind + Radix, port 4101; src/ui = the design system
apps/web/e2e/          Playwright browser tests (throw-away company)
apps/site/             public website (Astro, static, port 4102 in dev; decision 0022) — runs on /opt/node24
scripts/               repository checks (check-names)
.claude/skills/9eye-ui design-system rules for every page — load before UI work
docs/decisions/        one file per decision (accepted / proposed)
docs/design/           data model, UI foundation, page docs, mockups/
var/, .cache/, .env    git-ignored: local dumps, browser binaries, secrets
```
