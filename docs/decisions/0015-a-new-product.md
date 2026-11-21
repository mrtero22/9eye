# 0015 — A new product in name, words and code

**Status:** Accepted, 2026-10-16 (user).

## Decision

9eye is its own product. Everything in it is designed and written here:

- **Our own data model and API**, designed from what a broadcaster needs — no other product's entity
  or endpoint names.
- **Our own screens** on the 9eye design system (0003, 0009): calm, top navigation, one design system
  for everything.
- **Our own words.** Generic industry terms are fine (playlist, grid, break, segment, catalog, as-run,
  BXF, EPG); everything else gets a plain name of our own.
- **Nothing copied:** never another product's code, CSS, icons, images, help texts, wording or screen
  arrangement.
- **Made-up names only:** sample data, tests and docs use made-up companies, channels and shows (the
  sample company is Aurora Media). `npm run check:names` checks it and runs first in `npm test`.
