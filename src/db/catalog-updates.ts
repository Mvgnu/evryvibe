import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  updateDjSchema,
  updateEventSchema,
  updateVenueSchema,
  ocrReferencesMediaId,
  type DjFieldChanges,
  type VenueChanges,
} from "../core/catalog-updates";
import { droppedGenreWarnings, normalizeGenres } from "../core/genres";
import { isPublicPostUrl } from "../core/media";
import {
  djSchema,
  DomainError,
  eventSchema,
  postPackageSchema,
  venueSchema,
} from "../core/model";
import { assessDescription, descriptionWarnings } from "../core/reconciliation";
import {
  soundcloudOembedVerifier,
  verifyChangedProfile,
  type SoundcloudEvidence,
  type SoundcloudVerifier,
} from "../core/soundcloud-oembed";
import type { Database } from "./client";
import { isInstagramImage, linkedCoverCandidates } from "./covers";
import { djs, eventDjs, events, packages, venues } from "./schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type CatalogUpdateDeps = { soundcloud: SoundcloudVerifier };

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new DomainError("invalid_input", parsed.error.message);
  return parsed.data;
}
const iso = (value: string) => new Date(value).toISOString();

/** Drop undefined so an omitted field can never overwrite a stored value. */
const defined = (values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));

const withExtras = <T extends object>(
  entity: T,
  soundcloud: SoundcloudEvidence | undefined,
  warnings: string[],
) => ({
  ...entity,
  ...(soundcloud ? { soundcloud } : {}),
  ...(warnings.length ? { warnings } : {}),
});

/** Slug of another DJ already using this SoundCloud profile, if any. */
export async function djSoundcloudOwner(
  tx: Transaction,
  url: string,
  exceptId?: string,
) {
  const [owner] = await tx
    .select({ slug: djs.slug })
    .from(djs)
    .where(
      exceptId
        ? and(eq(djs.soundcloudUrl, url), ne(djs.id, exceptId))
        : eq(djs.soundcloudUrl, url),
    );
  return owner?.slug;
}
/** Slug of another venue already using this SoundCloud profile, if any. */
export async function venueSoundcloudOwner(
  tx: Transaction,
  url: string,
  exceptId?: string,
) {
  const [owner] = await tx
    .select({ slug: venues.slug })
    .from(venues)
    .where(
      exceptId
        ? and(eq(venues.soundcloudUrl, url), ne(venues.id, exceptId))
        : eq(venues.soundcloudUrl, url),
    );
  return owner?.slug;
}

/** Stored profile, read outside any transaction so unchanged URLs skip verification. */
export async function storedSoundcloud(
  db: Database,
  entity: { dj: string } | { venue: string },
): Promise<string | null> {
  if ("dj" in entity) {
    const [row] = await db
      .select({ url: djs.soundcloudUrl })
      .from(djs)
      .where(eq(djs.id, entity.dj));
    return row?.url ?? null;
  }
  const [row] = await db
    .select({ url: venues.soundcloudUrl })
    .from(venues)
    .where(eq(venues.id, entity.venue));
  return row?.url ?? null;
}

/**
 * Apply partial DJ changes inside a transaction that already holds the
 * catalogue advisory lock. Shared by update_dj and reconciliation completion.
 */
export async function applyDjChanges(
  tx: Transaction,
  djId: string,
  changes: DjFieldChanges,
) {
  const [current] = await tx
    .select()
    .from(djs)
    .where(eq(djs.id, djId))
    .for("update");
  if (!current) throw new DomainError("not_found", "DJ not found");
  const { sampleMediaId, genres: rawGenres, ...unnormalized } = changes;
  // Genres go through the taxonomy; unknown ones are dropped with a warning.
  const genres = rawGenres && normalizeGenres(rawGenres);
  const requested = { ...unnormalized, genres: genres?.genres };
  const genreWarnings = genres ? droppedGenreWarnings(genres.dropped) : [];
  // A stored bio without issues is never replaced by an event note or filler;
  // an explicit "" (clear) is always allowed. Translations travel with it.
  const descriptionKept =
    !!requested.description &&
    assessDescription(requested.description).length > 0 &&
    assessDescription(current.description).length === 0;
  const fields = descriptionKept
    ? { ...requested, description: undefined, translations: undefined }
    : requested;
  let samplePostUrl = fields.samplePostUrl;
  if (sampleMediaId !== undefined) {
    samplePostUrl = null;
    if (sampleMediaId) {
      const shortcode = sampleMediaId.split(":")[1];
      const sourceRows = await tx
        .select({ payload: packages.payload })
        .from(packages)
        .where(
          inArray(packages.postUrl, [
            `https://www.instagram.com/p/${shortcode}/`,
            `https://www.instagram.com/reel/${shortcode}/`,
          ]),
        );
      const matches = sourceRows
        .map(({ payload }) => parse(postPackageSchema, payload))
        .filter((source) => {
          if (source.postUrl.includes("/stories/")) return false;
          const candidateMatch = source.imageCandidates?.some(
            (candidate) => candidate.mediaId === sampleMediaId,
          );
          const ocrMatch = ocrReferencesMediaId(
            source.postUrl,
            source.ocrText,
            sampleMediaId,
          );
          return candidateMatch || ocrMatch;
        });
      if (!matches.length)
        throw new DomainError(
          "invalid_input",
          "Sample media ID must identify a stored public post/reel source",
        );
      samplePostUrl = matches[0]?.postUrl ?? null;
    }
  }
  const normalized = {
    ...fields,
    translations: fields.translations === null ? {} : fields.translations,
    ...(samplePostUrl !== undefined ? { samplePostUrl } : {}),
  };
  const merged = parse(djSchema, { ...current, ...defined(normalized) });
  if (merged.instagramUrl) {
    const [conflict] = await tx
      .select({ id: djs.id })
      .from(djs)
      .where(and(eq(djs.instagramUrl, merged.instagramUrl), ne(djs.id, djId)));
    if (conflict)
      throw new DomainError(
        "identity_conflict",
        "Instagram profile belongs to another DJ",
      );
  }
  if (merged.soundcloudUrl) {
    const owner = await djSoundcloudOwner(tx, merged.soundcloudUrl, djId);
    if (owner)
      throw new DomainError(
        "identity_conflict",
        `SoundCloud profile already belongs to DJ ${owner}`,
      );
  }
  if (!Object.keys(defined(normalized)).length)
    return { dj: merged, descriptionKept, genreWarnings };
  // Drizzle skips undefined values in set(), so omitted fields stay stored.
  const [row] = await tx
    .update(djs)
    .set(normalized)
    .where(eq(djs.id, djId))
    .returning();
  if (!row) throw new Error("DJ update failed");
  return { dj: parse(djSchema, row), descriptionKept, genreWarnings };
}

/** Venue counterpart of applyDjChanges; slug and Instagram profile are not editable here. */
export async function applyVenueChanges(
  tx: Transaction,
  venueId: string,
  changes: VenueChanges,
) {
  const [current] = await tx
    .select()
    .from(venues)
    .where(eq(venues.id, venueId))
    .for("update");
  if (!current) throw new DomainError("not_found", "Venue not found");
  const normalized = {
    ...changes,
    translations: changes.translations === null ? {} : changes.translations,
  };
  const merged = parse(venueSchema, { ...current, ...defined(normalized) });
  if (merged.soundcloudUrl) {
    const owner = await venueSoundcloudOwner(tx, merged.soundcloudUrl, venueId);
    if (owner)
      throw new DomainError(
        "identity_conflict",
        `SoundCloud profile already belongs to venue ${owner}`,
      );
  }
  if (!Object.keys(defined(normalized)).length) return merged;
  const [row] = await tx
    .update(venues)
    .set(normalized)
    .where(eq(venues.id, venueId))
    .returning();
  if (!row) throw new Error("Venue update failed");
  return parse(venueSchema, row);
}

export function catalogUpdateRepository(
  db: Database,
  deps: CatalogUpdateDeps = { soundcloud: soundcloudOembedVerifier() },
) {
  return {
    async updateDj(input: unknown) {
      const { djId, changes } = parse(updateDjSchema, input);
      // Resolve a new profile before any transaction or lock.
      const evidence = await verifyChangedProfile(
        deps.soundcloud,
        changes.soundcloudUrl,
        await storedSoundcloud(db, { dj: djId }),
      );
      const { dj, descriptionKept, genreWarnings } = await db.transaction(
        async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
          return applyDjChanges(tx, djId, changes);
        },
      );
      return withExtras(dj, evidence, [
        ...genreWarnings,
        ...(descriptionKept
          ? [
              "Description not written: it reads like an event note or filler and the stored description is better. Describe the artist, or send an empty description to clear it.",
            ]
          : changes.description === undefined
            ? []
            : descriptionWarnings(dj.description, dj.translations)),
      ]);
    },
    async updateVenue(input: unknown) {
      const { venueId, changes } = parse(updateVenueSchema, input);
      const evidence = await verifyChangedProfile(
        deps.soundcloud,
        changes.soundcloudUrl,
        await storedSoundcloud(db, { venue: venueId }),
      );
      const venue = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
        return applyVenueChanges(tx, venueId, changes);
      });
      return withExtras(
        venue,
        evidence,
        changes.description === undefined
          ? []
          : descriptionWarnings(venue.description, venue.translations),
      );
    },
    async updateEvent(input: unknown) {
      const { eventId, changes } = parse(updateEventSchema, input);
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
        const [current] = await tx
          .select()
          .from(events)
          .where(eq(events.id, eventId))
          .for("update");
        if (!current) throw new DomainError("not_found", "Event not found");
        const lineup = await tx
          .select()
          .from(eventDjs)
          .where(eq(eventDjs.eventId, eventId))
          .orderBy(asc(eventDjs.position));
        const {
          imageMediaId,
          djIds,
          genres: rawGenres,
          ...unnormalized
        } = changes;
        const genres = rawGenres && normalizeGenres(rawGenres);
        const fields = { ...unnormalized, genres: genres?.genres };
        const normalized = {
          ...fields,
          translations: fields.translations === null ? {} : fields.translations,
        };
        let imageUrl = current.imageUrl;
        let imageSlide = current.imageSlide;
        let imageSourceUrl = current.imageSourceUrl;
        const touchesImage =
          imageMediaId !== undefined || fields.imageUrl !== undefined;
        if (touchesImage) {
          imageUrl = fields.imageUrl ?? null;
          imageSlide = null;
          imageSourceUrl = null;
          // Candidates of this event's current source and of any earlier
          // public post/reel linked to it; the current source wins ties.
          const pool = (await linkedCoverCandidates(tx, eventId)).sort(
            (a, b) =>
              Number(b.sourceUrl === current.sourceUrl) -
              Number(a.sourceUrl === current.sourceUrl),
          );
          if (imageMediaId || (imageUrl && isInstagramImage(imageUrl))) {
            const selected = pool.find((candidate) =>
              imageMediaId
                ? candidate.mediaId === imageMediaId
                : candidate.url === imageUrl,
            );
            if (!selected)
              throw new DomainError(
                "invalid_input",
                "Image must match a candidate from a public post/reel package linked to this event",
              );
            imageUrl = selected.url;
            imageSlide = selected.slide;
            imageSourceUrl = selected.sourceUrl;
          } else if (imageUrl) {
            imageSourceUrl = isPublicPostUrl(current.sourceUrl)
              ? current.sourceUrl
              : (pool[0]?.sourceUrl ?? null);
            if (!imageSourceUrl)
              throw new DomainError(
                "invalid_input",
                "Story-based events cannot publish an image",
              );
          }
        }
        const {
          imageSlide: ignored,
          imageSuppressed: ignoredSuppression,
          imageSourceUrl: ignoredSource,
          ...publicCurrent
        } = current;
        void ignored;
        void ignoredSuppression;
        void ignoredSource;
        const merged = parse(eventSchema, {
          ...publicCurrent,
          startsAt: iso(current.startsAt),
          endsAt: current.endsAt ? iso(current.endsAt) : null,
          observedAt: iso(current.observedAt),
          ...defined(normalized),
          imageUrl,
          djIds: djIds ?? lineup.map((entry) => entry.djId),
        });
        const [venue] = await tx
          .select({ id: venues.id })
          .from(venues)
          .where(eq(venues.id, merged.venueId));
        if (!venue)
          throw new DomainError("missing_facts", "Venue does not exist");
        const [conflict] = await tx
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              ne(events.id, eventId),
              eq(events.venueId, merged.venueId),
              eq(events.startsAt, merged.startsAt),
            ),
          );
        if (conflict)
          throw new DomainError(
            "identity_conflict",
            "Another event exists at this venue/start",
          );
        if (djIds?.length) {
          const existing = await tx
            .select({ id: djs.id })
            .from(djs)
            .where(inArray(djs.id, djIds));
          if (existing.length !== djIds.length)
            throw new DomainError(
              "missing_facts",
              "A lineup DJ does not exist",
            );
        }
        await tx
          .update(events)
          .set({
            ...normalized,
            imageUrl,
            imageSlide,
            imageSourceUrl,
            ...(touchesImage ? { imageSuppressed: imageUrl === null } : {}),
          })
          .where(eq(events.id, eventId));
        if (djIds !== undefined) {
          await tx.delete(eventDjs).where(eq(eventDjs.eventId, eventId));
          if (djIds.length)
            await tx
              .insert(eventDjs)
              .values(
                djIds.map((djId, position) => ({ eventId, djId, position })),
              );
        }
        return {
          ...merged,
          ...(genres?.dropped.length
            ? { warnings: droppedGenreWarnings(genres.dropped) }
            : {}),
        };
      });
    },
  };
}
