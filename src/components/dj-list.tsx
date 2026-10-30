import Link from "next/link";
import { Icon } from "@/components/icon";
import { copy } from "@/components/catalog-ui";
import type { DjRow } from "@/components/dj-directory-view";
import { formatCount } from "@/components/dj-directory-view";
import { SoundTile } from "@/components/poster";
import {
  ListenButton,
  ListenGroup,
  ListenPanel,
} from "@/components/soundcloud";
import { localizePath, type Locale } from "@/core/i18n";
import { posterSeed } from "@/core/sound";

// The DJ directory as compact programme rows. Each row is one link (the
// name, stretched over the row) and, for a DJ with a SoundCloud profile, one
// action: "Anhören" opens SoundCloud's own player under the row, one DJ at a
// time across the whole list, behind the shared external-media consent.
// DJs you can listen to come first and are grouped under their own heading,
// so the order explains itself.

function Row({
  row: { entry, sound, where, when },
  locale,
  heading: Heading,
  embeddable,
}: {
  row: DjRow;
  locale: Locale;
  heading: "h3" | "h4";
  embeddable: boolean;
}) {
  const { dj } = entry;
  const motif = entry.genres[0]?.motif ?? "techno";
  return (
    <li className="dj-row" id={`dj-${dj.slug}`}>
      <div className="dj-row-main">
        <div className="dj-row-art" aria-hidden="true">
          <SoundTile family={motif} seed={posterSeed(dj.slug)} />
        </div>
        <Heading className="dj-row-name">
          <Link href={localizePath(`/djs/${dj.slug}`, locale)}>{dj.name}</Link>
        </Heading>
        {sound && <p className="dj-row-sound">{sound}</p>}
        <p className="dj-row-where">{where}</p>
        {when && <p className="dj-row-when">{when}</p>}
        {dj.soundcloudUrl && (
          <div className="dj-row-action">
            {embeddable ? (
              <ListenButton
                id={dj.slug}
                url={dj.soundcloudUrl}
                name={dj.name}
                locale={locale}
              />
            ) : (
              <a
                className="listen-toggle"
                href={dj.soundcloudUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                SoundCloud <Icon name="arrow-up-right" />
              </a>
            )}
          </div>
        )}
      </div>
      {dj.soundcloudUrl && embeddable && (
        <ListenPanel
          id={dj.slug}
          url={dj.soundcloudUrl}
          name={dj.name}
          locale={locale}
        />
      )}
    </li>
  );
}

export function DjList({
  rows,
  listenable,
  others,
  locale,
  level = 2,
  embeddable = true,
}: {
  rows: DjRow[];
  /** Totals of the whole filtered result, not just the shown rows. */
  listenable: number;
  others: number;
  locale: Locale;
  /** Heading level of the group headings; rows sit one below. */
  level?: 2 | 3;
  embeddable?: boolean;
}) {
  const groups = [
    {
      key: "listen",
      label: copy(locale, "Auf SoundCloud", "On SoundCloud"),
      total: listenable,
      rows: rows.filter((row) => row.entry.dj.soundcloudUrl),
    },
    {
      key: "more",
      label: copy(locale, "Ohne SoundCloud", "Not on SoundCloud"),
      total: others,
      rows: rows.filter((row) => !row.entry.dj.soundcloudUrl),
    },
  ].filter((group) => group.rows.length);
  const GroupHeading = level === 2 ? "h2" : "h3";
  const rowHeading = level === 2 ? "h3" : "h4";
  return (
    <ListenGroup>
      <div className="dj-list">
        {groups.map((group) => (
          <section
            key={group.key}
            className={`dj-group dj-group-${group.key}`}
            aria-labelledby={`dj-group-${group.key}`}
          >
            <header className="dj-group-heading">
              <GroupHeading id={`dj-group-${group.key}`}>
                {group.label}
              </GroupHeading>
              <span className="dj-group-count">
                {formatCount(group.total, locale)}{" "}
                {group.total === 1 ? "DJ" : "DJs"}
              </span>
            </header>
            <ul className="dj-rows">
              {group.rows.map((row) => (
                <Row
                  key={row.entry.dj.id}
                  row={row}
                  locale={locale}
                  heading={rowHeading}
                  embeddable={embeddable}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ListenGroup>
  );
}
