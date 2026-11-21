# Sign-in page

Asked by the user on 2026-10-27: 9eye goes on a domain for development, so nobody may enter without
signing in; "the look of the sign-in page matters to me". Rules: [decision 0021](../decisions/0021-sign-in.md).
No mockup board: the page is built straight from the design system (`docs/design/ui-foundation.md`)
and was reviewed from screenshots.

## Layout (`SignInLayout`, shared)

```
┌ form side (surface) ─────────────────────┬ picture side (surface-2), from 1024 px ─┐
│ [mark] 9eye                     [theme]  │                                          │
│                                          │   ┌ Channel one · Today · 25 fps  ● On air ┐
│            Sign in                       │   │ 06:00:00:00 ▌ Morning Report  00:58:30:00│
│            Welcome back. …               │   │ …  (the on-air row with a thin bar)      │
│            Email     [            ]      │   └──────────────────────────────────────────┘
│            Password  [         (eye)]    │   Plan the grid, build the playlist, …     │
│            [         Sign in        ]    │   Catalog, templates, scheduling …         │
│            Forgot your password? …       │                                          │
│ 9eye · scheduling and traffic …  Dev …   │                                          │
└──────────────────────────────────────────┴──────────────────────────────────────────┘
```

- Form 360 px wide, in the middle of its side; 40 px controls (`TextField large`,
  `PasswordField large`, `Button size="lg"`), the one primary action full width.
- Top corner: a quiet Light / Dark theme button (the user menu is not there before sign-in); the
  choice is the same per-browser setting as the user menu's Theme.
- Picture side: a sample day of "Channel one" (sample data, not a customer's): times and lengths
  through `formatTc` at 25 fps in mono, a content-type colour bar per row, the on-air row on
  `surface-2` with a thin progress bar, then one headline and one line of text. Hidden below
  1024 px; on phones only the form shows.
- The product name and mark come from `ui/brand.tsx` (`PRODUCT_NAME`, `Wordmark`): "9eye" is a
  codename, the brand changes there only.

## Behaviour

- Every page asks for sign-in first: `/templates` → `/sign-in?next=%2Ftemplates`; after signing in
  the person lands on that page (only a path of this app, never another site).
- Empty fields: "Type your email and password." Wrong e-mail or password (one message for both):
  "Email or password is not right." — the password is cleared and focused, the e-mail stays.
- Locked (five wrong passwords, 0021): "Too many tries. Try again in N minutes."
- While signing in the button reads "Signing in…" and is disabled. Enter submits; password managers
  fill it (`autocomplete` username / current-password).
- Show / hide password (eye button, "Show password" / "Hide password"); "Caps Lock is on." under the
  field while it is on.
- A session that runs out (or is signed out elsewhere) sends the next API call back here with
  "You were signed out. Sign in again to continue." and returns to the page afterwards.
- "Forgot your password? Ask your company admin." — passwords are set in the terminal for now
  (0021 §5); reset by code comes later.
- The user menu shows the person's name and e-mail and ends with **Sign out**.

## Later

See 0021 "Later": company / profile choice at sign-in, MFA code step, reset and change password,
external sign-in, language list, license warnings, invited people's first password.
