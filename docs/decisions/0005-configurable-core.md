# 0005 — Fixed core, everything else configurable or pluggable

**Status:** Accepted, 2026-10-15 (user: "anyone, with any concept, for their channel").

## Decision

A new customer or channel type must never need a code change in the core.

| Layer | Contents |
|---|---|
| **Core (fixed)** | Frame-accurate time, events, blocks and breaks, media / catalog, orders, playlists, as-run, change history |
| **Channel profile** | Broadcast-day start, week start, fps, time zone, feeds / subchannels, content types, container templates, which playlist-build steps run, grid granularity (1 h / 30 min / free), ident patterns, catalog lists, live-event handling |
| **Rules engine** | Placement rules (positions, brand separation, limits per hour), music rotation, country regulations (ad minutes per hour, product restrictions by time of day, kids' rules) |
| **Plugins** | Export per playout (BXF, Playout XML, Grass Valley, Imagine, Evertz, Harmonic, Playbox, Cinegy, Amagi, …), ingest per MAM, EPG outputs (XMLTV, DVB-EIT), SCTE-35 markers for FAST / SSAI, ratings, billing |
| **Modules per tenant** | Switched on or off per customer: e.g. rights management, live / news, FAST, ads sales, ratings |

## Why

Traffic systems cover many concepts with modules and per-tenant feature toggles; one company
alone already shows large differences between channels (music vs series vs sport). A worldwide
product multiplies that. Channel types to design against:
series, film, music, news, sport / live, kids, FAST / OTT, public (no ads), multi-feed / time-shifted.
