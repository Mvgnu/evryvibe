# German and English discovery

German is the default at `/`; English is under `/en` with equivalent event,
venue and DJ URLs. Language changes preserve the page and active filters. Route
locale controls document language, labels, date formatting, metadata, alternate
links, sitemap URLs and structured descriptions. Incoming locale headers are
replaced from the URL; language aliases never bypass operator authentication.

Canonical venue/DJ names, slugs, source URLs, dates and relationships are shared.
Base titles/descriptions are German. MCP accepts optional `translations.en` with
`description` for venues/DJs and `title`/`description` for events. Omission retains
existing translations during updates; `{}` explicitly clears them. Missing
translations fall back to the supplied base text; the app never fabricates a
translation. Add English text through the same publication tools, not duplicate
entities. Source post account identity is stored from the package during event
publication for accurate source attribution.

Public pages emit linked WebSite, WebPage (or CollectionPage, ProfilePage,
ContactPage), BreadcrumbList, Organization, MusicEvent, MusicVenue/LocalBusiness,
Person and City data with localized page URLs and names. The event location contains the supplied
postal address, performers resolve to the DJs, and author attribution only uses
an exact source-account match. Unknown price, coordinates, contact or authorship
stay absent. JSON-LD content is escaped against script termination.

Dark is the default theme; light is an explicit visitor choice stored locally and
retained across pages. Both themes and languages support narrow mobile and
desktop layouts, visible focus and readable control states.
Fixtures remain visibly fictional and noindex; production starts with an empty
catalog until inventory is supplied through MCP.
