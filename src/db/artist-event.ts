import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { artistEventInputSchema } from "../core/artist-event";
import { DomainError } from "../core/model";
import type { Database } from "./client";
import {
  artistEventCovers,
  djs,
  eventDjs,
  events,
  geocodeCache,
  venues,
} from "./schema";

function slugPart(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80)
      .replace(/-$/, "") || "event"
  );
}
export async function createArtistEvent(
  db: Database,
  djId: string,
  input: unknown,
  cover: Buffer | null,
): Promise<{ slug: string }> {
  const parsed = artistEventInputSchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError("invalid_input", "Invalid event details");
  const item = parsed.data;
  const eventId = randomUUID();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
    let venueId: string;
    if (item.venue.kind === "existing") {
      const [venue] = await tx
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.id, item.venue.id));
      if (!venue) throw new DomainError("not_found", "Venue not found");
      venueId = venue.id;
    } else {
      // Coordinates must be an actual recently returned geocoding candidate.
      const candidates = await tx.execute(
        sql`SELECT 1 FROM ${geocodeCache} AS c CROSS JOIN LATERAL jsonb_array_elements(c.results) AS candidate WHERE c.fetched_at > clock_timestamp() - interval '30 days' AND candidate->>'sourceUrl' = ${item.venue.locationSourceUrl} AND candidate->>'latitude' = ${String(item.venue.latitude)} AND candidate->>'longitude' = ${String(item.venue.longitude)} LIMIT 1`,
      );
      if (!candidates.length)
        throw new DomainError(
          "invalid_input",
          "Location must match a recent selected search result",
        );
      const [duplicate] = await tx
        .select({ id: venues.id })
        .from(venues)
        .where(
          and(
            sql`lower(trim(${venues.name})) = lower(trim(${item.venue.name}))`,
            sql`lower(trim(${venues.city})) = lower(trim(${item.venue.city}))`,
          ),
        );
      if (duplicate)
        throw new DomainError(
          "identity_conflict",
          "This venue already exists; select it from the list",
        );
      const id = randomUUID();
      await tx.insert(venues).values({
        id,
        slug: `${slugPart(item.venue.name)}-${id.slice(0, 8)}`,
        name: item.venue.name,
        city: item.venue.city,
        country: item.venue.country,
        address: item.venue.address,
        timezone: item.venue.timezone,
        latitude: item.venue.latitude,
        longitude: item.venue.longitude,
        locationSourceUrl: item.venue.locationSourceUrl,
        description: "",
      });
      venueId = id;
    }
    const [duplicate] = await tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(eq(events.venueId, venueId), eq(events.startsAt, item.startsAt)),
      );
    if (duplicate)
      throw new DomainError(
        "identity_conflict",
        "An event at this venue and time already exists",
      );
    const slug = `${slugPart(item.title)}-${eventId.slice(0, 8)}`;
    await tx.insert(events).values({
      id: eventId,
      slug,
      title: item.title,
      description: item.description,
      venueId,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      genres: [],
      unlinkedArtists: item.lineupNames,
      imageUrl: cover
        ? `https://evryvibe.com/api/artist-events/covers/${eventId}`
        : null,
      ticketUrl: item.ticketUrl,
      websiteUrl: null,
      sourceUrl: null,
      artistCreatedBy: djId,
      observedAt: new Date().toISOString(),
      status: "scheduled",
    });
    const artistIds = [djId, ...item.djIds.filter((id) => id !== djId)];
    const found = await tx
      .select({ id: djs.id, name: djs.name })
      .from(djs)
      .where(inArray(djs.id, artistIds));
    if (found.length !== artistIds.length)
      throw new DomainError("invalid_input", "Unknown artist in lineup");
    const knownNames = new Set(
      found.map((artist) =>
        artist.name.normalize("NFKC").toLocaleLowerCase("de-DE"),
      ),
    );
    if (
      item.lineupNames.some((name) =>
        knownNames.has(name.normalize("NFKC").toLocaleLowerCase("de-DE")),
      )
    )
      throw new DomainError("invalid_input", "Artist already in lineup");
    await tx
      .insert(eventDjs)
      .values(
        artistIds.map((id, position) => ({ eventId, djId: id, position })),
      );
    if (cover)
      await tx
        .insert(artistEventCovers)
        .values({ eventId, imageBase64: cover.toString("base64") });
    return { slug };
  });
}
