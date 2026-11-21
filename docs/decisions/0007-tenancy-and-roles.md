# 0007 — Tenancy and roles

**Status:** Accepted, 2026-10-15 (user).

## Decision

- **One Postgres database, `tenant_id` on every tenant-owned row**, enforced in one place in the
  data layer, with Postgres row-level security as a second guard.
- **One user, many companies:** a user has a membership per tenant, each with its own role, and
  switches company from the header without logging in again.
- **Roles = module × action × scope.** Modules: catalog, grid, playlist, orders, as-run, reports,
  admin. Actions: view, edit, approve, export. Scope: all channels, or selected channels / channel
  groups. A platform-level admin sits above all tenants.
- MFA (TOTP), an audit log of who changed what, admin impersonation that is itself logged.
- Connector secrets encrypted at rest and write-only in the UI.

## Rejected alternatives, from a survey of existing systems

- **Database per tenant**: tenants drift onto different schema revisions, and nothing can be shared
  between a group's companies.
- **Permissions generated per object** (one per subchannel and one per content type): an admin
  account ends up with hundreds of permission strings, and every new monthly content type adds
  more. Profiles become impossible to maintain.

