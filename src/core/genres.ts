// The genre taxonomy: the single source of truth for what a genre is called,
// which family it belongs to and which poster motif draws it. Agents write
// genres as free text; every write path and every public surface goes through
// `canonicalGenre` so "Peak-Time Techno" and "Driving Techno" are one genre.
//
// Level 1 are families (filter chips, ordered), level 2 canonical genres.
// Generic non-genres ("Electronic", "Rave", "Groove") are deliberately absent:
// they are dropped on write rather than stored.
import type { SoundFamily } from "./sound";

export type GenreFamilySlug =
  | "techno"
  | "hard-techno"
  | "hard-dance"
  | "house"
  | "disco"
  | "trance"
  | "bass"
  | "electro-wave"
  | "ambient"
  | "global";

type GenreDefinition = {
  name: string;
  // Poster motif when it differs from the family default.
  motif?: SoundFamily;
  aliases?: readonly string[];
};
type FamilyDefinition = {
  slug: GenreFamilySlug;
  en: string;
  de: string;
  // Poster motif of the family chip and the default for its genres.
  motif: SoundFamily;
  genres: readonly GenreDefinition[];
};

const definitions: readonly FamilyDefinition[] = [
  {
    slug: "techno",
    en: "Techno",
    de: "Techno",
    motif: "techno",
    genres: [
      { name: "Techno" },
      {
        name: "Peak Time Techno",
        aliases: [
          "Driving Techno",
          "Driving",
          "Peak Time",
          "Peaktime",
          "Peak Time Driving Techno",
        ],
      },
      { name: "Hypnotic Techno", aliases: ["Hypnotic"] },
      { name: "Deep Techno", motif: "dub" },
      { name: "Dub Techno", motif: "dub", aliases: ["Dub"] },
      { name: "Minimal Techno", motif: "dub", aliases: ["Minimal"] },
      { name: "Melodic Techno" },
      { name: "Groove Techno" },
      { name: "Hardgroove", motif: "hard", aliases: ["Hard Groove"] },
      { name: "Raw Techno" },
      {
        name: "Industrial Techno",
        motif: "hard",
        aliases: ["Industrial"],
      },
      { name: "Acid Techno", motif: "acid", aliases: ["Acid"] },
      { name: "Detroit Techno" },
      { name: "Tribal Techno" },
      { name: "Progressive Techno" },
      { name: "Experimental Techno" },
      {
        name: "Psytechno",
        motif: "trance",
        aliases: [
          "Psy Techno",
          "Psy Tech",
          "Psytech",
          "Psychedelic Tech",
          "Psychedelic Techno",
          "Psych Techno",
        ],
      },
    ],
  },
  {
    slug: "hard-techno",
    en: "Hard Techno",
    de: "Hard Techno",
    motif: "hard",
    genres: [
      { name: "Hard Techno", aliases: ["Hardtechno"] },
      { name: "Schranz" },
      { name: "Tekk", aliases: ["Hard Tekk"] },
      { name: "Tekno", aliases: ["Free Tekno", "Freetekno"] },
      { name: "Hardtek", aliases: ["Hard Tek", "Hard Tekno"] },
      { name: "Tribe", aliases: ["Tribecore"] },
      {
        name: "Hard Bounce",
        aliases: ["Bounce", "Hardbounce", "Bouncy Techno", "Bounce Techno"],
      },
    ],
  },
  {
    slug: "hard-dance",
    en: "Hard Dance",
    de: "Hard Dance",
    motif: "hard",
    genres: [
      { name: "Hard Dance" },
      { name: "Hardstyle", aliases: ["Reverse Bass"] },
      { name: "Rawstyle", aliases: ["Raw Hardstyle"] },
      { name: "Industrial Hardstyle" },
      { name: "Hardcore", aliases: ["Hard Core"] },
      { name: "Gabber", aliases: ["Gabba"] },
      { name: "Uptempo", aliases: ["Uptempo Hardcore"] },
      { name: "Frenchcore" },
      { name: "Happy Hardcore" },
      { name: "Speedcore" },
    ],
  },
  {
    slug: "house",
    en: "House",
    de: "House",
    motif: "house",
    genres: [
      { name: "House" },
      { name: "Deep House" },
      { name: "Tech House" },
      { name: "Progressive House" },
      {
        name: "Melodic House",
        aliases: ["Melodic House and Techno", "Melodic House & Techno"],
      },
      { name: "Afro House" },
      { name: "Afro Tech", aliases: ["Afro Techno"] },
      {
        name: "Minimal House",
        aliases: ["Microhouse", "Micro House", "Minimal Deep Tech"],
      },
      { name: "Chicago House" },
      { name: "Acid House", motif: "acid" },
      { name: "Electro House", motif: "electro" },
      { name: "Bass House" },
      { name: "Disco House" },
      { name: "Speed House", aliases: ["Speedhouse"] },
      { name: "Deep Tech", aliases: ["Deep Tech House"] },
      { name: "Hard House", motif: "hard" },
    ],
  },
  {
    slug: "disco",
    en: "Disco & Funk",
    de: "Disco & Funk",
    motif: "house",
    genres: [
      { name: "Disco" },
      { name: "Nu Disco", aliases: ["Nudisco"] },
      { name: "Italo Disco", aliases: ["Italo"] },
      { name: "Dark Disco" },
      { name: "Boogie" },
      { name: "Funk & Soul", aliases: ["Funk", "Soul", "Funk/Soul"] },
      { name: "Hi-NRG", aliases: ["Hi NRG"] },
      { name: "Balearic" },
    ],
  },
  {
    slug: "trance",
    en: "Trance",
    de: "Trance",
    motif: "trance",
    genres: [
      { name: "Trance" },
      { name: "Uplifting Trance" },
      { name: "Progressive Trance" },
      { name: "Hard Trance" },
      { name: "Acid Trance", motif: "acid" },
      { name: "Goa Trance", aliases: ["Goa"] },
      {
        name: "Psytrance",
        aliases: ["Psy Trance", "Psy", "Psychedelic Trance"],
      },
      { name: "Progressive Psytrance", aliases: ["Prog Psy"] },
      { name: "Full-On", aliases: ["Full On"] },
      { name: "Darkprog", aliases: ["Dark Prog", "Dark Progressive"] },
      { name: "Forest Psytrance", aliases: ["Forest"] },
    ],
  },
  {
    slug: "bass",
    en: "Bass",
    de: "Bass",
    motif: "breaks",
    genres: [
      { name: "Bass Music", aliases: ["Bass"] },
      {
        name: "Drum & Bass",
        aliases: ["DnB", "D&B", "Drum and Bass", "Drum n Bass", "Drum'n'Bass"],
      },
      {
        name: "Liquid Drum & Bass",
        aliases: ["Liquid DnB", "Liquid D&B", "Liquid"],
      },
      { name: "Neurofunk", aliases: ["Neuro"] },
      { name: "Jungle" },
      { name: "Dubstep" },
      { name: "Deathstep" },
      { name: "Riddim" },
      { name: "UK Garage", aliases: ["UKG", "Garage"] },
      { name: "UK Bass", aliases: ["UK Club"] },
      { name: "Grime" },
      { name: "Breakbeat", aliases: ["Breaks", "Breakbeats"] },
      { name: "Big Beat" },
      { name: "Footwork", aliases: ["Juke"] },
      { name: "Breakcore" },
    ],
  },
  {
    slug: "electro-wave",
    en: "Electro & Wave",
    de: "Electro & Wave",
    motif: "electro",
    genres: [
      { name: "Electro" },
      { name: "Electroclash" },
      { name: "EBM", motif: "hard", aliases: ["Electronic Body Music"] },
      { name: "New Beat" },
      {
        name: "Wave",
        aliases: ["Dark Wave", "Darkwave", "Cold Wave", "Coldwave"],
      },
      { name: "Post Punk", aliases: ["Post-Punk"] },
      { name: "Synthpop", aliases: ["Synth Pop", "Synth-Pop"] },
      { name: "Synthwave" },
      { name: "Indie Dance", aliases: ["Indietronica"] },
    ],
  },
  {
    slug: "ambient",
    en: "Ambient & Experimental",
    de: "Ambient & Experimental",
    motif: "ambient",
    genres: [
      { name: "Ambient" },
      { name: "Downtempo" },
      { name: "Experimental" },
      { name: "Electronica" },
      { name: "IDM" },
    ],
  },
  {
    slug: "global",
    en: "Global Club",
    de: "Global Club",
    motif: "breaks",
    genres: [
      { name: "Baile Funk", aliases: ["Funk Carioca"] },
      { name: "Batida" },
      { name: "Bouyon" },
      { name: "Ghettotech", aliases: ["Ghetto Tech"] },
      { name: "Amapiano", motif: "house" },
      { name: "Hip-Hop", aliases: ["Hip Hop", "Rap"] },
      { name: "Trap" },
      { name: "Hyperpop", motif: "electro" },
    ],
  },
];

export type CanonicalGenre = {
  name: string;
  slug: string;
  family: GenreFamilySlug;
  // One of the nine poster artworks in `sound.ts`.
  motif: SoundFamily;
  aliases: readonly string[];
};
export type GenreFamily = {
  slug: GenreFamilySlug;
  label: { en: string; de: string };
  motif: SoundFamily;
  order: number;
  genres: readonly CanonicalGenre[];
};

function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Comparison key: case, diacritics, hyphens, spaces and punctuation are
 * ignored, and "&", "'n'", "n" and "and" are one word ("Drum & Bass",
 * "drum'n'bass", "Drum n Bass", "Drumandbass").
 */
export function genreKey(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]n['’`]/g, " and ")
    .replace(/(^|\s)n(\s|$)/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export const genreFamilies: readonly GenreFamily[] = definitions.map(
  (family, order) => ({
    slug: family.slug,
    label: { en: family.en, de: family.de },
    motif: family.motif,
    order,
    genres: family.genres.map((genre) => ({
      name: genre.name,
      slug: slugOf(genre.name),
      family: family.slug,
      motif: genre.motif ?? family.motif,
      aliases: genre.aliases ?? [],
    })),
  }),
);

export const canonicalGenres: readonly CanonicalGenre[] = genreFamilies.flatMap(
  (family) => family.genres,
);

const byKey = new Map<string, CanonicalGenre>();
for (const genre of canonicalGenres) {
  for (const spelling of [genre.name, genre.slug, ...genre.aliases]) {
    const key = genreKey(spelling);
    const existing = byKey.get(key);
    if (existing && existing !== genre)
      throw new Error(
        `Genre spelling "${spelling}" is claimed by ${existing.name} and ${genre.name}`,
      );
    byKey.set(key, genre);
  }
}
const bySlug = new Map(canonicalGenres.map((genre) => [genre.slug, genre]));
const familyBySlug = new Map<string, GenreFamily>(
  genreFamilies.map((family) => [family.slug, family]),
);

/** The canonical genre one free-text spelling names, or null (unknown, slop). */
export function canonicalGenre(raw: string): CanonicalGenre | null {
  return byKey.get(genreKey(raw)) ?? null;
}

export function genreBySlug(slug: string): CanonicalGenre | null {
  return bySlug.get(slug) ?? null;
}

export function genreFamilyBySlug(slug: string): GenreFamily | null {
  return familyBySlug.get(slug) ?? null;
}

/** A family slug, or null; used to parse URL parameters. */
export function isGenreFamilySlug(value: string): value is GenreFamilySlug {
  return genreFamilies.some((family) => family.slug === value);
}

export function familyOfGenre(raw: string): GenreFamily | null {
  const genre = canonicalGenre(raw);
  return genre ? (familyBySlug.get(genre.family) ?? null) : null;
}

export function familyLabel(family: GenreFamily, locale: "de" | "en"): string {
  return family.label[locale];
}

export type NormalizedGenres = {
  // Canonical names, deduplicated, in the order first seen.
  genres: string[];
  // Spellings that map to no canonical genre, deduplicated.
  dropped: string[];
};

/** The distinct canonical genres a list of spellings names, in order. */
export function canonicalGenresOf(raw: readonly string[]): CanonicalGenre[] {
  const genres = new Map<string, CanonicalGenre>();
  for (const spelling of raw) {
    const genre = canonicalGenre(spelling);
    if (genre && !genres.has(genre.slug)) genres.set(genre.slug, genre);
  }
  return [...genres.values()];
}

export function normalizeGenres(raw: readonly string[]): NormalizedGenres {
  const dropped: string[] = [];
  for (const spelling of raw) {
    const text = spelling.trim();
    if (text && !canonicalGenre(spelling) && !dropped.includes(text))
      dropped.push(text);
  }
  return {
    genres: canonicalGenresOf(raw).map((genre) => genre.name),
    dropped,
  };
}

/** Non-blocking write warnings for dropped spellings. */
export function droppedGenreWarnings(
  dropped: readonly string[],
  subject?: string,
): string[] {
  return dropped.map(
    (spelling) =>
      `${subject ? `${subject}: ` : ""}Dropped unknown genre '${spelling}'; see list_genres`,
  );
}
