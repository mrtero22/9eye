# 0017 — Code stack and layout

**Status:** Accepted, 2026-10-17 (the build plan, approved by the user).
The implementation details below were chosen while building slice 1; change them with a new decision.

## Decision

One repository, npm workspaces, TypeScript everywhere, Node 20 (host).

| Part | What | Notes |
|---|---|---|
| `packages/core` | Frame-accurate time (all frame rates incl. 29.97 / 59.94 drop-frame), weeks, template rules, linked-break position matching, pure editing operations, UUID v7 | Runs in the browser **and** the API: the same rules give instant feedback and are enforced on save |
| `apps/api` | Express 5 + Prisma 6 + Postgres 16, port 4100 (127.0.0.1) | Prisma schema = data model §5 (templates). Tenant isolation in one place: a Prisma query extension adds the company to every query on a tenant-owned model (AsyncLocalStorage per request) and fails when there is none. Row-level security comes later as the second guard (0007) |
| `apps/web` | React 19 + Vite 7 + Tailwind 4 + Radix, port 4101 (127.0.0.1) | The design system lives in `apps/web/src/ui` (tokens in `tokens.css`; the Tailwind default palette is switched off). Rules for every page: project skill `.claude/skills/9eye-ui` |
| Database | Docker container `9eye-db` (postgres:16-alpine), 127.0.0.1:5442, 512 MB limit, volume `9eye-db-data`; databases `nineeye` (dev) and `nineeye_test` (API tests) | Password only in `.env` (git-ignored) |
| Tests | Vitest (core unit, API integration on `nineeye_test`, web units); Playwright e2e against the running app with a throw-away company | Browser binaries in the repository's `.cache/` (git-ignored) |

Conventions: integer frames for every time (0004); dates as plain `YYYY-MM-DD`; UUID v7 keys;
templates saved whole with an optimistic `version` (a stale save is refused, nothing written);
every bulk change is all-or-nothing; the API sends our own field names (0015).

## Not yet

Sign-in and memberships (0007): until then the company comes from the `X-Tenant` header, picked in
the top bar from a development-only company list. Audit log, created-by / updated-by, soft-delete
filters beyond templates and block types, row-level security, production build and deploy.
