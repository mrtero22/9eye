# 0022 — The public website: a static site in apps/site, AI-first, closed to search engines until the brand and domain are final

Status: **Accepted** 2026-10-27 (user, in the session)

## Context

The user wants a website that introduces 9eye, its features and pricing, takes demo requests, and
ranks on Google to bring in customers. Agentic AI must be prominent ("people pay attention to AI
these days"), with product pictures. Nothing on it may point to a real customer or another product (0015).
The product is not finished: the AI agents, MCP, skills and
the validator loop do not exist yet.

## Decision

1. **A separate workspace `apps/site`**, built with Astro as plain static files (no server). Plain
   HTML and one stylesheet with the 9eye tokens (`apps/web/src/ui/tokens.css` values), a few small
   scripts, fonts self-hosted (no font CDN). Dev server on `127.0.0.1:4102`.
   - **Astro 7 needs Node 22+.** The host Node is 20 and the API and app stay on it;
     `apps/site/scripts/astro.sh` runs Astro on `/opt/node24`. The built site needs no Node.
     (Astro 5, which runs on Node 20, has published security advisories fixed only from 7.3.1.)
   - The site was installed with npm 11 (`PATH=/opt/node24/bin:$PATH npm install …`): npm 10 stops
     on the peer set of Vite 8 next to the app's Vitest ("Cannot read properties of null
     (reading 'edgesOut')"). No version of an existing package changed in the lockfile.
2. **Pages** (copy from the approved mockup, see `docs/design/site.md`): Home — AI-first: the live
   agent desk, ten agents, the check-and-fix loop, validators, skills, MCP, guardrails, a platform
   overview, FAQ · Platform · Pricing · Request a demo · Contact · Privacy policy (draft) · 404.
   **SEO pages (user, 2026-10-29):** AI agents · TV traffic software · FAST channel scheduling ·
   Guides (BXF, as-run reconciliation, drop-frame timecode) — one page per search topic, same look,
   no competitor names, AI parts labelled preview, sales and billing described as "not yet" (0006).
3. **Search engines.** Every page has its own title, description, Open Graph / Twitter card,
   canonical URL and JSON-LD (Organization; SoftwareApplication with the two offers; FAQPage).
   **Until `SITE_URL` is set every page is `noindex`, `robots.txt` disallows everything and the
   sitemap is empty**, so nothing is indexed under the codename or a temporary address. Set
   `SITE_URL` when the final name and domain exist (SEO builds on both).
   **Opened 2026-10-29 (user: "publish it on Google to bring in customers"), on 9eye.org under the
   codename**: `deploy.sh` builds with `SITE_INDEX=1` by default (`SITE_INDEX=0` closes it again).
   `public/_headers` sends `X-Robots-Tag: noindex` on `9eye.pages.dev` and preview deployments;
   `www.9eye.org` → `9eye.org` is a Cloudflare Redirect Rule on the zone (dashboard; the deploy token
   only reaches Pages). **"9eye" is the final brand** (user, 2026-10-29), so 9eye.org stays the
   address that profiles, press and backlinks point to.
4. **Pricing** (user): two plans, **per channel per month** — *Platform* $999 (the whole system),
   *Platform + AI agents* $2,390. Yearly billing = two months free ($833 / $1,992 a month). No
   enterprise plan. Prices live in `apps/site/src/site.ts` only.
5. **Contact** (user): e-mail `studio@9eye.org`, WhatsApp `+1 971 480 9697`. No postal address
   (no company yet); the privacy policy names "9eye" until a company is registered, then "9eye is a
   brand of …".
6. **A new product, not a copy (0015):** no customer or competitor names, our own wording and
   glossary terms. Product pictures are drawn from our own design system with a **fictional
   company** (Tessaline Media, channel Tessa One, invented titles) and captured by
   `scripts/shots.mjs`; the Catalog page is not shown.
   Claude, ChatGPT and Grok appear as plain text only (no logos), as MCP clients.
7. **Honest about what exists:** the AI parts are labelled *Preview* / *early access* on the page.
8. **Forms** (user, 2026-10-28): sent to **Web3Forms** (free plan), which e-mails each demo request
   ("Demo request – 9eye") and contact message ("Contact – 9eye") to `studio@9eye.org`. No server
   of ours; the access key in `site.ts` is public by design. The hidden `botcheck` field is their
   honeypot. If sending fails the form shows the e-mail and WhatsApp. The privacy policy names
   Cloudflare, Web3Forms and Gmail. Storing requests in the 9eye database (and a list in Admin)
   waits until the 9eye API is reachable from the internet.

9. **Hosting (user, 2026-10-28): Cloudflare Pages, free plan**, not this server (no budget, and it
   keeps the site apart from the development server). Project `9eye` → `9eye.pages.dev`; the
   domain **9eye.org** (bought at Namecheap) is attached to the project and goes live once its DNS is
   on Cloudflare. `npm run deploy:site` builds for `https://9eye.org` and uploads with Wrangler
   (`CLOUDFLARE_API_TOKEN` with "Cloudflare Pages: Edit" and `CLOUDFLARE_ACCOUNT_ID` in `.env`).
   The project was created through the API as a classic Pages project: Wrangler 4.152's
   `pages project create` hands over to the newer Workers-based Pages and stops in a workspace.
   `npm run deploy:site` builds it open to search engines since 2026-10-29 (§3).

## Later

Demo requests in the 9eye database with a list in Admin (once the API is public), real screenshots
from the running app,
analytics (and the privacy policy's cookie text), a lawyer's review of the
privacy policy, pages per channel type, more guides.
