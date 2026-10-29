import {
  instagramMediaId,
  isPublicPostUrl,
  labelOcrMediaIds,
} from "../core/media";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bundleSchema,
  DomainError,
  postPackageSchema,
  instagramPostSchema,
  imageCandidateSchema,
  venueInputSchema,
  type PostPackage,
  type PublishBundle,
} from "../core/model";
import { droppedGenreWarnings, normalizeGenres } from "../core/genres";
import { assessDescription, descriptionWarnings } from "../core/reconciliation";
import type { ReconciliationCheck } from "../core/reconciliation-tasks";
import { isSoundcloudUrl } from "../core/soundcloud";
import {
  soundcloudOembedVerifier,
  verifyChangedProfile,
  type SoundcloudEvidence,
  type SoundcloudVerifier,
} from "../core/soundcloud-oembed";
import type { Database } from "./client";
import { djSoundcloudOwner, venueSoundcloudOwner } from "./catalog-updates";
import { isInstagramImage, linkedCoverCandidates } from "./covers";
import type { CoverCandidate } from "./covers";
import { enqueueReconciliation, refreshDjPriorities } from "./reconciliation";
import {
  djs,
  djAliases,
  eventDjs,
  events,
  eventSources,
  packages,
  venues,
  venueSources,
  packageHistory,
} from "./schema";

import {
  enqueueCollectedPackageSchema,
  recordSourceRunSchema,
  refreshPackageSchema,
  setVenueSourceSchema,
  setVenueProfileSchema,
  venueSourceSchema,
} from "../core/sources";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const packageIdSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(1).max(2000);
export const queueStateSchema = z.enum([
  "pending",
  "processing",
  "done",
  "deferred",
  "discarded",
]);
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError(
      "invalid_input",
      result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  return result.data;
}
const publicPackage = (row: typeof packages.$inferSelect) => {
  const { leaseToken, completedToken, ...visible } = row;
  void leaseToken;
  void completedToken;
  const parsedPayload = postPackageSchema.safeParse(visible.payload);
  return {
    ...visible,
    // Only vetted, source-scoped post/reel candidates are exposed. Legacy
    // payloads from before this schema are ignored rather than trusted.
    payload: {
      postUrl: visible.payload.postUrl,
      accountUrl: visible.payload.accountUrl,
      caption: visible.payload.caption,
      ocrText: parsedPayload.success
        ? labelOcrMediaIds(
            parsedPayload.data.postUrl,
            parsedPayload.data.ocrText,
          )
        : visible.payload.ocrText,
      capturedAt: visible.payload.capturedAt,
      ...(parsedPayload.success &&
      !visible.payload.postUrl.includes("/stories/")
        ? { imageCandidates: parsedPayload.data.imageCandidates }
        : {}),
    },
    createdAt: new Date(visible.createdAt).toISOString(),
    updatedAt: new Date(visible.updatedAt).toISOString(),
    leaseExpiresAt: visible.leaseExpiresAt
      ? new Date(visible.leaseExpiresAt).toISOString()
      : null,
  };
};
export type IngestionDeps = { soundcloud: SoundcloudVerifier };

export function ingestionRepository(
  db: Database,
  deps: IngestionDeps = { soundcloud: soundcloudOembedVerifier() },
) {
  return {
    async listPostCovers() {
      const rows = await db
        .select({
          sourceUrl: events.sourceUrl,
          sourceAccountUrl: events.sourceAccountUrl,
          imageUrl: events.imageUrl,
          imageSlide: events.imageSlide,
          imageSuppressed: events.imageSuppressed,
          imageSourceUrl: events.imageSourceUrl,
        })
        .from(events);
      // The public post/reel a cover (or a missing cover) refreshes from. A
      // kept cover can come from an older post than the event's current source.
      const withSource = rows.flatMap((row) => {
        const coverSource =
          row.imageSourceUrl ??
          (isPublicPostUrl(row.sourceUrl) ? row.sourceUrl : null);
        return coverSource ? [{ ...row, coverSource }] : [];
      });
      const publishedSources = new Set(
        withSource.map((row) => row.coverSource),
      );
      const foreign = [
        ...new Set(
          withSource
            .filter((row) => row.coverSource !== row.sourceUrl)
            .map((row) => row.coverSource),
        ),
      ];
      const accounts = new Map<string, string>();
      if (foreign.length)
        for (const row of await db
          .select({ postUrl: packages.postUrl, payload: packages.payload })
          .from(packages)
          .where(inArray(packages.postUrl, foreign)))
          accounts.set(row.postUrl, row.payload.accountUrl);
      const packageRows = await db
        .select({ payload: packages.payload, state: packages.state })
        .from(packages)
        .where(
          and(
            ne(packages.state, "discarded"),
            sql`${packages.payload}->'imageCandidates' IS NOT NULL`,
          ),
        );
      const candidates = packageRows.flatMap(({ payload, state }) => {
        if (state === "done" && !publishedSources.has(payload.postUrl))
          return [];
        const parsed = postPackageSchema.safeParse(payload);
        if (
          !parsed.success ||
          !instagramPostSchema.safeParse(parsed.data.postUrl).success
        )
          return [];
        return (parsed.data.imageCandidates ?? []).map((candidate) => ({
          sourceUrl: parsed.data.postUrl,
          sourceAccountUrl: parsed.data.accountUrl,
          imageUrl: candidate.url,
          imageSlide: candidate.slide,
        }));
      });
      return {
        sources: [
          ...withSource
            .filter(
              (row) =>
                !row.imageSuppressed &&
                (row.imageSlide !== null || row.imageUrl === null),
            )
            .map((row) => ({
              sourceUrl: row.coverSource,
              sourceAccountUrl:
                row.coverSource === row.sourceUrl
                  ? row.sourceAccountUrl
                  : (accounts.get(row.coverSource) ?? null),
              imageUrl: row.imageUrl,
              imageSlide: row.imageSlide,
              imageSuppressed: row.imageSuppressed,
            })),
          ...candidates,
        ],
      };
    },
    async refreshPostImages(input: unknown) {
      const data = parse(
        z
          .object({
            sourceUrl: instagramPostSchema,
            images: z.array(imageCandidateSchema).min(1).max(20),
          })
          .strict(),
        input,
      );
      if (
        new Set(data.images.map((image) => image.slide)).size !==
        data.images.length
      )
        throw new DomainError("invalid_input", "Image slides must be unique");
      for (const image of data.images) {
        if (
          image.mediaId &&
          image.mediaId !== instagramMediaId(data.sourceUrl, image.slide)
        )
          throw new DomainError(
            "invalid_input",
            "Image media ID must match source permalink and slide",
          );
      }
      return db.transaction(async (tx) => {
        const sourcePackages = await tx
          .select()
          .from(packages)
          .where(sql`${packages.payload}->>'postUrl' = ${data.sourceUrl}`)
          .for("update");
        const rows = await tx
          .select({
            id: events.id,
            imageUrl: events.imageUrl,
            imageSlide: events.imageSlide,
            imageSuppressed: events.imageSuppressed,
          })
          .from(events)
          .where(
            or(
              eq(events.imageSourceUrl, data.sourceUrl),
              // Events without a cover refill from their own post source.
              and(
                isNull(events.imageSourceUrl),
                eq(events.sourceUrl, data.sourceUrl),
              ),
            ),
          )
          .for("update");
        let updated = 0;
        let missing = 0;
        for (const row of rows) {
          // A deliberate clear or external image remains untouched; legacy
          // missing covers still receive the source's first public slide.
          if (
            row.imageSuppressed ||
            (row.imageSlide === null && row.imageUrl !== null)
          )
            continue;
          const slide = row.imageSlide ?? 1;
          const selected = data.images.find(
            (candidate) => candidate.slide === slide,
          );
          if (!selected) {
            missing++;
            continue;
          }
          if (row.imageSlide === slide && row.imageUrl === selected.url)
            continue;
          await tx
            .update(events)
            .set({
              imageUrl: selected.url,
              imageSlide: slide,
              imageSourceUrl: data.sourceUrl,
            })
            .where(eq(events.id, row.id));
          updated++;
        }
        // Signed URLs are refreshable caches; preserve the captured evidence and
        // source/slide identity while later ID references get the latest URL.
        for (const sourcePackage of sourcePackages) {
          const payload = postPackageSchema.safeParse(sourcePackage.payload);
          if (!payload.success || !payload.data.imageCandidates) continue;
          const imageCandidates = payload.data.imageCandidates.map(
            (candidate) => {
              const fresh = data.images.find(
                (image) => image.slide === candidate.slide,
              );
              return fresh ? { ...candidate, url: fresh.url } : candidate;
            },
          );
          await tx
            .update(packages)
            .set({
              payload: { ...payload.data, imageCandidates },
            })
            .where(eq(packages.id, sourcePackage.id));
        }
        return { updated, missing };
      });
    },
    async setVenueProfile(input: unknown) {
      const data = parse(setVenueProfileSchema, input);
      return db.transaction(async (tx) => {
        // Match the catalog publication lock order before acquiring venue locks.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
        const { venue, source } = await lockSource(tx, data.venueId);
        checkRevision(source.revision, data.expectedRevision);
        if (venue.instagramUrl === data.instagramUrl)
          return publicSource(venue, source);
        if (data.instagramUrl) {
          const [owner] = await tx
            .select({ id: venues.id })
            .from(venues)
            .where(eq(venues.instagramUrl, data.instagramUrl));
          if (owner && owner.id !== venue.id)
            throw new DomainError(
              "identity_conflict",
              "Instagram profile belongs to another venue",
            );
        }
        const [updatedVenue] = await tx
          .update(venues)
          .set({ instagramUrl: data.instagramUrl })
          .where(eq(venues.id, venue.id))
          .returning();
        const [updatedSource] = await tx
          .update(venueSources)
          .set({
            enabled: false,
            revision: source.revision + 1,
            lastStartedAt: null,
            lastFinishedAt: null,
            lastSucceededAt: null,
            lastError: null,
            lastPostCount: 0,
          })
          .where(eq(venueSources.venueId, venue.id))
          .returning();
        if (!updatedVenue || !updatedSource)
          throw new Error("Source update failed");
        return publicSource(updatedVenue, updatedSource);
      });
    },
    async enqueue(input: unknown) {
      const payload = parse(postPackageSchema, input);
      return enqueuePayload(db, payload);
    },
    async upsertVenue(input: unknown) {
      const venue = parse(venueInputSchema, input);
      const [stored] = await db
        .select({ url: venues.soundcloudUrl })
        .from(venues)
        .where(eq(venues.slug, venue.slug));
      const evidence = await verifyChangedProfile(
        deps.soundcloud,
        venue.soundcloudUrl,
        stored?.url,
      );
      const row = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
        return writeVenue(tx, venue);
      });
      const warnings = descriptionWarnings(row.description, row.translations);
      return {
        ...row,
        ...(evidence ? { soundcloud: evidence } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
    },
    async listVenueSources(enabledOnly = false) {
      parse(z.boolean(), enabledOnly);
      const rows = await db
        .select({ venue: venues, source: venueSources })
        .from(venues)
        .leftJoin(venueSources, eq(venues.id, venueSources.venueId))
        .where(enabledOnly ? eq(venueSources.enabled, true) : undefined)
        .orderBy(asc(venues.name), asc(venues.id));
      return {
        sources: rows.map(({ venue, source }) => publicSource(venue, source)),
      };
    },
    async setVenueSource(input: unknown) {
      const data = parse(setVenueSourceSchema, input);
      return db.transaction(async (tx) => {
        const { venue, source } = await lockSource(tx, data.venueId);
        checkRevision(source.revision, data.expectedRevision);
        if (data.enabled && !venue.instagramUrl)
          throw new DomainError(
            "missing_facts",
            "A venue needs an Instagram profile before collection can be enabled",
          );
        const [updated] = await tx
          .update(venueSources)
          .set({ enabled: data.enabled, revision: source.revision + 1 })
          .where(eq(venueSources.venueId, venue.id))
          .returning();
        if (!updated) throw new Error("Source update failed");
        return publicSource(venue, updated);
      });
    },
    async enqueueCollectedPackage(input: unknown) {
      const data = parse(enqueueCollectedPackageSchema, input);
      return db.transaction(async (tx) => {
        const { venue, source } = await lockSource(tx, data.venueId);
        checkRevision(source.revision, data.expectedRevision);
        if (!source.enabled)
          throw new DomainError(
            "source_disabled",
            "Venue collection is disabled",
          );
        if (venue.instagramUrl !== data.package.accountUrl)
          throw new DomainError(
            "identity_conflict",
            "Package account does not match venue profile",
          );
        return enqueuePayload(tx, data.package);
      });
    },
    async recordSourceRun(input: unknown) {
      const data = parse(recordSourceRunSchema, input);
      return db.transaction(async (tx) => {
        const { venue, source } = await lockSource(tx, data.venueId);
        checkRevision(source.revision, data.expectedRevision);
        if (
          source.lastStartedAt &&
          Date.parse(data.startedAt) <= Date.parse(source.lastStartedAt)
        )
          return publicSource(venue, source);
        const [updated] = await tx
          .update(venueSources)
          .set({
            lastStartedAt: data.startedAt,
            lastFinishedAt: data.finishedAt,
            lastSucceededAt:
              data.error === null ? data.finishedAt : source.lastSucceededAt,
            lastError: data.error,
            lastPostCount: data.postsQueued,
          })
          .where(eq(venueSources.venueId, venue.id))
          .returning();
        if (!updated) throw new Error("Source run update failed");
        return publicSource(venue, updated);
      });
    },
    async refreshPackage(input: unknown) {
      const data = parse(refreshPackageSchema, input);
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(packages)
          .where(eq(packages.id, data.packageId))
          .for("update");
        if (!current) throw new DomainError("not_found", "Package not found");
        const [live] = await tx
          .select({ id: packages.id })
          .from(packages)
          .where(
            and(
              eq(packages.id, current.id),
              eq(packages.state, "processing"),
              sql`${packages.leaseExpiresAt} > clock_timestamp()`,
            ),
          );
        if (live)
          throw new DomainError(
            "stale_lease",
            "Cannot refresh a package with a live processing lease",
          );
        if (
          current.postUrl !== data.package.postUrl ||
          current.payload.accountUrl !== data.package.accountUrl
        )
          throw new DomainError(
            "identity_conflict",
            "Refresh must retain the same post and account",
          );
        if (
          Date.parse(data.package.capturedAt) <=
          Date.parse(current.payload.capturedAt)
        )
          throw new DomainError(
            "invalid_input",
            "Refresh requires a newer capture",
          );
        await tx
          .insert(packageHistory)
          .values({ packageId: current.id, payload: current.payload });
        const excess = await tx
          .select({ id: packageHistory.id })
          .from(packageHistory)
          .where(eq(packageHistory.packageId, current.id))
          .orderBy(desc(packageHistory.replacedAt), desc(packageHistory.id))
          .offset(5);
        if (excess.length)
          await tx.delete(packageHistory).where(
            inArray(
              packageHistory.id,
              excess.map((row) => row.id),
            ),
          );
        const [updated] = await tx
          .update(packages)
          .set({
            payload: data.package,
            state: "pending",
            attempts: 0,
            lastReason: null,
            leaseToken: null,
            leaseExpiresAt: null,
            completedToken: null,
            resultEventIds: [],
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(packages.id, current.id))
          .returning();
        if (!updated) throw new Error("Package refresh failed");
        return publicPackage(updated);
      });
    },
    async list(state?: z.infer<typeof queueStateSchema>, limit = 20) {
      const count = parse(z.number().int().min(1).max(100), limit);
      if (state) parse(queueStateSchema, state);
      return (
        await db
          .select()
          .from(packages)
          .where(state ? eq(packages.state, state) : undefined)
          .orderBy(asc(packages.createdAt), asc(packages.id))
          .limit(count)
      ).map(publicPackage);
    },
    async get(id: string) {
      parse(packageIdSchema, id);
      const [row] = await db.select().from(packages).where(eq(packages.id, id));
      if (!row) throw new DomainError("not_found", "Package not found");
      return publicPackage(row);
    },
    async claim(leaseSeconds = 900) {
      parse(z.number().int().min(30).max(3600), leaseSeconds);
      return db.transaction(async (tx) => {
        await tx
          .update(packages)
          .set({
            state: "deferred",
            lastReason:
              "Five abandoned attempts; intentionally requeue when the missing context or worker problem is resolved",
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(packages.state, "processing"),
              sql`${packages.leaseExpiresAt} <= clock_timestamp()`,
              sql`${packages.attempts} >= 5`,
            ),
          );
        const [row] = await tx
          .select()
          .from(packages)
          .where(
            or(
              eq(packages.state, "pending"),
              and(
                eq(packages.state, "processing"),
                sql`${packages.leaseExpiresAt} <= now()`,
              ),
            ),
          )
          .orderBy(asc(packages.createdAt), asc(packages.id))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return { claimed: false as const };
        const token = randomUUID();
        const [claimed] = await tx
          .update(packages)
          .set({
            state: "processing",
            leaseToken: token,
            leaseExpiresAt: sql`now() + ${leaseSeconds} * interval '1 second'`,
            attempts: sql`${packages.attempts} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(packages.id, row.id))
          .returning();
        if (!claimed) throw new Error("Claim did not return package");
        return {
          claimed: true as const,
          claimToken: token,
          package: publicPackage(claimed),
        };
      });
    },
    async finish(
      id: string,
      token: string,
      state: "deferred" | "discarded",
      reason: string,
    ) {
      parse(packageIdSchema, id);
      parse(packageIdSchema, token);
      parse(z.enum(["deferred", "discarded"]), state);
      parse(reasonSchema, reason);
      return db.transaction(async (tx) => {
        // A predicate evaluated before waiting for a row lock can be stale even
        // with clock_timestamp(). Lock first; validate in the next statement.
        await tx
          .select({ id: packages.id })
          .from(packages)
          .where(eq(packages.id, id))
          .for("update");
        const [row] = await tx
          .update(packages)
          .set({
            state,
            lastReason: reason,
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(packages.id, id),
              eq(packages.state, "processing"),
              eq(packages.leaseToken, token),
              sql`${packages.leaseExpiresAt} > clock_timestamp()`,
            ),
          )
          .returning();
        if (!row)
          throw new DomainError(
            "stale_lease",
            "Claim is expired, replaced, or package is no longer processing",
          );
        return publicPackage(row);
      });
    },
    async requeue(id: string) {
      parse(packageIdSchema, id);
      const [row] = await db
        .update(packages)
        .set({
          state: "pending",
          attempts: 0,
          lastReason: null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(packages.id, id), eq(packages.state, "deferred")))
        .returning();
      if (!row)
        throw new DomainError(
          "invalid_input",
          "Only a deferred package can be intentionally requeued",
        );
      return publicPackage(row);
    },
    async complete(id: string, token: string, input: unknown) {
      parse(packageIdSchema, id);
      parse(packageIdSchema, token);
      const bundle = parse(bundleSchema, input);
      assertUnique(bundle);
      // Resolve new or changed SoundCloud profiles before the transaction so no
      // network call happens while holding locks.
      const soundcloud = await verifyBundleProfiles(
        db,
        deps.soundcloud,
        bundle,
      );
      return db.transaction(async (tx) => {
        const [source] = await tx
          .select()
          .from(packages)
          .where(eq(packages.id, id))
          .for("update");
        if (!source) throw new DomainError("not_found", "Package not found");
        if (source.state === "done" && source.completedToken === token)
          return { eventIds: source.resultEventIds, replayed: true };
        const [active] = await tx
          .select({ id: packages.id })
          .from(packages)
          .where(
            and(
              eq(packages.id, id),
              eq(packages.state, "processing"),
              eq(packages.leaseToken, token),
              sql`${packages.leaseExpiresAt} > clock_timestamp()`,
            ),
          );
        if (!active)
          throw new DomainError(
            "stale_lease",
            "Claim is expired, replaced, or package is no longer processing",
          );
        // Serialize short catalogue publications; agent research never holds a lock.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
        const venueIds = new Map<string, string>();
        const djIds = new Map<string, string>();
        for (const item of bundle.venues) {
          const row = await writeVenue(tx, item);
          venueIds.set(item.slug, row.id);
        }
        const warnings: string[] = [];
        const queuedDjs: string[] = [];
        for (const item of bundle.djs) {
          const [alias] = await tx
            .select({ slug: djs.slug })
            .from(djAliases)
            .innerJoin(djs, eq(djAliases.djId, djs.id))
            .where(eq(djAliases.slug, item.slug));
          if (alias)
            throw new DomainError(
              "identity_conflict",
              `DJ slug ${item.slug} was merged into ${alias.slug}; use the canonical slug`,
            );
          const matches = await tx
            .select()
            .from(djs)
            .where(
              or(
                eq(djs.slug, item.slug),
                item.instagramUrl
                  ? eq(djs.instagramUrl, item.instagramUrl)
                  : undefined,
              ),
            );
          const current = identity(matches, item);
          if (item.soundcloudUrl) {
            const owner = await djSoundcloudOwner(
              tx,
              item.soundcloudUrl,
              current?.id,
            );
            if (owner)
              throw new DomainError(
                "identity_conflict",
                `SoundCloud profile already belongs to DJ ${owner}`,
              );
          }
          // Undefined values are skipped by update (keeping what is stored)
          // and fall back to the column default on insert; null clears.
          const {
            description,
            genres: rawGenres,
            translations,
            ...rest
          } = item;
          const genres = rawGenres && normalizeGenres(rawGenres);
          if (genres)
            warnings.push(
              ...droppedGenreWarnings(genres.dropped, `dj ${item.slug}`),
            );
          // A stored bio without issues is never replaced by an event note
          // or filler: keep it, and the translations that belong with it.
          const keepStored =
            !!current &&
            !!description &&
            assessDescription(description).length > 0 &&
            assessDescription(current.description).length === 0;
          const [row] = current
            ? await tx
                .update(djs)
                .set({
                  ...rest,
                  description: keepStored ? undefined : description,
                  translations: keepStored ? undefined : translations,
                  genres: genres?.genres,
                })
                .where(eq(djs.id, current.id))
                .returning()
            : await tx
                .insert(djs)
                .values({
                  ...rest,
                  translations,
                  description: description ?? "",
                  genres: genres?.genres ?? [],
                })
                .returning();
          if (!row) throw new Error("DJ write failed");
          djIds.set(item.slug, row.id);
          const checks: ReconciliationCheck[] = [
            ...assessDescription(row.description),
          ];
          const messages = keepStored
            ? [
                "description not written: it reads like an event note or filler and the stored description is better; repeat a DJ in bundle.djs only to create it or fill missing fields",
              ]
            : descriptionWarnings(row.description, row.translations);
          if (messages.length)
            warnings.push(
              ...messages.map((text) => `dj ${item.slug}: ${text}`),
            );
          if (!current && !row.soundcloudUrl) checks.push("soundcloud_missing");
          if (row.websiteUrl && isSoundcloudUrl(row.websiteUrl))
            checks.push("soundcloud_in_website");
          if (checks.length) {
            await enqueueReconciliation(
              tx,
              { djId: row.id },
              checks,
              current
                ? "Description written by complete_package needs review"
                : "New DJ published by complete_package",
            );
            queuedDjs.push(row.id);
          }
        }
        const resultIds: string[] = [];
        const payload = parse(postPackageSchema, source.payload);
        const storySource = payload.postUrl.includes("/stories/");
        const ownCandidates: CoverCandidate[] = storySource
          ? []
          : (payload.imageCandidates ?? []).flatMap((candidate) =>
              candidate.mediaId
                ? [
                    {
                      url: candidate.url,
                      slide: candidate.slide,
                      mediaId: candidate.mediaId,
                      sourceUrl: payload.postUrl,
                    },
                  ]
                : [],
            );
        for (const item of bundle.events) {
          let venueId = venueIds.get(item.venueSlug);
          if (!venueId) {
            const [venue] = await tx
              .select()
              .from(venues)
              .where(eq(venues.slug, item.venueSlug));
            venueId = venue?.id;
          }
          if (!venueId)
            throw new DomainError(
              "missing_facts",
              `Venue ${item.venueSlug} does not exist; include it in the bundle`,
            );
          const lineup: string[] = [];
          for (const slug of item.djSlugs) {
            let djId = djIds.get(slug);
            if (!djId) {
              const [dj] = await tx
                .select()
                .from(djs)
                .where(eq(djs.slug, slug));
              djId = dj?.id;
              if (!djId) {
                const [alias] = await tx
                  .select({ id: djAliases.djId })
                  .from(djAliases)
                  .where(eq(djAliases.slug, slug));
                djId = alias?.id;
              }
            }
            if (!djId)
              throw new DomainError(
                "missing_facts",
                `DJ ${slug} does not exist; include it in the bundle`,
              );
            lineup.push(djId);
          }
          if (new Set(lineup).size !== lineup.length)
            throw new DomainError(
              "identity_conflict",
              "Lineup contains multiple slugs for the same DJ",
            );
          const matches = await tx
            .select()
            .from(events)
            .where(
              or(
                eq(events.slug, item.slug),
                and(
                  eq(events.venueId, venueId),
                  eq(events.startsAt, item.startsAt),
                ),
              ),
            );
          if (matches.length > 1)
            throw new DomainError(
              "identity_conflict",
              "Event slug and venue/start identify different events",
            );
          const current = matches[0];
          if (current && current.slug !== item.slug)
            throw new DomainError(
              "identity_conflict",
              `An event already exists at this venue/start: ${current.slug}. Use its existing slug.`,
            );
          if (
            current &&
            Date.parse(current.observedAt) > Date.parse(payload.capturedAt)
          )
            throw new DomainError(
              "identity_conflict",
              "This package predates the latest event observation; defer it rather than overwrite newer facts",
            );
          const linked = current
            ? await linkedCoverCandidates(tx, current.id)
            : [];
          const cover = resolveCover(item, {
            current,
            storySource,
            pool: [...ownCandidates, ...linked],
            postUrl: payload.postUrl,
          });
          // A story refines an event whose public post stays the source and
          // embed; the story is still linked below as evidence.
          const keepPost =
            !!current && storySource && isPublicPostUrl(current.sourceUrl);
          const {
            venueSlug,
            djSlugs,
            imageMediaId,
            imageUrl,
            description,
            genres: rawGenres,
            ticketUrl,
            websiteUrl,
            ...fields
          } = item;
          const genres = rawGenres && normalizeGenres(rawGenres);
          if (genres)
            warnings.push(
              ...droppedGenreWarnings(genres.dropped, `event ${item.slug}`),
            );
          void venueSlug;
          void djSlugs;
          void imageMediaId;
          void imageUrl;
          const common = {
            ...fields,
            venueId,
            sourceUrl: keepPost ? current.sourceUrl : payload.postUrl,
            sourceAccountUrl: keepPost
              ? current.sourceAccountUrl
              : payload.accountUrl,
            observedAt: payload.capturedAt,
          };
          const [row] = current
            ? await tx
                .update(events)
                .set({
                  ...common,
                  // Omitted fields stay as stored; null clears nullable ones.
                  description,
                  genres: genres?.genres,
                  ticketUrl,
                  websiteUrl,
                  ...(cover.keep ? {} : cover.fields),
                })
                .where(eq(events.id, current.id))
                .returning()
            : await tx
                .insert(events)
                .values({
                  ...common,
                  description: description ?? "",
                  genres: genres?.genres ?? [],
                  ticketUrl: ticketUrl ?? null,
                  websiteUrl: websiteUrl ?? null,
                  ...(cover.keep ? {} : cover.fields),
                })
                .returning();
          if (!row) throw new Error("Event write failed");
          await tx.delete(eventDjs).where(eq(eventDjs.eventId, row.id));
          if (lineup.length)
            await tx.insert(eventDjs).values(
              lineup.map((djId, position) => ({
                eventId: row.id,
                djId,
                position,
              })),
            );
          await tx
            .insert(eventSources)
            .values({ eventId: row.id, packageId: id })
            .onConflictDoNothing();
          resultIds.push(row.id);
        }
        await refreshDjPriorities(tx, queuedDjs);
        // Recheck wall-clock expiry after waiting on catalogue locks and writing.
        const [done] = await tx
          .update(packages)
          .set({
            state: "done",
            resultEventIds: resultIds,
            completedToken: token,
            leaseToken: null,
            leaseExpiresAt: null,
            lastReason: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(packages.id, id),
              eq(packages.leaseToken, token),
              sql`${packages.leaseExpiresAt} > clock_timestamp()`,
            ),
          )
          .returning();
        if (!done)
          throw new DomainError(
            "stale_lease",
            "Lease expired during publication; claim again",
          );
        return {
          eventIds: resultIds,
          replayed: false,
          ...(soundcloud.length ? { soundcloud } : {}),
          ...(warnings.length ? { warnings } : {}),
        };
      });
    },
  };
}
function identity<
  T extends { id: string; slug: string; instagramUrl: string | null },
>(
  matches: T[],
  item: { slug: string; instagramUrl: string | null },
): T | undefined {
  if (matches.length > 1)
    throw new DomainError(
      "identity_conflict",
      "Slug and Instagram profile identify different records",
    );
  const current = matches[0];
  if (current && current.slug !== item.slug)
    throw new DomainError(
      "identity_conflict",
      `Instagram profile already belongs to ${current.slug}; use its existing slug`,
    );
  if (current?.instagramUrl && current.instagramUrl !== item.instagramUrl)
    throw new DomainError(
      "identity_conflict",
      "Existing slug belongs to another Instagram profile; do not overwrite identity",
    );
  return current;
}
type EventInput = PublishBundle["events"][number];
type CoverDecision =
  | { keep: true }
  | {
      keep: false;
      fields: {
        imageUrl: string | null;
        imageSlide: number | null;
        imageSourceUrl: string | null;
        imageSuppressed: boolean;
      };
    };
/**
 * Decide an event's cover. Omitted image fields keep the stored cover (with its
 * own post provenance); explicit null clears it; a media ID or URL selects a
 * candidate from this package or a public post/reel already linked to the event.
 */
function resolveCover(
  item: EventInput,
  context: {
    current: typeof events.$inferSelect | undefined;
    storySource: boolean;
    pool: CoverCandidate[];
    postUrl: string;
  },
): CoverDecision {
  const { current, storySource, pool, postUrl } = context;
  const none = (imageSuppressed: boolean): CoverDecision => ({
    keep: false,
    fields: {
      imageUrl: null,
      imageSlide: null,
      imageSourceUrl: null,
      imageSuppressed,
    },
  });
  if (item.imageUrl === undefined && item.imageMediaId === undefined)
    return current ? { keep: true } : none(false);
  if (!item.imageUrl && !item.imageMediaId) {
    // A story is never allowed to take a post cover away.
    if (
      storySource &&
      current?.imageUrl &&
      current.imageSourceUrl &&
      isPublicPostUrl(current.imageSourceUrl)
    )
      throw new DomainError(
        "invalid_input",
        "A story package cannot remove an event's post cover; omit the image fields to keep it, or use update_event with imageMediaId null to remove it deliberately",
      );
    // A deliberate clear is remembered so cover refresh never refills it.
    return none(
      current && current.imageUrl !== null
        ? true
        : (current?.imageSuppressed ?? false),
    );
  }
  const media = item.imageMediaId
    ? pool.find((candidate) => candidate.mediaId === item.imageMediaId)
    : undefined;
  if (item.imageMediaId && !media)
    throw new DomainError(
      "invalid_input",
      "Image media ID must match a candidate from this package or a public post/reel linked to the event",
    );
  const url = media?.url ?? item.imageUrl;
  if (!url)
    throw new DomainError("invalid_input", "Image selection is incomplete");
  const matched =
    media ??
    (isInstagramImage(url)
      ? pool.find((candidate) => candidate.url === url)
      : undefined);
  if (isInstagramImage(url) && !matched)
    throw new DomainError(
      "invalid_input",
      "An Instagram image must match a candidate from this public post or reel package",
    );
  const sourceUrl =
    matched?.sourceUrl ??
    (storySource
      ? current && isPublicPostUrl(current.sourceUrl)
        ? current.sourceUrl
        : pool[0]?.sourceUrl
      : postUrl);
  if (!sourceUrl)
    throw new DomainError(
      "invalid_input",
      "Story-based events cannot publish an image",
    );
  return {
    keep: false,
    fields: {
      imageUrl: url,
      imageSlide: matched?.slide ?? null,
      imageSourceUrl: sourceUrl,
      imageSuppressed: false,
    },
  };
}

async function verifyBundleProfiles(
  db: Database,
  verifier: SoundcloudVerifier,
  bundle: PublishBundle,
) {
  const evidence: (SoundcloudEvidence & {
    entity: "venue" | "dj";
    slug: string;
  })[] = [];
  for (const item of bundle.venues) {
    const [stored] = await db
      .select({ url: venues.soundcloudUrl })
      .from(venues)
      .where(eq(venues.slug, item.slug));
    const found = await verifyChangedProfile(
      verifier,
      item.soundcloudUrl,
      stored?.url,
    );
    if (found) evidence.push({ entity: "venue", slug: item.slug, ...found });
  }
  for (const item of bundle.djs) {
    const [stored] = await db
      .select({ url: djs.soundcloudUrl })
      .from(djs)
      .where(eq(djs.slug, item.slug));
    const found = await verifyChangedProfile(
      verifier,
      item.soundcloudUrl,
      stored?.url,
    );
    if (found) evidence.push({ entity: "dj", slug: item.slug, ...found });
  }
  return evidence;
}

function assertUnique(bundle: PublishBundle) {
  for (const rows of [bundle.venues, bundle.djs, bundle.events]) {
    if (new Set(rows.map((row) => row.slug)).size !== rows.length)
      throw new DomainError(
        "invalid_input",
        "A bundle cannot repeat entity slugs",
      );
  }
  for (const rows of [bundle.venues, bundle.djs]) {
    const profiles = rows.flatMap((row) =>
      row.instagramUrl ? [row.instagramUrl] : [],
    );
    if (new Set(profiles).size !== profiles.length)
      throw new DomainError(
        "identity_conflict",
        "A bundle cannot assign one Instagram profile to multiple entities",
      );
    const soundcloud = rows.flatMap((row) =>
      row.soundcloudUrl ? [row.soundcloudUrl] : [],
    );
    if (new Set(soundcloud).size !== soundcloud.length)
      throw new DomainError(
        "identity_conflict",
        "A bundle cannot assign one SoundCloud profile to multiple entities",
      );
  }
  for (const event of bundle.events)
    if (new Set(event.djSlugs).size !== event.djSlugs.length)
      throw new DomainError("invalid_input", "An event cannot repeat DJs");
}

async function enqueuePayload(
  db: Database | Transaction,
  payload: PostPackage,
) {
  const [inserted] = await db
    .insert(packages)
    .values({ postUrl: payload.postUrl, payload })
    .onConflictDoNothing({ target: packages.postUrl })
    .returning();
  const row =
    inserted ??
    (
      await db
        .select()
        .from(packages)
        .where(eq(packages.postUrl, payload.postUrl))
    )[0];
  if (!row) throw new Error("Insert did not return package");
  return { ...publicPackage(row), created: !!inserted };
}
function publicSource(
  venue: typeof venues.$inferSelect,
  source: typeof venueSources.$inferSelect | null,
) {
  const iso = (value: string | null | undefined) =>
    value ? new Date(value).toISOString() : null;
  return venueSourceSchema.parse({
    venueId: venue.id,
    slug: venue.slug,
    name: venue.name,
    city: venue.city,
    instagramUrl: venue.instagramUrl,
    enabled: source?.enabled ?? false,
    revision: source?.revision ?? 0,
    lastStartedAt: iso(source?.lastStartedAt),
    lastSucceededAt: iso(source?.lastSucceededAt),
    lastError: source?.lastError ?? null,
    lastPostCount: source?.lastPostCount ?? 0,
  });
}
async function lockSource(tx: Transaction, venueId: string) {
  // Always lock the parent row, including before a config row exists.
  const [venue] = await tx
    .select()
    .from(venues)
    .where(eq(venues.id, venueId))
    .for("update");
  if (!venue) throw new DomainError("not_found", "Venue not found");
  await tx.insert(venueSources).values({ venueId }).onConflictDoNothing();
  const [source] = await tx
    .select()
    .from(venueSources)
    .where(eq(venueSources.venueId, venueId))
    .for("update");
  if (!source) throw new Error("Source configuration missing");
  return { venue, source };
}
function checkRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new DomainError(
      "stale_source",
      "Venue source changed; reload its current revision",
    );
}
async function writeVenue(
  tx: Transaction,
  item: z.infer<typeof venueInputSchema>,
) {
  const matches = await tx
    .select()
    .from(venues)
    .where(
      or(
        eq(venues.slug, item.slug),
        item.instagramUrl
          ? eq(venues.instagramUrl, item.instagramUrl)
          : undefined,
      ),
    )
    .for("update");
  const current = identity(matches, item);
  if (item.soundcloudUrl) {
    const owner = await venueSoundcloudOwner(
      tx,
      item.soundcloudUrl,
      current?.id,
    );
    if (owner)
      throw new DomainError(
        "identity_conflict",
        `SoundCloud profile already belongs to venue ${owner}`,
      );
  }
  if (current && current.instagramUrl !== item.instagramUrl) {
    const { source } = await lockSource(tx, current.id);
    await tx
      .update(venueSources)
      .set({
        enabled: false,
        revision: source.revision + 1,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastSucceededAt: null,
        lastError: null,
        lastPostCount: 0,
      })
      .where(eq(venueSources.venueId, current.id));
  }
  const [row] = current
    ? await tx
        .update(venues)
        .set(item)
        .where(eq(venues.id, current.id))
        .returning()
    : await tx.insert(venues).values(item).returning();
  if (!row) throw new Error("Venue write failed");
  return row;
}
