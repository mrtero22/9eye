# 0003 — One design system for the whole product

**Status:** Accepted, 2026-10-15 (user, via a question form).

## Decision

- The UI must be **one unified system**: no page has its own look.
- **Light + Dark** themes, switchable.
- **English** only, left-to-right (RTL can come later as a theme of the same system).
- ~~**Compact** density: 13 px text, 28 px table rows, 32 px controls.~~ **Superseded by
  [0009](0009-calm-ui.md):** calm by default (14 px, 32 px), Compact as a per-user setting.
  Controls grow to 44 px on touch screens in both.
- **Neutral style, Linear / Vercel-like:** grays plus one accent (blue). Red, amber and green only
  ever mean status (on air / error, next / warning, OK). Each content type has one fixed color used
  on every screen.
- Fonts: Geist for the interface, Geist Mono for timecodes, IDs and numbers. (Inter was mentioned
  first; Geist was chosen in the mockup because it fits the neutral style better.)

## How it is enforced

Three layers, each defined once: tokens → components → page templates (list, form / detail,
timeline editor, dashboard, settings). After the user approves the mockups, these rules go into a
project skill under `.claude/skills/` so every session builds pages the same way.

Details and token values: [../design/ui-foundation.md](../design/ui-foundation.md).
