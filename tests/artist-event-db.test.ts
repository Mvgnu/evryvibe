import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { createArtistEvent } from "../src/db/artist-event";
import { readCatalog } from "../src/db/catalog";
import {
  artistEventCovers,
  djs,
  eventDjs,
  events,
  geocodeCache,
  venues,
} from "../src/db/schema";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("artist event publication on PostgreSQL", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const db = connection.db;
  const artistId = "00000000-0000-4000-8000-000000000001";
  const guestId = "00000000-0000-4000-8000-000000000002";
  const venueId = "00000000-0000-4000-8000-000000000003";
  const event = {
    title: "Night Shift",
    description: "First line\nSecond line",
    startsAt: "2027-05-01T23:00:00+02:00",
    endsAt: "2027-05-02T06:00:00+02:00",
    ticketUrl: null,
    djIds: [guestId],
    lineupNames: ["Unknown Guest"],
    venue: { kind: "existing" as const, id: venueId },
  };
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error("Disposable test database required");
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE artist_event_covers, artist_claim_links, artist_sessions, artist_profiles, artist_owners, geocode_cache, event_sources, event_djs, events, djs, venues, post_packages, reconciliation_tasks CASCADE`,
    );
    await db.insert(djs).values([
      {
        id: artistId,
        slug: "artist",
        name: "Artist",
        genres: [],
        description: "",
      },
      {
        id: guestId,
        slug: "guest",
        name: "Guest",
        genres: [],
        description: "",
      },
    ]);
    await db.insert(venues).values({
      id: venueId,
      slug: "test-venue",
      name: "Test Venue",
      city: "Berlin",
      country: "DE",
      address: "Teststrasse 1",
      timezone: "Europe/Berlin",
      description: "",
    });
  });
  afterAll(() => connection.close());
  it("publishes owner, selected and unlinked artists, provenance and cover atomically", async () => {
    const result = await createArtistEvent(
      db,
      artistId,
      event,
      Buffer.from("test cover"),
    );
    const [row] = await db
      .select()
      .from(events)
      .where(eq(events.slug, result.slug));
    expect(row).toMatchObject({
      sourceUrl: null,
      artistCreatedBy: artistId,
      description: "First line\nSecond line",
      unlinkedArtists: ["Unknown Guest"],
    });
    if (!row) throw new Error("Missing event");
    expect(
      await db.select().from(eventDjs).where(eq(eventDjs.eventId, row.id)),
    ).toHaveLength(2);
    expect(
      (
        await db
          .select()
          .from(artistEventCovers)
          .where(eq(artistEventCovers.eventId, row.id))
      )[0]?.imageBase64,
    ).toBe(Buffer.from("test cover").toString("base64"));
    const catalog = await readCatalog(db);
    expect(catalog.events.find((e) => e.id === row.id)).toMatchObject({
      sourceUrl: null,
      unlinkedArtists: ["Unknown Guest"],
      djIds: [artistId, guestId],
      imageUrl: `https://evryvibe.com/api/artist-events/covers/${row.id}`,
    });
  });
  it("rejects a duplicate occurrence and invalid artist without creating partial records", async () => {
    await createArtistEvent(db, artistId, event, null);
    await expect(
      createArtistEvent(db, artistId, event, null),
    ).rejects.toThrow();
    const invalid = {
      ...event,
      startsAt: "2027-05-02T23:00:00+02:00",
      endsAt: null,
      djIds: ["00000000-0000-4000-8000-000000000099"],
    };
    await expect(
      createArtistEvent(db, artistId, invalid, Buffer.from("test")),
    ).rejects.toThrow();
    expect(await db.select().from(events)).toHaveLength(1);
    expect(await db.select().from(artistEventCovers)).toHaveLength(0);
  });
  it("does not double-bill the claiming artist as an unlinked name", async () => {
    await expect(
      createArtistEvent(
        db,
        artistId,
        { ...event, lineupNames: ["ARTIST"] },
        null,
      ),
    ).rejects.toThrow();
    expect(await db.select().from(events)).toHaveLength(0);
  });
  it("requires a matching cached geocoder candidate before creating a new venue", async () => {
    const candidate = {
      id: "node/123",
      name: "Somewhere",
      sourceUrl: "https://www.openstreetmap.org/node/123",
      latitude: 52.5,
      longitude: 13.4,
    };
    const fresh = {
      ...event,
      venue: {
        kind: "new" as const,
        name: "New Place",
        city: "Berlin",
        country: "DE",
        address: "Example 1",
        timezone: "Europe/Berlin",
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        locationSourceUrl: candidate.sourceUrl,
      },
    };
    await expect(
      createArtistEvent(db, artistId, fresh, null),
    ).rejects.toThrow();
    await db
      .insert(geocodeCache)
      .values({ key: "candidate", query: "Example", results: [candidate] });
    await createArtistEvent(db, artistId, fresh, null);
    const [created] = await db
      .select()
      .from(venues)
      .where(eq(venues.name, "New Place"));
    expect(created).toMatchObject({
      latitude: 52.5,
      longitude: 13.4,
      locationSourceUrl: candidate.sourceUrl,
    });
  });
});
