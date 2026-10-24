import { citySlug, type City } from "@/core/cities";
import {
  canonicalGenre,
  genreBySlug,
  isGenreFamilySlug,
  type CanonicalGenre,
} from "@/core/genres";
import { localizePath, type Locale } from "@/core/i18n";

type GenreRoute =
  | { kind: "genre"; genre: CanonicalGenre }
  | { kind: "redirect"; href: string }
  | { kind: "missing" };

function decodedSegment(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function resolveGenre(spelling: string): CanonicalGenre | null {
  return genreBySlug(spelling) ?? canonicalGenre(spelling);
}

// Earlier SSR payloads emitted a URL-shaped scroll-effect dependency. Keep
// those discovered URLs useful without treating arbitrary unknown routes as pages.
export function resolveGenreRoute(
  slug: string,
  cities: readonly City[],
  locale: Locale,
): GenreRoute {
  const spelling = decodedSegment(slug);
  if (spelling.includes("|")) {
    const [name, cityName, extra] = spelling.split("|");
    if (extra !== undefined || !name || cityName === undefined)
      return { kind: "missing" };
    const genre = resolveGenre(name);
    if (!genre) return { kind: "missing" };
    const path = localizePath(`/genres/${genre.slug}`, locale);
    if (!cityName) return { kind: "redirect", href: path };
    const city = cities.find((item) => item.slug === citySlug(cityName));
    if (!city) return { kind: "missing" };
    return {
      kind: "redirect",
      href: `${path}?${new URLSearchParams({ city: city.slug })}`,
    };
  }
  const genre = resolveGenre(spelling);
  if (genre) return { kind: "genre", genre };
  if (isGenreFamilySlug(spelling))
    return {
      kind: "redirect",
      href: `${localizePath("/djs", locale)}?${new URLSearchParams({ sound: spelling })}`,
    };
  return { kind: "missing" };
}
