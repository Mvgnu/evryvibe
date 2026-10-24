// The nine sound families are the poster artwork (colour and motif). They are
// not a taxonomy: which genre belongs to which motif is declared once, in the
// genre taxonomy (`genres.ts`), so posters and filters cannot disagree.
import { canonicalGenre } from "./genres";

export const soundFamilies = [
  "techno",
  "hard",
  "acid",
  "dub",
  "house",
  "electro",
  "breaks",
  "trance",
  "ambient",
] as const;
export type SoundFamily = (typeof soundFamilies)[number];

/** The poster motif one genre spelling draws, or null when it is no known genre. */
export function genreFamily(genre: string): SoundFamily | null {
  return canonicalGenre(genre)?.motif ?? null;
}

// The first genre that names a canonical genre decides the motif; unknown or
// empty is techno.
export function soundFamily(genres: readonly string[]): SoundFamily {
  for (const genre of genres) {
    const motif = genreFamily(genre);
    if (motif) return motif;
  }
  return "techno";
}

// FNV-1a: a stable 32-bit seed so server and browser render the same variant.
export function posterSeed(slug: string): number {
  let hash = 0x811c9dc5;
  for (const character of slug) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
