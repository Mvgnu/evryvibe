export type Locale = "de" | "en";

export function localizePath(path: string, locale: Locale): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Expected an internal absolute path");
  }
  const unprefixed = path.replace(/^\/en(?=\/|[?#]|$)/, "") || "/";
  const normalized = unprefixed.startsWith("/") ? unprefixed : `/${unprefixed}`;
  if (locale === "de") return normalized;
  return normalized === "/" ? "/en" : `/en${normalized}`;
}

export function localizedDescription(
  entity: {
    description: string;
    translations?: { en?: { description?: string } };
  },
  locale: Locale,
): string {
  return locale === "en"
    ? (entity.translations?.en?.description ?? entity.description)
    : entity.description;
}

export function localizedTitle(
  entity: { title: string; translations?: { en?: { title?: string } } },
  locale: Locale,
): string {
  return locale === "en"
    ? (entity.translations?.en?.title ?? entity.title)
    : entity.title;
}
