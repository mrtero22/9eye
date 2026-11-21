# Public website

Asked by the user on 2026-10-27: a website to introduce 9eye, rank on Google and bring in customers;
AI agents first; pricing and a demo request; product pictures; no customer or other product names. Rules:
[decision 0022](../decisions/0022-public-website.md). Mockup source:
[mockups/site/](mockups/site/) (2026-10-27).

Code: `apps/site` (Astro, static). Everything the site says about the business (brand, e-mail,
WhatsApp, prices, navigation, footer) is in `apps/site/src/site.ts`.

## Pages

| Path | Title (`<title>`) | Sections |
|---|---|---|
| `/` | AI Broadcast Scheduling & TV Traffic Software \| 9eye | Hero (dark) with the **live agent desk** and three "Try a live event" buttons · Ten AI agents · The check-and-fix loop (flow + a sample run) · Validators (panel with working switches) · Skills (a skill + three ways an agent starts) · MCP (Claude, ChatGPT, Grok, your own) · AI you can trust on air · Platform overview (six steps, channel-type pills) · CTA · FAQ (9) |
| `/platform` | Broadcast Scheduling Software, Catalog to As-Run \| 9eye | Hero + Templates picture · Product tour (tabs: Orders, Series placement, Week templates) · Eight features · Channel types (each with an id, `#sol-fast` …) · CTA · FAQ (5) |
| `/pricing` | Pricing: Broadcast Scheduling Software \| 9eye | Two plans per channel / month, Monthly / Yearly switch · FAQ (3) |
| `/demo` | Request a Demo \| 9eye | What the demo covers · form (name, work e-mail, company, country, role, channels, channel types, current system, message, consent) |
| `/contact` | Contact \| 9eye | E-mail, WhatsApp, link to the demo · form (name, e-mail, company, topic, message, consent) |
| `/privacy` | Privacy Policy \| 9eye | Draft for legal review; bracketed parts filled before going live; `#cookies` |
| 404 | Page not found | noindex |

SEO pages (2026-10-29, user: "be an SEO expert, do what it takes to rank"), built from the same
classes and components, no new look:

| Path | Title (`<title>`) | Sections |
|---|---|---|
| `/ai-agents` | AI Agents for TV Scheduling, Ad Placement and Playout \| 9eye | Hero (chip "preview") · the ten agents, each with what it does, what it keeps and when it asks a person · how they work together (links to the home sections) · guardrails · CTA · FAQ (5) |
| `/tv-traffic-software` | TV Traffic Software for Ads, Promos and Breaks \| 9eye | Hero · six steps from booked spot to as-run · six traffic rules · programmes and breaks in one plan (Templates picture) · four traffic agents (preview) · guide links · CTA · FAQ (5; sales and billing "not yet", 0006) |
| `/fast-channel-scheduling` | FAST Channel Scheduling Software: Playlists and EPG \| 9eye | Hero · what a FAST channel needs · six steps (Order picture) · one core for FAST and linear · three agents (preview) · CTA · FAQ (5; ad insertion happens in the customer's stack) |
| `/guides` | Broadcast Scheduling and TV Traffic Guides \| 9eye | The guides as cards |
| `/guides/bxf-explained` | What Is BXF? Broadcast Exchange Format Explained \| 9eye | Long-form guide (layout `Guide.astro`: breadcrumbs, date, TechArticle + BreadcrumbList data, more guides, CTA) |
| `/guides/as-run-reconciliation` | As-Run Reconciliation: Checking What Aired \| 9eye | Long-form guide, with a causes / prevention table |
| `/guides/drop-frame-timecode` | Drop-Frame Timecode Explained: 29.97 and 59.94 fps \| 9eye | Long-form guide with conversion code (checked over a whole day at 29.97 and 59.94, both ways) |
| `/tools/timecode-calculator` | Timecode Calculator: Frames, Drop-Frame, 29.97 fps \| 9eye | Free tool (a link magnet, 2026-10-29): timecode ⇄ frames with real time, add / subtract, change frame rate keeping real time; 23.976–60 fps, drop-frame and non-drop. Runs on `@9eye/core` timecode (`scripts/timecode-model.ts` + `timecode-tool.ts`); first values rendered at build time; nothing leaves the page. WebApplication + FAQPage data |
| `/tools/scte35-decoder` | SCTE-35 Decoder: Parse Base64 and Hex Cues Online \| 9eye | Free tool (2026-11-04, user: free tools for broadcast departments instead of articles, see `docs/marketing/seo-plan.md`). Paste base64, hex or a whole HLS / DASH line; shows the splice_info_section, the command (all six), every CUEI descriptor, all UPID types (EIDR with check character), CRC_32 and length checks. Copy JSON (the standard's field names) and Copy link (`#cue=…`, never sent to the server). Model `scripts/scte35-model.ts` (pure, renders the same HTML at build time and in the browser) + `scte35-tool.ts`; checked against the eight example cues of the SCTE 35 standard and 200,000 random cues. Short "what it reads", SCTE-35 vs SCTE-104, FAQ (6); WebApplication + FAQPage data. Linked from the footer ("Guides and tools") and `/guides` |
| `/tools/tv-schedule-template` | TV Schedule Template: Free Excel Broadcast Playlist \| 9eye | Free template (2026-11-04). Download `public/downloads/tv-schedule-template.xlsx`: Start here · Day playlist (start times from durations in whole frames, non-drop TC, "Planned start" → "Off by", day total / left / end) · Ad minutes (per clock hour against a limit) · Week grid (half-hour slots, colours by title prefix) · Lists. Written by `scripts/tv-schedule-template.py` (Windows Python + openpyxl: `python scripts/tv-schedule-template.py` from `apps/site`) from `src/data/tv-schedule-sample.json`; the page shows the same sample through `scripts/schedule-model.ts`. Formulas use only functions Excel, Sheets and LibreOffice share; checked 2026-11-04 with a formula evaluator against an independent frame count (no Excel on the machine, so not yet opened in real Excel). Google Sheets: File → Import |
| `/tools/ad-break-calculator` | Ad Break Calculator: Commercial Minutes and Inventory \| 9eye | Free tool (2026-11-04). Three parts: ad inventory (ad minutes/hour × hours × days → ad time, spots, sold at sell-out, optional revenue per hour / day / week / month / year); programme length and breaks of one slot (slot − ads − promos, breaks and parts split in whole seconds, start of each, a bar); fill a break (spots of 10–60 s against the break length, fewest spots to fill the rest). Model `scripts/ad-break-model.ts` (pure, renders the same HTML at build time and in the browser) + `ad-break-tool.ts`. FAQ (5) incl. ad limits (EU 20% per window, US children's limits; "check your regulator") |
| `/tools/xmltv-epg-checker` | XMLTV Validator: Check EPG Gaps and Overlaps Online \| 9eye | Free tool (2026-11-05). Paste XMLTV or drop a .xml / .xml.gz file (gzip unpacked in the browser, encoding from the XML declaration). Own XML reader in `xmltv-model.ts` (no DOMParser): line numbers for every problem, keeps going after a bare "&" or an HTML entity, stops at broken tags or a cut-off file and keeps what came before. Checks: XML mistakes, channel ids (missing, twice, no display name, programmes for unknown ids with a "did you mean" for case), per programme (title, start, stop, XMLTV time form, offset, stop before start, over 12 h, xmltv_ns episode numbers), per channel timeline (gaps from N seconds, overlaps, duplicates), completeness (description, picture). Shows status badges, summary, a channel table with a coverage bar, problems with a channel filter; Copy report (text) and Download CSV. Example guide with seven typical mistakes is checked at build time. 33 MB / 67,000 programmes in about a second. Search terms: xmltv validator, epg checker. |
| `/studio` | Custom Software Automation, AI Agents and Validators \| 9eye Studio | Studio page (user, 2026-11-03: custom automation as fixed-price projects, worldwide; brand `STUDIO` in `site.ts`). Hero · six kinds of work · selected work (9eye itself + six client projects without client or vendor names, details changed) · three small tools · "any software" ticks · six project steps · project form (`#start`, Web3Forms, subject "Studio project") · FAQ (6). Linked from the header and the footer (Company) |
| `/studio/playlist-checker` | Playlist Checker for TV Channels: Case Study \| 9eye Studio | Case study (user, 2026-11-03), linked from the first Studio work card. Hero + `checker-report` picture · the problem (four mistakes) · five steps + `checker-capture` · the checks in four groups · auto timing + `checker-playlist` · six extras (tiles) · CTA to `/studio#start` · FAQ (5). Pictures are our own drawings (`src/shots/Checker*Shot.astro`, frame `CheckerFrame.astro`): fictional channel Northvale One, a look of their own, no client, vendor or channel names |

Guides are listed in `GUIDES` (`site.ts`): the guides page, the footer and the sitemap read them
from there. A new guide = an entry there + `src/pages/guides/<slug>.astro` using `Guide.astro`.
Guides stay factual and our own wording; product claims only as the other pages make them.

Header: mark + name, AI agents (`/ai-agents`) · Platform · Solutions · Pricing · Studio · Playlist
checker (`/studio/playlist-checker`, user 2026-11-03), "Request a demo"; a menu button below 980 px
(was 820 px; the six links need about 940 px). Footer: Product (AI agents, Platform, TV traffic,
Pricing, Request a demo) · Solutions (FAST and streaming → `/fast-channel-scheduling`) · Guides ·
Company (Studio, Broadcast playlist checker, Contact, Privacy policy, Cookies), © line. No sign-in link (the site has no login).

## Keywords

Home: AI broadcast scheduling, TV traffic software, AI ad placement, agentic AI for broadcasters.
Platform: broadcast scheduling software, traffic and scheduling system, playout scheduling.
`/tv-traffic-software`: TV traffic software, broadcast traffic system. `/fast-channel-scheduling`:
FAST channel scheduling software, FAST EPG. `/ai-agents`: AI agents for broadcast / TV scheduling,
AI ad placement. Guides: BXF, as-run reconciliation, drop-frame timecode. One page per topic, so
pages do not compete with each other. They come from the industry's own words, not from a keyword
tool: check them in Google Search Console after a few weeks.

Studio pages (2026-11-03, user: "rank for what clients search when they need this"), checked against
Google autocomplete and the result pages:

- `/studio`: workflow automation services, AI agent development (title and H1); in sections and
  FAQ: custom Chrome extension development, browser automation, MCP server development (and "what is
  an MCP server"), automate a web app without an API, data entry from Excel into a web form, Google
  Sheets automation, automation cost, automation for broadcasters. Each "… development services"
  term is a crowded agency results page: a page of its own per service is the way to rank for it.
- `/studio/playlist-checker`: broadcast playlist checker, playlist QC before playout, playlist
  validation, commercial spot verification, playlist auto timing, BXF. "Playlist checker" alone is
  Spotify / IPTV / M3U on Google, so the page always pairs it with broadcast or playout. Few pages
  compete (playout vendors' feature pages).
- Both pages carry `Service` structured data (`service()` in `seo.ts`) and FAQ questions in the
  words people search with. The footer (Company) links both.

## Search engines

- Open since 2026-10-29 (decision 0022 §3). Google Search Console: Domain property `9eye.org`
  (the user's Google account), sitemap submitted.
- Sitemap: every page with `lastmod` = the last commit of its source file, or the build day while
  the file has uncommitted changes.
- Structured data: Organization (logo `public/logo.png`, 512 × 512) on every page, WebSite on the
  home page, FAQPage where there is a FAQ, SoftwareApplication on home and pricing, TechArticle +
  BreadcrumbList on guides.
- `public/_headers`: noindex on `*.pages.dev`; `/_astro/*` cached for a year (hashed names).
- IndexNow (2026-11-04): key file `public/41a282cdfdabb4e41d3d8ee0476c214e.txt`; `scripts/indexnow.sh`
  sends every sitemap URL to api.indexnow.org (Bing, Yandex, Seznam, Naver) after each deploy that
  is open to search engines. `public/llms.txt` describes the site for AI assistants.
- SEO plan and 90-day roadmap: [../marketing/seo-plan.md](../marketing/seo-plan.md).
- Visitor numbers: Cloudflare Web Analytics, switched on 2026-11-04 on the Pages project (Metrics →
  Web Analytics). Cloudflare injects its beacon at deploy time, so it is not in the code; no cookies.
  The privacy page names it.
- Pictures: `Shot.astro` serves each picture at 1200 and 2400 px (`srcset`), so phones load the
  small one (PageSpeed mobile LCP on `/platform` was 3.0 s with the 2400 px only).

## Moving parts

- **Agent desk** (`src/scripts/desk-model.ts`, `desk.ts`): a 1200 × 720 picture of an "Agents" page,
  scaled to its frame. Three sample scenarios (Live-change, Timing, Ad placement): steps appear one
  per second, the run waits for approval, approves itself after three seconds, then the next one
  starts. Visitors can pick a scenario, Approve or Reject. The on-air clock runs in 25 fps
  timecode. It only runs while on screen; with reduced motion it shows a still, finished run.
  The first paint is rendered at build time (search engines and visitors without JavaScript see it).
- **Loop** (`loop-model.ts`, `loop.ts`): one sample run in three rounds; the flow cards it touches
  light up; one round ends with the operator notified.
- **Validators**: ten sample validators (one custom rule, one fixed by the operator); switches work.
- **Forms** (`forms.ts`): e-mailed to `studio@9eye.org` through Web3Forms (decision 0022);
  field names are the labels shown in the e-mail (Company, Country, Channel types …).

## Product pictures

Drawn in `src/shots/` (our design system, fictional company Tessaline Media, channel Tessa One) and
served only by the dev server at `/shots/<name>`. `npm -w @9eye/site run shots` (dev server
running) captures them into `public/images/*.webp` (2×, plus a `-1200` copy), `public/og.png`
(1200 × 630) and `public/logo.png` (the mark, 512 × 512). Never the Catalog page. Replace them with
screenshots of the running app once it shows the same screens.

## How to run

```
npm run dev:site                     # 127.0.0.1:4102 (Astro 7 needs Node 22+)
npm -w @9eye/site run shots          # pictures, with the dev server running
npm run build:site                   # apps/site/dist, noindex (no SITE_URL)
npm run deploy:site                  # build for https://9eye.org, open to search engines, upload to Cloudflare Pages
SITE_INDEX=0 npm run deploy:site     # the same, closed to search engines (removes the site from Google)
```

Live: https://9eye.org (Cloudflare Pages project `9eye`, free plan); `www.9eye.org` redirects to it
(Cloudflare Redirect Rule); https://9eye.pages.dev is noindex.
