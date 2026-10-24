import type { Catalog } from "../core/model";
// Fictional design fixtures. Never seed these into the real catalogue.
const venueId = "10000000-0000-4000-8000-000000000001";
const djId = "20000000-0000-4000-8000-000000000001";
const djTwoId = "20000000-0000-4000-8000-000000000002";
export const demoCatalog: Catalog = {
  mode: "demo",
  venues: [
    {
      id: venueId,
      slug: "signal-room",
      name: "Signal Room",
      city: "Berlin",
      country: "DE",
      address: "Fiktive Demo-Adresse",
      timezone: "Europe/Berlin",
      description:
        "Ein fiktiver kleiner Club für lange Nächte und tiefe Frequenzen. Nur zur Demonstration von EVRYVIBE.",
      translations: {
        en: {
          description:
            "A fictional intimate room for long nights and deep frequencies. Built only to demonstrate EVRYVIBE.",
        },
      },
      imageUrl: null,
      instagramUrl: null,
      websiteUrl: null,
      soundcloudUrl: null,
    },
  ],
  djs: [
    {
      id: djId,
      slug: "mira-phase",
      name: "Mira Phase",
      description:
        "Ein fiktiver Artist zwischen hypnotischem Techno und gebrochenen Rhythmen.",
      translations: {
        en: {
          description:
            "Fictional artist exploring hypnotic techno and broken rhythms.",
        },
      },
      genres: ["Techno", "Electro"],
      imageUrl: null,
      instagramUrl: null,
      websiteUrl: null,
      soundcloudUrl: null,
      samplePostUrl: null,
    },
    {
      id: djTwoId,
      slug: "arlo-static",
      name: "Arlo Static",
      description: "Ein fiktiver DJ zwischen Deep House und warmem UK Garage.",
      translations: {
        en: {
          description:
            "Fictional DJ connecting deep house to the warmer end of UK garage.",
        },
      },
      genres: ["House", "UK Garage"],
      imageUrl: null,
      instagramUrl: null,
      websiteUrl: null,
      soundcloudUrl: null,
      samplePostUrl: null,
    },
  ],
  events: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      slug: "after-hours-frequency",
      title: "After Hours Frequency",
      description:
        "Eine fiktive Nacht voller hypnotischer Grooves und gemeinsamer Momente. Dieser Eintrag ist eine Designvorschau, kein echtes Event.",
      translations: {
        en: {
          description:
            "A fictional night of hypnotic grooves, low ceilings, and shared moments. This listing is a design preview, not an actual event.",
        },
      },
      venueId,
      djIds: [djId, djTwoId],
      startsAt: "2026-09-25T23:00:00+02:00",
      endsAt: "2026-09-26T06:00:00+02:00",
      genres: ["Techno", "Electro"],
      imageUrl: null,
      ticketUrl: null,
      websiteUrl: null,
      sourceUrl: "https://www.instagram.com/p/FICTIONAL_DEMO/",
      observedAt: "2026-09-21T12:00:00Z",
      status: "scheduled",
    },
    {
      id: "30000000-0000-4000-8000-000000000002",
      slug: "soft-focus",
      title: "Soft Focus",
      description:
        "Eine fiktive House-Session vom Sonnenuntergang bis in die frühen Morgenstunden. Nur eine Demo.",
      translations: {
        en: {
          description:
            "A fictional house session from sunset into the early hours. Demo only.",
        },
      },
      venueId,
      djIds: [djTwoId],
      startsAt: "2026-09-26T21:00:00+02:00",
      endsAt: "2026-09-27T04:00:00+02:00",
      genres: ["House", "UK Garage"],
      imageUrl: null,
      ticketUrl: null,
      websiteUrl: null,
      sourceUrl: "https://www.instagram.com/p/FICTIONAL_DEMO2/",
      observedAt: "2026-09-21T12:00:00Z",
      status: "scheduled",
    },
  ],
};

const secondVenueId = "10000000-0000-4000-8000-000000000002";
const thirdVenueId = "10000000-0000-4000-8000-000000000003";
demoCatalog.venues.push(
  {
    ...demoCatalog.venues[0],
    id: secondVenueId,
    slug: "hafen-studio",
    name: "Hafen Studio",
    city: "Hamburg",
    country: "DE",
    address: "Fiktive Demo-Adresse",
    timezone: "Europe/Berlin",
    description: "Eine fiktive Tanzfläche am Wasser für die EVRYVIBE-Vorschau.",
    translations: {
      en: {
        description:
          "A fictional waterfront dancefloor for the EVRYVIBE preview.",
      },
    },
    imageUrl: null,
    instagramUrl: null,
    websiteUrl: null,
    soundcloudUrl: null,
  },
  {
    ...demoCatalog.venues[0],
    id: thirdVenueId,
    slug: "nachtgarten",
    name: "Nachtgarten",
    city: "Berlin",
    country: "DE",
    address: "Fiktive Demo-Adresse",
    timezone: "Europe/Berlin",
    description:
      "Ein erfundener Gartenclub mit warmen Platten bis spät in die Nacht. Nur ein Demo-Ort.",
    translations: {
      en: {
        description:
          "An imaginary garden room where warm records run late. Demo venue only.",
      },
    },
    imageUrl: null,
    instagramUrl: null,
    websiteUrl: null,
    soundcloudUrl: null,
  },
);
const moreNights = [
  {
    title: "Low Tide",
    slug: "low-tide",
    venueId: secondVenueId,
    genres: ["House", "Disco"],
    djIds: [djTwoId],
  },
  {
    title: "Open Circuit",
    slug: "open-circuit",
    venueId: thirdVenueId,
    genres: ["Electro", "Breakbeat"],
    djIds: [djId],
  },
  {
    title: "Velvet Hours",
    slug: "velvet-hours",
    venueId: thirdVenueId,
    genres: ["House"],
    djIds: [djTwoId, djId],
  },
  {
    title: "Pressure System",
    slug: "pressure-system",
    venueId: secondVenueId,
    genres: ["Techno"],
    djIds: [djId],
  },
];
for (const [index, night] of moreNights.entries()) {
  demoCatalog.events.push({
    ...night,
    id: `30000000-0000-4000-8000-00000000000${index + 3}`,
    description:
      "Ein fiktives Event zum Entdecken des EVRYVIBE-Designs. Dies ist kein echter Veranstaltungseintrag.",
    translations: {
      en: {
        description:
          "Fictional event for exploring the EVRYVIBE design. This is not a real listing.",
      },
    },
    startsAt: "2026-10-01T20:00:00Z",
    endsAt: null,
    imageUrl: null,
    ticketUrl: null,
    websiteUrl: null,
    sourceUrl: `https://www.instagram.com/p/FICTIONAL_DEMO${index + 3}/`,
    observedAt: "2026-09-21T12:00:00Z",
    status: "scheduled",
  });
}
// Wider fictional coverage: more cities, genre families, lineup sizes, a
// cancellation, an unknown lineup and an event without genres. Hamburg keeps
// exactly two events for the discovery browser test.
const leipzigVenueId = "10000000-0000-4000-8000-000000000004";
const munichVenueId = "10000000-0000-4000-8000-000000000005";
demoCatalog.venues.push(
  {
    ...demoCatalog.venues[0],
    id: leipzigVenueId,
    slug: "kellerwerk",
    name: "Kellerwerk",
    city: "Leipzig",
    country: "DE",
    address: "Fiktive Demo-Adresse",
    timezone: "Europe/Berlin",
    description:
      "Ein erfundener Kellerclub mit niedriger Decke und lautem System. Nur ein Demo-Ort.",
    translations: {
      en: {
        description:
          "An invented basement club with a low ceiling and a loud system. Demo venue only.",
      },
    },
    imageUrl: null,
    instagramUrl: null,
    websiteUrl: null,
    soundcloudUrl: null,
  },
  {
    ...demoCatalog.venues[0],
    id: munichVenueId,
    slug: "halle-sued",
    name: "Halle Süd",
    city: "München",
    country: "DE",
    address: "Fiktive Demo-Adresse",
    timezone: "Europe/Berlin",
    description:
      "Eine fiktive Industriehalle im Münchner Süden. Nur zur Demonstration.",
    translations: {
      en: {
        description:
          "A fictional industrial hall in the south of Munich. Demonstration only.",
      },
    },
    imageUrl: null,
    instagramUrl: null,
    websiteUrl: null,
    soundcloudUrl: null,
  },
);
const extraDjs = [
  ["vera-kaltwerk", "Vera Kaltwerk", ["Hard Techno", "Industrial Techno"]],
  ["ossi-delay", "Ossi Delay", ["Acid Techno", "Techno"]],
  ["lune-kobalt", "Lune Kobalt", ["Dub Techno", "Minimal Techno"]],
  ["teo-brandt", "Teo Brandt", ["Hard Techno", "Schranz"]],
  ["kiko-ferreira", "Kiko Ferreira", ["Trance", "Progressive Trance"]],
  ["noor-halim", "Noor Halim", ["Ambient", "Experimental"]],
  ["dex-marlow", "Dex Marlow", ["Drum & Bass", "Jungle"]],
  ["juna-west", "Juna West", ["EBM", "Electro"]],
] as const;
// Fictional SoundCloud profiles for a few extra DJs; the rest stay without one
// so the SoundCloud-first ranking is visible. Mira Phase and Arlo Static stay
// without, as browser tests assert no player on the first DJ page.
const demoSoundcloud = new Set([
  "vera-kaltwerk",
  "ossi-delay",
  "teo-brandt",
  "kiko-ferreira",
]);
for (const [index, [slug, name, genres]] of extraDjs.entries()) {
  demoCatalog.djs.push({
    id: `20000000-0000-4000-8000-${String(index + 3).padStart(12, "0")}`,
    slug,
    name,
    description: `${name} ist ein fiktiver Demo-Artist.`,
    translations: {
      en: { description: `${name} is a fictional demo artist.` },
    },
    genres: [...genres],
    imageUrl: null,
    instagramUrl: null,
    websiteUrl: null,
    soundcloudUrl: demoSoundcloud.has(slug)
      ? `https://soundcloud.com/evryvibe-demo-${slug}`
      : null,
    samplePostUrl: null,
  });
}
const djIdFor = (slug: string) => {
  const dj = demoCatalog.djs.find((entry) => entry.slug === slug);
  if (!dj) throw new Error(`Unknown demo DJ ${slug}`);
  return dj.id;
};
const widerNights: {
  title: string;
  slug: string;
  venueId: string;
  genres: string[];
  djSlugs: string[];
  status?: "cancelled";
}[] = [
  {
    title: "Kaltstart",
    slug: "kaltstart",
    venueId: leipzigVenueId,
    genres: ["Hard Techno", "Industrial Techno"],
    djSlugs: [
      "vera-kaltwerk",
      "teo-brandt",
      "juna-west",
      "mira-phase",
      "ossi-delay",
      "lune-kobalt",
    ],
  },
  {
    title: "303 Ritual",
    slug: "303-ritual",
    venueId: munichVenueId,
    genres: ["Acid Techno", "Techno"],
    djSlugs: ["ossi-delay", "mira-phase", "juna-west"],
  },
  {
    title: "Tiefdruck",
    slug: "tiefdruck",
    venueId: venueId,
    genres: ["Dub Techno", "Minimal Techno"],
    djSlugs: [],
  },
  {
    title:
      "Nachtschicht: Eine sehr lange Überschrift für eine fiktive Clubnacht mit Überlänge",
    slug: "nachtschicht-ueberlaenge",
    venueId: leipzigVenueId,
    genres: ["Trance", "Progressive Trance"],
    djSlugs: ["kiko-ferreira"],
    status: "cancelled",
  },
  {
    title: "Drift",
    slug: "drift",
    venueId: leipzigVenueId,
    genres: ["Ambient", "Experimental"],
    djSlugs: ["noor-halim"],
  },
  {
    title: "Bassline Theory",
    slug: "bassline-theory",
    venueId: munichVenueId,
    genres: ["Drum & Bass", "Jungle"],
    djSlugs: ["dex-marlow", "arlo-static", "kiko-ferreira", "noor-halim"],
  },
  {
    title: "Offene Türen",
    slug: "offene-tueren",
    venueId: thirdVenueId,
    genres: [],
    djSlugs: [],
  },
];
for (const [index, night] of widerNights.entries()) {
  const { djSlugs, status, ...rest } = night;
  demoCatalog.events.push({
    ...rest,
    id: `30000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
    djIds: djSlugs.map(djIdFor),
    description:
      "Ein fiktives Event zum Entdecken des EVRYVIBE-Designs. Dies ist kein echter Veranstaltungseintrag.",
    translations: {
      en: {
        description:
          "Fictional event for exploring the EVRYVIBE design. This is not a real listing.",
      },
    },
    startsAt: "2026-10-01T20:00:00Z",
    endsAt: null,
    imageUrl: null,
    ticketUrl: null,
    websiteUrl: null,
    sourceUrl: `https://www.instagram.com/p/FICTIONAL_DEMO_${night.slug.replace(/-/g, "_").toUpperCase()}/`,
    observedAt: "2026-09-21T12:00:00Z",
    status: status ?? "scheduled",
  });
}
const openEnded = new Set(["drift", "offene-tueren"]);
// Keep the opt-in preview useful whenever it is opened. No generated dates enter live data.
const today = new Date();
today.setUTCHours(20, 0, 0, 0);
for (const [index, event] of demoCatalog.events.entries()) {
  // Two nights share some dates so date-grouped listings have real groups.
  // Odd entries start an hour earlier: one venue never has two events at the
  // same start, matching the catalogue's unique venue/start rule.
  event.startsAt = new Date(
    today.getTime() +
      (Math.floor(index * 0.7) + 1) * 86_400_000 -
      (index % 2) * 3_600_000,
  ).toISOString();
  event.endsAt = openEnded.has(event.slug)
    ? null
    : new Date(Date.parse(event.startsAt) + 7 * 3_600_000).toISOString();
  event.observedAt = today.toISOString();
}
// Past fictional nights, added after the date shift so they stay in the past.
// They give DJs gigs in cities they do not otherwise play; Noor Halim's only
// Hamburg night is a past one.
const pastNights: {
  title: string;
  slug: string;
  venueId: string;
  genres: string[];
  djSlugs: string[];
  daysAgo: number;
}[] = [
  {
    title: "Rückspiegel Hart",
    slug: "rueckspiegel-hart",
    venueId: secondVenueId,
    genres: ["Hard Techno", "Schranz"],
    djSlugs: ["vera-kaltwerk", "teo-brandt"],
    daysAgo: 6,
  },
  {
    title: "Altbau Deep",
    slug: "altbau-deep",
    venueId: munichVenueId,
    genres: ["Deep House", "House"],
    djSlugs: ["lune-kobalt", "arlo-static"],
    daysAgo: 14,
  },
  {
    title: "Sonnenaufgang Trance",
    slug: "sonnenaufgang-trance",
    venueId: thirdVenueId,
    genres: ["Trance", "Progressive Trance"],
    djSlugs: ["kiko-ferreira"],
    daysAgo: 30,
  },
  {
    title: "Stille Fläche",
    slug: "stille-flaeche",
    venueId: secondVenueId,
    genres: ["Ambient", "Experimental"],
    djSlugs: ["noor-halim"],
    daysAgo: 45,
  },
];
for (const [index, night] of pastNights.entries()) {
  const { djSlugs, daysAgo, ...rest } = night;
  const startsAt = new Date(today.getTime() - daysAgo * 86_400_000);
  demoCatalog.events.push({
    ...rest,
    id: `30000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`,
    djIds: djSlugs.map(djIdFor),
    description:
      "Ein fiktives Event zum Entdecken des EVRYVIBE-Designs. Dies ist kein echter Veranstaltungseintrag.",
    translations: {
      en: {
        description:
          "Fictional event for exploring the EVRYVIBE design. This is not a real listing.",
      },
    },
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 7 * 3_600_000).toISOString(),
    imageUrl: null,
    ticketUrl: null,
    websiteUrl: null,
    sourceUrl: `https://www.instagram.com/p/FICTIONAL_DEMO_${night.slug.replace(/-/g, "_").toUpperCase()}/`,
    observedAt: today.toISOString(),
    status: "scheduled",
  });
}
