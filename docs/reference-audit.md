# Reference audit

This is a read-only source audit for the EVRYVIBE restart. It is not a visual
review of a running MusiKonnect deployment, nor a claim that its features work.

## Guidance imported from Leasy

Read Leasy's `.agent/rules/leasy.md`, its companion `biolab.md`, and the
`lop.md` / `gauntlet.md` workflows in that repository (Leasy is a sibling of
the parent `musikite` repository). The project uses strict types, parsing at
boundaries, canonical domain ownership, bounded agent assignments, and an
independent critic inspecting actual artifacts. Those ideas are retained in
EVRYVIBE's `.agent` guidance.

The source files also contain old leasing, palette, Flutter/Serverpod, and game
examples. They are removed, along with inherited hyperbole, automatic PM/user
escalation for ordinary schema changes, indefinite quality loops, and heavyweight
progress machinery. The parent `.agent/rules/AGENTS.md` was read for context;
its unrelated equipment-domain example and strict escalation template are not
the operating model of this explicitly authorized restart.

## MusiKonnect inspiration

Sources inspected include `../musikconnect/design-vision.md`, the home/events/
venues specs, `src/components/events/event-card.tsx`, and
`src/components/venues/profile/venue-profile-hero.tsx` inside the legacy app.

| Keep as inspiration                                                   | EVRYVIBE interpretation                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Strong grids, high contrast, condensed headlines, restrained metadata | An editorial nightlife directory that is easy to scan                          |
| Event poster imagery                                                  | Source-backed artwork leads discovery and event pages                          |
| Date, venue, and lineup on event cards                                | Make the decision facts legible before opening a page                          |
| Venue identity and cover imagery                                      | A simple venue page links its upcoming events, location, and official profiles |
| Sharing and ticket destinations                                       | A native share/copy link and direct external ticket links                      |

The legacy event card imports authentication, RSVP hooks, friend previews, group
sharing, and an audio-player context. The venue hero combines identity with
follows, analytics, upload controls, and permissions. These are evidence of
coupling to the previous product; neither component is copied.

Exclude fake system IDs, invented status/freshness, lore-heavy terminology,
strobing/glitch decoration, giant personalized strip dashboards, groups,
collectives, messaging, marketplace, self-hosted music/audio, ticket checkout,
and tenant configuration. A discovery visitor needs to understand a night out,
not learn the language of a fictional operations terminal.

## Clean implementation direction

One Next.js project, `src/core` contracts, `src/db` persistence, `src/mcp` tools,
and a small public UI. Venues, events, DJs, and lineups form the initial graph.
Instagram source packages retain caption, labeled OCR and source context for agents;
published records retain provenance and external profiles. Supported Instagram
embeds provide samples with source-link fallbacks. Date/city discovery and
complete event details are more valuable initially than recommendation machinery.

The MCP/queue reference audit and chosen protocol belong in the ingestion spec;
this file does not imply those reference implementations were reviewed here.
