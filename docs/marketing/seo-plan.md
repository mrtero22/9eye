# SEO plan for 9eye.org

Written 2026-11-04 (user: "be a professional SEO strategist, plan it and carry it out; tell me
where you can't"). Builds on [backlinks.md](backlinks.md) and the Keywords section of
[../design/site.md](../design/site.md). Owner of each task: **C** = Claude does it, **U** = the
user does it (accounts, passwords, payments, dashboard clicks Claude is not allowed to make).

## Where we start (audit, 2026-11-04)

- **Technical basics are right.** robots.txt allows everything and points to the sitemap; 16 URLs
  in the sitemap, all 200, each with one H1, a self canonical and `index, follow`; www → apex 301;
  `*.pages.dev` is noindex; structured data on every page (Organization, FAQPage, SoftwareApplication,
  TechArticle, Service, BreadcrumbList). PageSpeed mobile was 98–99 on 2026-10-29 (API quota was
  used up today, re-check later).
- **Search Console:** sitemap read 2026-11-03, 16 pages discovered; the indexing report is still
  "processing". Last 28 days: 8 impressions, 1 click, average position 3 (brand searches).
- **Crawlers:** Googlebot, Bingbot, ClaudeBot, Applebot, ChatGPT-User, PerplexityBot and others are
  allowed and crawling (Cloudflare AI Crawl Control, last 7 days: 543 requests). The 363 "404" hits
  are vulnerability scanners asking for `.env`, `.git` and `secrets.json`; the static site has none.
- **Gaps:** no backlinks yet (one old spam link from the domain's previous owner); a young domain;
  only 3 guides and 1 tool; several meta descriptions over 160 characters; no Bing / IndexNow;
  no llms.txt; the Organization data does not point to the LinkedIn page.

**Realistic expectation:** a new domain in a niche B2B market takes 3–6 months to rank for
non-brand terms. The niche helps: few pages compete for "TV traffic", "BXF" or "playlist QC".

## Goals and how we measure them (check monthly in Search Console)

| By | Indexed pages | Impressions / month | Non-brand queries with clicks | Referring domains | Leads from the site |
|---|---|---|---|---|---|
| end of Dec 2026 | 30+ | 1,000 | 10 | 5 | first demo or studio form |
| end of Feb 2027 | 45+ | 5,000 | 50 | 15 | 2–4 a month |
| end of Apr 2027 | 60+ | 15,000 | 150 | 30 | 5+ a month |

## The six pillars

### 1. Technical and measurement
- C: trim meta descriptions to ≤160 characters; keep one topic per page (no cannibalisation).
- C: IndexNow (key file on the site, ping on every deploy) so Bing, Yandex, Seznam and Naver pick up
  changes at once. Bing also feeds ChatGPT search and Copilot.
- C: `llms.txt` describing the site for AI assistants; Organization / Service data with `sameAs`
  links to official profiles.
- U: Bing Webmaster Tools — sign in, "Import from Google Search Console" (2 minutes).
- U: Cloudflare Web Analytics (free, no cookies) and Crawler Hints — two switches in the dashboard.
  Web Analytics was switched on 2026-11-04 on the Pages project `9eye` (Metrics → Web Analytics):
  Cloudflare adds its beacon to every page from the next deploy on; the privacy page says so.
  Crawler Hints means accepting Cloudflare's Supplemental Terms, so the user switches it on.
- C: monthly report from Search Console (queries, pages, CTR) and fixes from it.

### 2. Articles: stopped (user, 2026-11-04)
"People ask an AI for explanations now; articles will not bring them." No new guides. The three
existing guides (BXF, as-run reconciliation, drop-frame timecode) stay online. What a searcher
needs to understand is written on the tool page itself: a short "what it is" section and a FAQ in
the searcher's words, so the tool page answers the question and does the job.

### 3. Free tools for broadcast departments: the main channel (user, 2026-11-04)
Useful tools that people come back to, bookmark and share in their teams. They bring attention,
links and the first contacts; the people who use them see the product and the studio. Rules:
- Runs in the browser; files and data never leave the page (no server cost, no privacy question).
- Does one job well, works on real files, shows results a person can copy into a ticket.
- Each tool page: the tool first, then a short explanation, a FAQ, links to the product or studio.
- A quiet line under each result: "Need this in your workflow? 9eye Studio builds it" → /studio#start.

| Order | Tool | Who needs it | Searches |
|---|---|---|---|
| done | Timecode calculator | everyone in playout and post | timecode calculator, drop frame calculator |
| done 11-04 | **SCTE-35 decoder** (base64 / hex → splice command, times, descriptors, UPIDs, CRC check) | ad ops, MCR and streaming engineers | scte 35 decoder, scte35 parser |
| done 11-04 | **TV schedule template** (Excel; Google Sheets via File → Import) | schedulers of small and new channels | tv schedule template, broadcast schedule excel |
| done 11-04 | **Ad break calculator** (ad minutes per hour, breaks, spots per break, sell-out) | traffic and sales | commercial minutes per hour, ad break calculator |
| done 11-05 | **XMLTV EPG checker** (gaps, overlaps, missing titles per channel) | FAST and IPTV channel teams | xmltv validator, epg checker |
| 5 | **Subtitle timing tool** (SRT shift and frame-rate change, 23.976 ↔ 25) | localisation and subtitling | srt frame rate converter, shift subtitles |
| 6 | **Playlist gap checker** (CSV / Excel playlist → gaps, overlaps, wrong durations) | playout and scheduling; leads to the Playlist Checker case study | playlist checker broadcast |
| 7 | **Loudness meter** (EBU R128 / ATSC A/85 on a local file) | MCR, post, promo teams | lufs meter online, ebu r128 meter |

### 4. Commercial pages
- Product: one page per channel type, after 4–6 weeks of Search Console data (sport, news, kids,
  public media) — already agreed (site.md).
- Studio: one page per service, because each search result page is full of agencies with a page
  each: Chrome extension development, MCP server development, AI agent development, browser
  automation. Each with its own case study.

### 5. Links and mentions (off-page)
- Follow [backlinks.md](backlinks.md) phase A: Crunchbase, SaaSHub, AlternativeTo (U creates the
  accounts, C fills the forms and writes the texts).
- Studio: agency directories with free profiles — Clutch, GoodFirms, DesignRush (U accounts, C texts).
- Trade press: one news item per real milestone (new tool, first customer) to Broadcast Pro ME,
  Advanced Television, TVTechnology's The Wire, Señal News (C writes, U sends).
- Communities: answer real questions where the tools help (Reddit r/VIDEOENGINEERING and
  r/broadcasting, Stack Exchange video production, LinkedIn groups) — U posts, C drafts; always say
  you work on 9eye, never spam.
- Open source: publish the timecode and SCTE-35 code as small GitHub packages that link back.
- Never: bought links, link packages, private blog networks, automated submissions.

### 6. Search in AI answers (ChatGPT, Perplexity, Gemini, Google AI Overviews)
- Clear, factual pages with definitions, tables and FAQs (already the house style).
- The same name, description and links everywhere (backlinks.md "Details").
- Bing indexing (ChatGPT search uses it) and IndexNow.
- `llms.txt` and allowed AI search crawlers (already allowed).

## 90-day roadmap

| Week | Claude | You |
|---|---|---|
| 1 (now) | Quick wins: meta descriptions, llms.txt, IndexNow, `sameAs`; this plan | Bing Webmaster Tools import; Cloudflare Web Analytics + Crawler Hints |
| 2 | Tool: SCTE-35 decoder | Crunchbase account |
| 3 | Tool: TV schedule template; a "Free tools" page linking all tools | SaaSHub, AlternativeTo accounts (Claude fills) |
| 4 | Tool: ad break calculator | Share the decoder and template in 2 communities (Claude drafts) |
| 5 | Tool: XMLTV EPG checker | Clutch / GoodFirms accounts (Claude fills) |
| 6 | First Search Console review → fixes · Tool: subtitle timing tool | — |
| 7–8 | Tool: playlist gap checker · Studio pages: Chrome extension, MCP server development | Press item for the tools |
| 9–10 | Tool: loudness meter | Share the new tools |
| 11–12 | Second review; update titles/descriptions by CTR; next tools from real queries | — |

Changed 2026-11-04 (user): tools instead of articles; the guide rows were removed.

## Rules

- One page per search intent; never two pages for the same query.
- Our own wording; no competitor names on the site (decision 0022); no "X alternative" pages.
- Every new page: title ≤60 characters with the main term first, description ≤160, one H1, FAQ in
  the searcher's words, structured data, links from at least two existing pages, sitemap entry,
  IndexNow ping.
- Deploy only with the user's OK (CLAUDE.md); the user OK'd the quick wins of week 1 on 2026-11-04.
