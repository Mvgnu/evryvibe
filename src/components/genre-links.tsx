import Link from "next/link";
import { Fragment } from "react";
import { genrePathOf } from "@/components/dj-directory-view";
import { localizePath, type Locale } from "@/core/i18n";

// Genre names as links to their genre pages; a name the taxonomy does not
// know stays plain text, and so does a genre without a page when the caller
// passes the slugs that have one (`listedGenreSlugs`).
export function GenreLinks({
  genres,
  locale,
  listed,
}: {
  genres: readonly string[];
  locale: Locale;
  listed?: ReadonlySet<string>;
}) {
  return genres.map((name, index) => {
    const path = genrePathOf(name);
    const slug = path?.slice("/genres/".length);
    return (
      <Fragment key={name}>
        {index > 0 && " · "}
        {path && (!listed || (slug && listed.has(slug))) ? (
          <Link href={localizePath(path, locale)}>{name}</Link>
        ) : (
          name
        )}
      </Fragment>
    );
  });
}
