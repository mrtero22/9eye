# Contributing to 9eye

Thank you for helping. This page says how to set up, what a good change looks like, and how it gets in.

## Before you start

- **Bugs:** open an issue with the steps, what you expected and what happened (the bug form asks for
  it). Security issues go through [SECURITY.md](SECURITY.md), never a public issue.
- **Features and larger changes:** open an issue first and describe the broadcaster's need. Accepted
  decisions are in [`docs/decisions/`](docs/decisions/README.md); a change that goes against one starts
  with a new decision file that supersedes it.

## Set up

Follow [Quick start](README.md#quick-start). Then check that everything passes before you change anything:

```bash
npm test
npm run typecheck
```

## Rules of the code

- **One core, no customer forks.** Anything that differs between companies or channels is a setting, a
  rule or a plugin (decisions 0001, 0005) — never `if (company === …)`.
- **Time is integer frames** (decision 0004). Use the helpers in `packages/core/src/timecode.ts`; never
  floating-point seconds for lengths or start times.
- **Shared rules live in `packages/core`** when both the API and the web app need them.
- **Bulk operations are all-or-nothing:** one transaction; on any conflict nothing is written, and the
  answer lists what is in the way.
- **One design system** (decision 0003): pages use only the components and tokens in `apps/web/src/ui`;
  no page-specific CSS. The page rules are in [`.claude/skills/9eye-ui/SKILL.md`](.claude/skills/9eye-ui/SKILL.md).
- **Plain words** on screen: short, everyday words a scheduler understands; check Light and Dark,
  Calm and Compact, and phone width.
- **Made-up names only** in code, tests, docs and sample data (decision 0015). `npm run check:names`
  runs first in `npm test`.
- **Secrets** are encrypted at rest, never sent back to the browser, never logged, never committed.

## Tests

Every change comes with its tests:

| What changed | Where the test goes |
|---|---|
| A rule in `packages/core` | `packages/core/src/*.test.ts` (Vitest) |
| An API route or service | `apps/api/test/*.test.ts` (Vitest + Supertest on the `nineeye_test` database) |
| A component or helper in the web app | `apps/web/src/**/*.test.ts` |
| A whole page flow | `apps/web/e2e/*.spec.ts` (Playwright, against the running dev servers) |

## Pull requests

1. Branch from `main`; keep one topic per pull request.
2. Write commit messages in the imperative, saying what changes for the user ("Book spots for a whole
   date range"), with the why in the body when it is not obvious.
3. Run `npm test` and `npm run typecheck`; add screenshots for visible changes.
4. Open the pull request and fill in its checklist. A maintainer reviews it; CI must be green.

By contributing you agree that your contribution is licensed under the project's
[AGPL-3.0 license](LICENSE).
