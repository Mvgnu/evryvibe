import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { catalogUpdateRepository } from "../src/db/catalog-updates";
import { ingestionRepository } from "../src/db/ingestion";
import { normalizeStoredGenres } from "../src/db/genre-normalization";
import { djs, events, eventDjs, packages } from "../src/db/schema";

const url = process.env.CATALOG_UPDATE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("PostgreSQL targeted updates", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const repo = catalogUpdateRepository(connection.db);
  const ingestion = ingestionRepository(connection.db);
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error("Use an explicitly disposable test database");
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await connection.db.execute(
      sql`TRUNCATE event_sources, event_djs, events, djs, venues, post_packages CASCADE`,
    );
  });
  afterAll(() => connection.close());
  async function fixture(
    genres: { dj: string[]; event: string[] } = {
      dj: ["Techno"],
      event: ["Techno"],
    },
  ) {
    await ingestion.enqueue({
      postUrl: "https://www.instagram.com/p/UpdateTest/",
      accountUrl: "https://www.instagram.com/testroom/",
      capturedAt: "2026-10-01T12:00:00Z",
      caption: "Fixture",
      ocrText: "[Post slide 2: Image (carousel slide 2)] Fixture",
      imageCandidates: [
        { slide: 2, url: "https://s.cdninstagram.com/flyer.jpg" },
      ],
    });
    const claim = await ingestion.claim();
    if (!claim.claimed) throw new Error("Expected fixture claim");
    const result = await ingestion.complete(
      claim.package.id,
      claim.claimToken,
      {
        venues: [
          {
            slug: "testroom",
            name: "Fixture room",
            city: "Berlin",
            country: "Germany",
            address: "Fixture address",
            timezone: "Europe/Berlin",
            description: "",
            imageUrl: null,
            instagramUrl: null,
            websiteUrl: null,
          },
        ],
        djs: [
          {
            slug: "testdj",
            name: "Fixture DJ",
            description: "Original",
            translations: { en: { description: "Original English" } },
            genres: genres.dj,
            imageUrl: null,
            instagramUrl: "https://www.instagram.com/testdj/",
            websiteUrl: "https://example.com/dj",
            samplePostUrl: null,
          },
        ],
        events: [
          {
            slug: "testnight",
            title: "Fixture night",
            description: "Original",
            translations: { en: { title: "Original English" } },
            venueSlug: "testroom",
            djSlugs: ["testdj"],
            startsAt: "2026-10-10T21:00:00Z",
            endsAt: "2026-10-11T04:00:00Z",
            genres: genres.event,
            imageUrl: null,
            ticketUrl: "https://example.com/tickets",
            websiteUrl: null,
            status: "scheduled",
          },
        ],
      },
    );
    const [dj] = await connection.db.select().from(djs);
    const eventId = result.eventIds[0];
    if (!dj || !eventId) throw new Error("Missing fixture graph");
    return { dj, eventId, result };
  }
  it("normalises genres on every write path and warns about dropped ones", async () => {
    const { dj, eventId, result } = await fixture({
      dj: ["Driving Techno", "Electronic", "Peak-Time Techno"],
      event: ["Bounce", "Rave", "Hard Bounce"],
    });
    expect(result).toMatchObject({
      warnings: expect.arrayContaining([
        "dj testdj: Dropped unknown genre 'Electronic'; see list_genres",
        "event testnight: Dropped unknown genre 'Rave'; see list_genres",
      ]),
    });
    const [stored] = await connection.db
      .select({ genres: events.genres })
      .from(events);
    expect(stored?.genres).toEqual(["Hard Bounce"]);
    const updatedDj = await repo.updateDj({
      djId: dj.id,
      changes: { genres: ["DnB", "Groove", "Breaks"] },
    });
    expect(updatedDj).toMatchObject({
      genres: ["Drum & Bass", "Breakbeat"],
      warnings: ["Dropped unknown genre 'Groove'; see list_genres"],
    });
    const updatedEvent = await repo.updateEvent({
      eventId,
      changes: { genres: ["Schranz", "Performance"] },
    });
    expect(updatedEvent).toMatchObject({
      genres: ["Schranz"],
      warnings: ["Dropped unknown genre 'Performance'; see list_genres"],
    });
    // A clean list produces no warning.
    expect(
      await repo.updateEvent({ eventId, changes: { genres: ["Techno"] } }),
    ).not.toHaveProperty("warnings");
  });
  it("rewrites stored genres in one idempotent pass", async () => {
    await fixture();
    await connection.db.update(djs).set({ genres: ["Bounce", "Electronic"] });
    await connection.db.update(events).set({ genres: ["Psy Tech", "Rave"] });
    const dry = await normalizeStoredGenres(connection.db, { apply: false });
    expect(dry).toMatchObject({
      applied: false,
      djsChanged: 1,
      eventsChanged: 1,
      genresDropped: 2,
    });
    expect((await connection.db.select().from(djs))[0]?.genres).toEqual([
      "Bounce",
      "Electronic",
    ]);
    const applied = await normalizeStoredGenres(connection.db, { apply: true });
    expect(applied).toMatchObject({ djsChanged: 1, eventsChanged: 1 });
    expect((await connection.db.select().from(djs))[0]?.genres).toEqual([
      "Hard Bounce",
    ]);
    expect((await connection.db.select().from(events))[0]?.genres).toEqual([
      "Psytechno",
    ]);
    const again = await normalizeStoredGenres(connection.db, { apply: true });
    expect(again).toMatchObject({ djsChanged: 0, eventsChanged: 0 });
  });
  it("preserves omitted fields under concurrent edits and resolves DJ media references", async () => {
    const { dj } = await fixture();
    await Promise.all([
      repo.updateDj({ djId: dj.id, changes: { description: "Updated" } }),
      repo.updateDj({ djId: dj.id, changes: { genres: ["House"] } }),
    ]);
    const updated = await repo.updateDj({
      djId: dj.id,
      changes: {
        sampleMediaId: "ig:UpdateTest:slide:2:image",
        websiteUrl: null,
      },
    });
    expect(updated).toMatchObject({
      name: dj.name,
      description: "Updated",
      genres: ["House"],
      websiteUrl: null,
      translations: dj.translations,
      samplePostUrl: "https://www.instagram.com/p/UpdateTest/",
    });
    expect(
      (await repo.updateDj({ djId: dj.id, changes: { translations: null } }))
        .translations,
    ).toEqual({});
    await expect(
      repo.updateDj({
        djId: dj.id,
        changes: { sampleMediaId: "ig:Unknown:slide:2:image" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("resolves actual frame labels and legacy OCR IDs to canonical DJ sample sources", async () => {
    const { dj } = await fixture();
    for (const [code, ocrText, mediaId] of [
      [
        "FrameTest",
        "[Post slide 2: Video sampled frame at 1.50s of 10.00s; media ID ig:FrameTest:slide:2:frame:1.5; source https://www.instagram.com/reel/FrameTest/; representative frames only, not complete video transcription]\nFixture",
        "ig:FrameTest:slide:2:frame:1.5",
      ],
      [
        "LegacyFrame",
        "[Post slide 2: Video sampled frame at 3.00s of 10.00s; source https://www.instagram.com/reel/LegacyFrame/]\nLegacy",
        "ig:LegacyFrame:slide:2:frame:3",
      ],
      [
        "LegacyImage",
        "[Image 3, carousel slide 3]\nLegacy",
        "ig:LegacyImage:slide:3:image",
      ],
    ]) {
      const postUrl = `https://www.instagram.com/reel/${code}/`;
      // Insert raw legacy evidence directly so no enqueue/read normalization can hide the defect.
      await connection.db.insert(packages).values({
        postUrl,
        payload: {
          postUrl,
          accountUrl: "https://www.instagram.com/testroom/",
          capturedAt: "2026-10-01T12:00:00Z",
          caption: "Fixture",
          ocrText: ocrText ?? "",
        },
      });
      expect(
        (
          await repo.updateDj({
            djId: dj.id,
            changes: { sampleMediaId: mediaId },
          })
        ).samplePostUrl,
      ).toBe(postUrl);
    }
    await expect(
      repo.updateDj({
        djId: dj.id,
        changes: { sampleMediaId: "ig:FrameTest:slide:2:frame:1" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("preserves lineup, validates merged intervals, and rolls back invalid replacement", async () => {
    const { dj, eventId } = await fixture();
    const updated = await repo.updateEvent({
      eventId,
      changes: { ticketUrl: null, status: "cancelled" },
    });
    expect(updated).toMatchObject({
      djIds: [dj.id],
      title: "Fixture night",
      ticketUrl: null,
      status: "cancelled",
      translations: { en: { title: "Original English" } },
    });
    await expect(
      repo.updateEvent({
        eventId,
        changes: { startsAt: "2026-10-12T21:00:00Z" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      repo.updateEvent({
        eventId,
        changes: {
          title: "Must rollback",
          djIds: ["00000000-0000-4000-8000-000000000099"],
        },
      }),
    ).rejects.toMatchObject({ code: "missing_facts" });
    const [row] = await connection.db
      .select()
      .from(events)
      .where(eq(events.id, eventId));
    expect(row?.title).toBe("Fixture night");
    expect(await connection.db.select().from(eventDjs)).toHaveLength(1);
    expect(
      (await repo.updateEvent({ eventId, changes: { djIds: [] } })).djIds,
    ).toEqual([]);
    expect(await connection.db.select().from(eventDjs)).toHaveLength(0);
  });
  it("selects package-scoped images by persistent ID and clears image selection", async () => {
    const { eventId } = await fixture();
    await repo.updateEvent({
      eventId,
      changes: { imageMediaId: "ig:UpdateTest:slide:2:image" },
    });
    const [row] = await connection.db
      .select()
      .from(events)
      .where(eq(events.id, eventId));
    expect(row).toMatchObject({
      imageUrl: "https://s.cdninstagram.com/flyer.jpg",
      imageSlide: 2,
    });
    await expect(
      repo.updateEvent({
        eventId,
        changes: { imageMediaId: "ig:Other:slide:2:image" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await repo.updateEvent({ eventId, changes: { imageMediaId: null } });
    const [cleared] = await connection.db
      .select()
      .from(events)
      .where(eq(events.id, eventId));
    expect(cleared).toMatchObject({
      imageUrl: null,
      imageSlide: null,
      imageSuppressed: true,
    });
    await ingestion.refreshPostImages({
      sourceUrl: "https://www.instagram.com/p/UpdateTest/",
      images: [
        { slide: 1, url: "https://s.cdninstagram.com/cover-fresh.jpg" },
        { slide: 2, url: "https://s.cdninstagram.com/flyer-fresh.jpg" },
      ],
    });
    const [afterRefresh] = await connection.db
      .select()
      .from(events)
      .where(eq(events.id, eventId));
    expect(afterRefresh).toMatchObject({
      imageUrl: null,
      imageSlide: null,
      imageSuppressed: true,
    });
  });
  it("rejects occupied DJ identities and event venue/start collisions", async () => {
    const { dj, eventId } = await fixture();
    await connection.db.insert(djs).values({
      ...dj,
      id: "00000000-0000-4000-8000-000000000099",
      slug: "other-dj",
      instagramUrl: "https://www.instagram.com/otherdj/",
    });
    await expect(
      repo.updateDj({
        djId: dj.id,
        changes: { instagramUrl: "https://instagram.com/otherdj/?x=y" },
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    const [current] = await connection.db
      .select()
      .from(events)
      .where(eq(events.id, eventId));
    if (!current) throw new Error("Missing event");
    await connection.db.insert(events).values({
      ...current,
      id: "00000000-0000-4000-8000-000000000098",
      slug: "other-event",
      startsAt: "2026-10-09T21:00:00Z",
    });
    await expect(
      repo.updateEvent({
        eventId,
        changes: { startsAt: "2026-10-09T21:00:00Z" },
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
  });
});
