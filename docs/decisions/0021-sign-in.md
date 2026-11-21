# 0021 — Sign-in: one login per person, a session cookie, every page behind it

Status: **Accepted** 2026-10-27 (user, in the session)

## Context

The user wants to put 9eye on a domain for development (not commercial use yet). Nobody may get in
without signing in; one account to start with (`admin19216811@admin.com`, a platform admin). The
look of the sign-in page matters to the user. 0007 already fixed the shape: one login for every
company, memberships with a role, MFA later.

## Decision

1. **E-mail and password.** The password is hashed with scrypt (Node's own `crypto`, no package):
   `scrypt$N$r$p$salt$hash` in `app_user.password_hash`. A person without a hash cannot sign in.
   E-mail is matched without case and spaces.
2. **Sessions in the database.** Signing in creates a random 32-byte token, sent as the cookie
   `nineeye_session` (HttpOnly, SameSite=Lax, Path=/, Secure when the request came over https
   through the proxy, 7 days). Only the token's SHA-256 is stored (`session` table). Sign out
   deletes the row; setting a password deletes all of the person's sessions.
3. **Every API route except `/api/health` and `/api/auth/*` needs a session** (401 "Sign in to
   continue."). The company of a request (`X-Tenant`) must be one the person can open: platform
   admins open every company, others only those where their membership is active (403 otherwise).
   The company list in the top bar shows only those companies.
4. **Too many tries.** Five wrong passwords in a row lock the account's sign-in for 15 minutes (the
   right password is refused too); 30 wrong passwords from one address in 15 minutes stop that
   address. The API trusts proxy headers only from this machine (`trust proxy: loopback`).
5. **Passwords are set in the terminal**, never on a page or the command line yet:
   `npm -w @9eye/api run user:password -- <email>` asks twice (at least 12 characters), stores the
   hash, unlocks the sign-in and signs the person out everywhere.
6. **Platform admins are the company admins of every company** (replaces the fixed "Local user"):
   the built-in admin membership goes to each platform admin; a database without any platform admin
   gets the "Local user" as before.
7. **The page** (docs/design/sign-in-page.md): the calm look, built only from shared components; the
   product name and mark in one place (`ui/brand.tsx`), as "9eye" is a codename.

## Later (built when the user asks)

Choosing a company and a profile during sign-in (9eye: one role per membership, the company is
switched in the top bar), MFA codes (0007), reset / change password with a code, external sign-in
(SSO), the language list, license warnings ("expires in N days"). Invited people set their first
password then too.
