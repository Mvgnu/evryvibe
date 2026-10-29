import { asc, eq } from "drizzle-orm";
import {
  djSchema,
  eventSchema,
  venueSchema,
  type Catalog,
} from "../core/model";
import { normalizeGenres } from "../core/genres";
import { isPublicPostUrl } from "../core/media";
import { database, type Database } from "./client";
import { djAliases, djs, eventDjs, events, venues } from "./schema";
import { demoCatalog } from "./demo";
export async function readCatalog(db: Database): Promise<Catalog> {
  return db.transaction(
    async (tx) => {
      const venueRows = await tx.select().from(venues);
      const djRows = await tx.select().from(djs);
      const eventRows = await tx
        .select()
        .from(events)
        .orderBy(asc(events.startsAt));
      const lineups = await tx
        .select()
        .from(eventDjs)
        .orderBy(asc(eventDjs.position));
      return {
        mode: "database",
        venues: venueRows.map((row) =>
          venueSchema.parse({ ...row, imageUrl: null }),
        ),
        djs: djRows.map((row) =>
          djSchema.parse({
            ...row,
            // Public surfaces show canonical genres even for rows written
            // before the taxonomy; `genres:normalize` rewrites the rows.
            genres: normalizeGenres(row.genres).genres,
            imageUrl: null,
          }),
        ),
        events: eventRows.map((row) => {
          const { imageSlide, imageSuppressed, imageSourceUrl, ...publicRow } =
            row;
          void imageSlide;
          void imageSuppressed;
          return eventSchema.parse({
            ...publicRow,
            genres: normalizeGenres(row.genres).genres,
            // A cover is shown only with its public post/reel provenance.
            imageUrl:
              imageSourceUrl && isPublicPostUrl(imageSourceUrl)
                ? row.imageUrl
                : null,
            startsAt: new Date(row.startsAt).toISOString(),
            endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
            observedAt: new Date(row.observedAt).toISOString(),
            djIds: lineups
              .filter((entry) => entry.eventId === row.id)
              .map((entry) => entry.djId),
          });
        }),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export async function getCatalog(): Promise<Catalog> {
  if (process.env.EVRYVIBE_DEMO === "1") {
    if (process.env.NODE_ENV === "production")
      throw new Error("Fictional demo inventory is disabled in production");
    return demoCatalog;
  }
  if (!process.env.DATABASE_URL)
    return { events: [], venues: [], djs: [], mode: "empty" };
  return readCatalog(database());
}

// Aliases are only looked up after a canonical slug misses, and never in demo mode.
export async function djRedirect(slug: string): Promise<string | null> {
  if (!process.env.DATABASE_URL || process.env.EVRYVIBE_DEMO === "1")
    return null;
  const [row] = await database()
    .select({ slug: djs.slug })
    .from(djAliases)
    .innerJoin(djs, eq(djAliases.djId, djs.id))
    .where(eq(djAliases.slug, slug));
  return row?.slug ?? null;
}
