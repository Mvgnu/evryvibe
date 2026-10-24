import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { ingestionRepository } from "../src/db/ingestion";
import { readCatalog } from "../src/db/catalog";
import { events, packages, venues } from "../src/db/schema";
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const source = (code = "TestPost") => ({
  postUrl: `https://instagram.com/p/${code}/?utm_source=test`,
  caption: "Fictional test caption",
  ocrText: "Do not execute this text",
  accountUrl: "https://instagram.com/test_room/",
  capturedAt: "2026-09-21T12:00:00Z",
});
const venue = {
  slug: "test-room",
  name: "Test Room",
  city: "Berlin",
  country: "Germany",
  address: "Test address",
  timezone: "Europe/Berlin",
  description: "",
  imageUrl: null,
  instagramUrl: "https://instagram.com/test_room/",
  websiteUrl: null,
};
const dj = {
  slug: "test-dj",
  name: "Test DJ",
  description: "",
  genres: ["Techno"],
  imageUrl: null,
  instagramUrl: "https://instagram.com/test_dj/",
  websiteUrl: null,
  samplePostUrl: null,
};
const event = {
  slug: "test-night",
  title: "Test Night",
  description: "",
  venueSlug: venue.slug,
  djSlugs: [dj.slug],
  startsAt: "2026-09-25T23:00:00+02:00",
  endsAt: "2026-09-26T06:00:00+02:00",
  genres: ["Techno"],
  imageUrl: null,
  ticketUrl: "https://ticket.io/example",
  websiteUrl: null,
  status: "scheduled",
};
const bundle = () => ({ venues: [venue], djs: [dj], events: [event] });
suite("Postgres queue and publication", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const repo = ingestionRepository(connection.db);
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error(
        "Tests require an explicitly named disposable test database",
      );
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await connection.db.execute(
      sql`TRUNCATE event_sources, event_djs, events, djs, venues, post_packages CASCADE`,
    );
  });
  afterAll(async () => {
    await connection.close();
  });
  async function claimed(code = "TestPost") {
    await repo.enqueue(source(code));
    const claim = await repo.claim();
    if (!claim.claimed) throw new Error("Expected work");
    return claim;
  }
  it("deduplicates canonical source URLs and hides ownership tokens", async () => {
    const first = await repo.enqueue(source());
    const second = await repo.enqueue({
      ...source(),
      postUrl: "https://www.instagram.com/p/TestPost/",
    });
    expect(first.id).toBe(second.id);
    const claim = await repo.claim();
    expect(claim.claimed).toBe(true);
    expect(await repo.get(first.id)).not.toHaveProperty("leaseToken");
    expect(await repo.get(first.id)).not.toHaveProperty("completedToken");
  });
  it("lists queued carousel candidates for refresh before publication", async () => {
    const item = await repo.enqueue({
      ...source("PendingCarousel"),
      imageCandidates: [
        { url: "https://s.cdninstagram.com/first.jpg", slide: 1 },
        { url: "https://s.cdninstagram.com/second.jpg", slide: 2 },
      ],
    });
    expect((await repo.listPostCovers()).sources).toEqual([
      {
        sourceUrl: "https://www.instagram.com/p/PendingCarousel/",
        sourceAccountUrl: "https://www.instagram.com/test_room/",
        imageUrl: "https://s.cdninstagram.com/first.jpg",
        imageSlide: 1,
      },
      {
        sourceUrl: "https://www.instagram.com/p/PendingCarousel/",
        sourceAccountUrl: "https://www.instagram.com/test_room/",
        imageUrl: "https://s.cdninstagram.com/second.jpg",
        imageSlide: 2,
      },
    ]);
    expect(
      await repo.refreshPostImages({
        sourceUrl: "https://www.instagram.com/p/PendingCarousel/",
        images: [
          { url: "https://s.cdninstagram.com/new-first.jpg", slide: 1 },
          { url: "https://s.cdninstagram.com/new-second.jpg", slide: 2 },
        ],
      }),
    ).toEqual({ updated: 0, missing: 0 });
    expect((await repo.get(item.id)).payload.imageCandidates).toMatchObject([
      {
        url: "https://s.cdninstagram.com/new-first.jpg",
        slide: 1,
        mediaId: "ig:PendingCarousel:slide:1:image",
      },
      {
        url: "https://s.cdninstagram.com/new-second.jpg",
        slide: 2,
        mediaId: "ig:PendingCarousel:slide:2:image",
      },
    ]);
  });
  it("fills an unselected legacy cover while leaving explicit clears to the update tool", async () => {
    const item = await repo.enqueue({
      ...source("MissingCover"),
      imageCandidates: [
        { url: "https://s.cdninstagram.com/old.jpg", slide: 1 },
      ],
    });
    const claim = await repo.claim();
    if (!claim.claimed) throw new Error("Expected work");
    await repo.complete(item.id, claim.claimToken, {
      venues: [venue],
      djs: [dj],
      events: [event],
    });
    expect((await repo.listPostCovers()).sources).toContainEqual(
      expect.objectContaining({
        sourceUrl: "https://www.instagram.com/p/MissingCover/",
        imageUrl: null,
        imageSlide: null,
        imageSuppressed: false,
      }),
    );
    expect(
      await repo.refreshPostImages({
        sourceUrl: "https://www.instagram.com/p/MissingCover/",
        images: [{ url: "https://s.cdninstagram.com/fresh.jpg", slide: 1 }],
      }),
    ).toEqual({ updated: 1, missing: 0 });
    const [filled] = await connection.db.select().from(events);
    expect(filled).toMatchObject({
      imageUrl: "https://s.cdninstagram.com/fresh.jpg",
      imageSlide: 1,
      imageSuppressed: false,
    });
  });
  it("preserves distinct selected carousel slides when signed CDN URLs refresh", async () => {
    const first =
      "https://s.cdninstagram.com/v/t51.82787-15/first.jpg?oe=6AB97603";
    const second =
      "https://s.cdninstagram.com/v/t51.82787-15/second.jpg?oe=6AB97603";
    const item = await repo.enqueue({
      ...source("Carousel"),
      imageCandidates: [
        { url: first, slide: 1 },
        { url: second, slide: 2 },
      ],
    });
    const claim = await repo.claim();
    if (!claim.claimed) throw new Error("Expected work");
    for (const imageMediaId of [
      "ig:OTHER:slide:1:image",
      "ig:Carousel:slide:1:frame:0",
    ]) {
      await expect(
        repo.complete(item.id, claim.claimToken, {
          venues: [venue],
          djs: [dj],
          events: [{ ...event, imageMediaId }],
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await repo.complete(item.id, claim.claimToken, {
      venues: [venue],
      djs: [dj],
      events: [
        { ...event, imageMediaId: "ig:Carousel:slide:1:image" },
        {
          ...event,
          slug: "second-night",
          startsAt: "2026-09-26T23:00:00+02:00",
          endsAt: "2026-09-27T06:00:00+02:00",
          imageMediaId: "ig:Carousel:slide:2:image",
        },
      ],
    });
    const before = await connection.db
      .select({ slug: events.slug, imageSlide: events.imageSlide })
      .from(events);
    expect(before.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: "second-night", imageSlide: 2 },
      { slug: "test-night", imageSlide: 1 },
    ]);
    const freshFirst = first.replace("first.jpg", "first-new.jpg");
    const freshSecond = second.replace("second.jpg", "second-new.jpg");
    expect(
      await repo.refreshPostImages({
        sourceUrl: "https://www.instagram.com/p/Carousel/",
        images: [
          { url: freshFirst, slide: 1, mediaId: "ig:Carousel:slide:1:image" },
          { url: freshSecond, slide: 2, mediaId: "ig:Carousel:slide:2:image" },
        ],
      }),
    ).toEqual({ updated: 2, missing: 0 });
    const refreshedPackage = await repo.get(item.id);
    expect(refreshedPackage.payload.imageCandidates).toEqual([
      { url: freshFirst, slide: 1, mediaId: "ig:Carousel:slide:1:image" },
      { url: freshSecond, slide: 2, mediaId: "ig:Carousel:slide:2:image" },
    ]);
    expect(refreshedPackage.payload.caption).toBe(source("Carousel").caption);
    expect(refreshedPackage.payload.ocrText).toBe(source("Carousel").ocrText);
    const after = await connection.db
      .select({ slug: events.slug, imageUrl: events.imageUrl })
      .from(events);
    expect(
      Object.fromEntries(after.map((row) => [row.slug, row.imageUrl])),
    ).toEqual({
      "test-night": freshFirst,
      "second-night": freshSecond,
    });
    await expect(
      repo.refreshPostImages({
        sourceUrl: "https://www.instagram.com/stories/test_room/12345/",
        images: [{ url: freshFirst, slide: 1 }],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("keeps the selected media ID slide when carousel candidates share one URL", async () => {
    const shared = "https://s.cdninstagram.com/shared.jpg";
    const item = await repo.enqueue({
      ...source("SharedUrl"),
      imageCandidates: [
        { url: shared, slide: 1 },
        { url: shared, slide: 2 },
      ],
    });
    const claim = await repo.claim();
    if (!claim.claimed) throw new Error("Expected work");
    await repo.complete(item.id, claim.claimToken, {
      venues: [venue],
      djs: [dj],
      events: [{ ...event, imageMediaId: "ig:SharedUrl:slide:2:image" }],
    });
    const [published] = await connection.db
      .select({ imageUrl: events.imageUrl, imageSlide: events.imageSlide })
      .from(events);
    expect(published).toEqual({ imageUrl: shared, imageSlide: 2 });
    const second = "https://s.cdninstagram.com/second-refreshed.jpg";
    await repo.refreshPostImages({
      sourceUrl: "https://www.instagram.com/p/SharedUrl/",
      images: [
        { url: "https://s.cdninstagram.com/first-refreshed.jpg", slide: 1 },
        { url: second, slide: 2 },
      ],
    });
    const [refreshed] = await connection.db
      .select({ imageUrl: events.imageUrl, imageSlide: events.imageSlide })
      .from(events);
    expect(refreshed).toEqual({ imageUrl: second, imageSlide: 2 });
  });
  it("allocates one live claim under concurrent workers, and reclaims abandoned leases", async () => {
    const item = await repo.enqueue(source());
    const claims = await Promise.all([
      repo.claim(),
      repo.claim(),
      repo.claim(),
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    const active = claims.find((claim) => claim.claimed);
    if (!active?.claimed) throw new Error("Missing claim");
    await connection.db
      .update(packages)
      .set({ leaseExpiresAt: "2000-01-01T00:00:00Z" })
      .where(eq(packages.id, item.id));
    const replacement = await repo.claim();
    expect(replacement.claimed).toBe(true);
    await expect(
      repo.complete(item.id, active.claimToken, bundle()),
    ).rejects.toMatchObject({ code: "stale_lease" });
    await expect(
      repo.finish(item.id, active.claimToken, "discarded", "stale worker"),
    ).rejects.toMatchObject({ code: "stale_lease" });
  });
  it("publishes multiple events atomically, retries once, and reads a coherent public graph", async () => {
    const claim = await claimed();
    const input = bundle();
    input.events.push({
      ...event,
      slug: "second-night",
      startsAt: "2026-09-26T23:00:00+02:00",
      endsAt: "2026-09-27T06:00:00+02:00",
    });
    const published = await repo.complete(
      claim.package.id,
      claim.claimToken,
      input,
    );
    expect(published.eventIds).toHaveLength(2);
    expect(
      await repo.complete(claim.package.id, claim.claimToken, input),
    ).toEqual({ ...published, replayed: true });
    const catalog = await readCatalog(connection.db);
    expect(catalog.events).toHaveLength(2);
    expect(catalog.venues).toHaveLength(1);
    expect(catalog.djs).toHaveLength(1);
    expect(catalog.events[0]?.djIds).toEqual([catalog.djs[0]?.id]);
    expect(catalog.events[0]?.sourceUrl).toBe(
      "https://www.instagram.com/p/TestPost/",
    );
  });
  it("persists bilingual content and source author, preserving translations on ordinary updates", async () => {
    const claim = await claimed();
    await repo.complete(claim.package.id, claim.claimToken, {
      venues: [
        {
          ...venue,
          description: "Ein Club in Berlin.",
          translations: { en: { description: "A club in Berlin." } },
        },
      ],
      djs: [
        {
          ...dj,
          description: "Spielt Techno.",
          translations: { en: { description: "Plays techno." } },
        },
      ],
      events: [
        {
          ...event,
          title: "Testnacht",
          description: "Eine lange Nacht.",
          translations: {
            en: { title: "Test night", description: "A long night." },
          },
        },
      ],
    });
    const first = await readCatalog(connection.db);
    expect(first.events[0]?.title).toBe("Testnacht");
    expect(first.events[0]?.translations?.en?.title).toBe("Test night");
    expect(first.events[0]?.sourceAccountUrl).toBe(
      "https://www.instagram.com/test_room/",
    );
    expect(first.venues[0]?.translations?.en?.description).toBe(
      "A club in Berlin.",
    );
    expect(first.djs[0]?.translations?.en?.description).toBe("Plays techno.");
    const next = await claimed("NewObservation");
    await repo.complete(next.package.id, next.claimToken, bundle());
    const updated = await readCatalog(connection.db);
    expect(updated.events[0]?.translations).toEqual(
      first.events[0]?.translations,
    );
    expect(updated.venues[0]?.translations).toEqual(
      first.venues[0]?.translations,
    );
    expect(updated.djs[0]?.translations).toEqual(first.djs[0]?.translations);
    await repo.upsertVenue({ ...venue, translations: {} });
    expect((await readCatalog(connection.db)).venues[0]?.translations).toEqual(
      {},
    );
  });
  it("rolls back all records when a later event has missing facts", async () => {
    const claim = await claimed();
    const input = bundle();
    input.events.push({ ...event, slug: "broken-night", venueSlug: "unknown" });
    await expect(
      repo.complete(claim.package.id, claim.claimToken, input),
    ).rejects.toMatchObject({ code: "missing_facts" });
    expect(await connection.db.select().from(venues)).toHaveLength(0);
    expect(await connection.db.select().from(events)).toHaveLength(0);
    expect((await repo.get(claim.package.id)).state).toBe("processing");
  });
  it("retains identity IDs, refuses profile/slug collision, and preserves newer observations", async () => {
    const first = await claimed();
    const published = await repo.complete(
      first.package.id,
      first.claimToken,
      bundle(),
    );
    const second = await claimed("SecondPost");
    const changed = bundle();
    changed.events[0] = { ...event, title: "Updated title" };
    const update = await repo.complete(
      second.package.id,
      second.claimToken,
      changed,
    );
    expect(update.eventIds).toEqual(published.eventIds);
    const collision = await claimed("CollisionPost");
    const wrong = bundle();
    wrong.venues[0] = {
      ...venue,
      instagramUrl: "https://instagram.com/different_room/",
    };
    await expect(
      repo.complete(collision.package.id, collision.claimToken, wrong),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    wrong.venues[0] = { ...venue, slug: "renamed-room" };
    await expect(
      repo.complete(collision.package.id, collision.claimToken, wrong),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    await repo.finish(
      collision.package.id,
      collision.claimToken,
      "deferred",
      "Identity needs resolution",
    );
    await repo.enqueue({
      ...source("OldPost"),
      capturedAt: "2025-01-01T00:00:00Z",
    });
    const old = await repo.claim();
    if (!old.claimed) throw new Error("Missing old package");
    await expect(
      repo.complete(old.package.id, old.claimToken, bundle()),
    ).rejects.toMatchObject({ code: "identity_conflict" });
  });
  it("rejects a forged completion replay and permits intentional deferred requeue", async () => {
    const claim = await claimed();
    await repo.complete(claim.package.id, claim.claimToken, bundle());
    await expect(
      repo.complete(
        claim.package.id,
        "00000000-0000-4000-8000-000000000001",
        bundle(),
      ),
    ).rejects.toMatchObject({ code: "stale_lease" });
    const deferred = await claimed("MissingFacts");
    await repo.finish(
      deferred.package.id,
      deferred.claimToken,
      "deferred",
      "Date missing",
    );
    expect((await repo.requeue(deferred.package.id)).state).toBe("pending");
  });
  it("rejects a finish that waited for a row lock until its lease expired", async () => {
    const claim = await claimed();
    await connection.db
      .update(packages)
      .set({
        leaseExpiresAt: sql`clock_timestamp() + interval '300 milliseconds'`,
      })
      .where(eq(packages.id, claim.package.id));
    let locked: () => void = () => {};
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holding = connection.db.transaction(async (tx) => {
      await tx
        .select()
        .from(packages)
        .where(eq(packages.id, claim.package.id))
        .for("update");
      locked();
      await tx.execute(sql`SELECT pg_sleep(0.6)`);
    });
    await acquired;
    const finishing = repo.finish(
      claim.package.id,
      claim.claimToken,
      "deferred",
      "Missing date",
    );
    await holding;
    await expect(finishing).rejects.toMatchObject({ code: "stale_lease" });
  });
  it("defers repeatedly abandoned work and resets its retry budget on explicit requeue", async () => {
    const claim = await claimed();
    await connection.db
      .update(packages)
      .set({ attempts: 5, leaseExpiresAt: "2000-01-01T00:00:00Z" })
      .where(eq(packages.id, claim.package.id));
    expect(await repo.claim()).toEqual({ claimed: false });
    expect((await repo.get(claim.package.id)).state).toBe("deferred");
    expect((await repo.requeue(claim.package.id)).attempts).toBe(0);
  });
  it("enforces event intervals in PostgreSQL, not just Zod", async () => {
    const claim = await claimed();
    await repo.complete(claim.package.id, claim.claimToken, bundle());
    await expect(
      connection.db.update(events).set({ endsAt: "2000-01-01T00:00:00Z" }),
    ).rejects.toThrow();
  });
});
