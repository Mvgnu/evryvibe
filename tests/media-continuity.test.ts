import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { catalogUpdateRepository } from "../src/db/catalog-updates";
import { ingestionRepository } from "../src/db/ingestion";
import { readCatalog } from "../src/db/catalog";
import { eventSources, events } from "../src/db/schema";
import {
  fakeSoundcloud,
  postSource,
  storySource,
  testDj,
  testEvent,
  testVenue,
} from "./support/backend";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("media continuity on Postgres", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const deps = { soundcloud: fakeSoundcloud({}) };
  const ingestion = ingestionRepository(connection.db, deps);
  const updates = catalogUpdateRepository(connection.db, deps);
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error(
        "Tests require an explicitly named disposable test database",
      );
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await connection.db.execute(
      sql`TRUNCATE event_sources, event_djs, events, djs, venues, post_packages, reconciliation_tasks CASCADE`,
    );
  });
  afterAll(() => connection.close());

  async function publish(source: object, event: object = {}) {
    await ingestion.enqueue(source);
    const claim = await ingestion.claim();
    if (!claim.claimed) throw new Error("Expected work");
    const result = await ingestion.complete(
      claim.package.id,
      claim.claimToken,
      {
        venues: [testVenue],
        djs: [testDj],
        events: [{ ...testEvent, ...event }],
      },
    );
    return { ...result, packageId: claim.package.id };
  }
  const stored = async () => {
    const [row] = await connection.db.select().from(events);
    if (!row) throw new Error("Event missing");
    return row;
  };
  const full = {
    description: "Warehouse night",
    genres: ["Techno", "Trance"],
    ticketUrl: "https://tickets.example.com/night",
    websiteUrl: "https://example.com/night",
  };
  const post = postSource("PostA", "2026-12-01T10:00:00Z");
  const postCover = "ig:PostA:slide:2:image";

  it("keeps the post cover, post source and embed when a story updates the event", async () => {
    await publish(post, { ...full, imageMediaId: postCover });
    const before = await stored();
    expect(before).toMatchObject({
      imageSlide: 2,
      imageSourceUrl: "https://www.instagram.com/p/PostA/",
      sourceUrl: "https://www.instagram.com/p/PostA/",
    });
    const story = storySource("1234567890", "2026-12-20T18:00:00Z");
    const result = await publish(story, { title: "Test Night (late start)" });
    const after = await stored();
    expect(after).toMatchObject({
      title: "Test Night (late start)",
      imageUrl: before.imageUrl,
      imageSlide: 2,
      imageSourceUrl: "https://www.instagram.com/p/PostA/",
      imageSuppressed: false,
      sourceUrl: "https://www.instagram.com/p/PostA/",
      sourceAccountUrl: "https://www.instagram.com/test_room/",
      ...full,
    });
    expect(new Date(after.observedAt).toISOString()).toBe(
      "2026-12-20T18:00:00.000Z",
    );
    const links = await connection.db
      .select()
      .from(eventSources)
      .where(eq(eventSources.eventId, after.id));
    expect(links.map((link) => link.packageId)).toContain(result.packageId);
    expect(links).toHaveLength(2);
    const catalog = await readCatalog(connection.db);
    expect(catalog.events[0]).toMatchObject({
      imageUrl: before.imageUrl,
      sourceUrl: "https://www.instagram.com/p/PostA/",
    });
  });

  it("never lets a story remove a post cover; a post or update_event can clear it on purpose", async () => {
    await publish(post, { ...full, imageMediaId: postCover });
    for (const [index, clear] of [
      { imageUrl: null },
      { imageMediaId: null },
    ].entries()) {
      await expect(
        publish(storySource(`11111111${index}`, "2026-12-20T18:00:00Z"), clear),
      ).rejects.toMatchObject({
        code: "invalid_input",
        message: /update_event/,
      });
    }
    expect(await stored()).toMatchObject({
      imageSlide: 2,
      imageSourceUrl: "https://www.instagram.com/p/PostA/",
      imageSuppressed: false,
    });
    await publish(postSource("PostB", "2026-12-21T10:00:00Z", 1), {
      imageUrl: null,
    });
    const cleared = await stored();
    expect(cleared).toMatchObject({
      imageUrl: null,
      imageSlide: null,
      imageSourceUrl: null,
      imageSuppressed: true,
    });
    await publish(storySource("2222222222", "2026-12-22T18:00:00Z"), {});
    expect(await stored()).toMatchObject({
      imageUrl: null,
      imageSuppressed: true,
    });
    expect(
      (await ingestion.listPostCovers()).sources.filter(
        (row) => "imageSuppressed" in row && row.imageSuppressed,
      ),
    ).toHaveLength(0);
  });

  it("explicit null for fields clears them while omitted fields are kept", async () => {
    await publish(post, { ...full, imageMediaId: postCover });
    await publish(storySource("3333333333", "2026-12-20T18:00:00Z"), {
      ticketUrl: null,
      genres: [],
    });
    expect(await stored()).toMatchObject({
      ticketUrl: null,
      genres: [],
      description: full.description,
      websiteUrl: full.websiteUrl,
    });
  });

  it("a newer post may take over the source while the kept cover keeps its own post", async () => {
    await publish(post, { ...full, imageMediaId: postCover });
    await publish(postSource("PostB", "2026-12-10T10:00:00Z", 1), {});
    expect(await stored()).toMatchObject({
      sourceUrl: "https://www.instagram.com/p/PostB/",
      imageSourceUrl: "https://www.instagram.com/p/PostA/",
      imageSlide: 2,
    });
    expect((await readCatalog(connection.db)).events[0]?.imageUrl).toContain(
      "PostA-2",
    );
  });

  it("selects a cover from an older linked post, via a story package or update_event", async () => {
    await publish(post, { ...full });
    await publish(postSource("PostB", "2026-12-10T10:00:00Z", 1), {});
    await expect(
      publish(storySource("4444444444", "2026-12-20T18:00:00Z"), {
        imageMediaId: "ig:Unlinked:slide:1:image",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await publish(storySource("5555555555", "2026-12-20T19:00:00Z"), {
      imageMediaId: postCover,
    });
    expect(await stored()).toMatchObject({
      imageSlide: 2,
      imageSourceUrl: "https://www.instagram.com/p/PostA/",
      sourceUrl: "https://www.instagram.com/p/PostB/",
    });
    const event = await stored();
    await updates.updateEvent({
      eventId: event.id,
      changes: { imageMediaId: "ig:PostB:slide:1:image" },
    });
    expect(await stored()).toMatchObject({
      imageSlide: 1,
      imageSourceUrl: "https://www.instagram.com/p/PostB/",
      imageSuppressed: false,
    });
    await updates.updateEvent({
      eventId: event.id,
      changes: { imageMediaId: postCover },
    });
    expect(await stored()).toMatchObject({
      imageSlide: 2,
      imageSourceUrl: "https://www.instagram.com/p/PostA/",
    });
    await expect(
      updates.updateEvent({
        eventId: event.id,
        changes: { imageMediaId: "ig:Nope:slide:1:image" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await updates.updateEvent({
      eventId: event.id,
      changes: { imageMediaId: null },
    });
    expect(await stored()).toMatchObject({
      imageUrl: null,
      imageSourceUrl: null,
      imageSuppressed: true,
    });
  });

  it("refreshes a kept cover by its own post, not the event's current source", async () => {
    await publish(post, { ...full, imageMediaId: postCover });
    await publish(postSource("PostB", "2026-12-10T10:00:00Z", 1), {});
    const covers = (await ingestion.listPostCovers()).sources;
    expect(covers).toContainEqual(
      expect.objectContaining({
        sourceUrl: "https://www.instagram.com/p/PostA/",
        sourceAccountUrl: "https://www.instagram.com/test_room/",
        imageSlide: 2,
        imageSuppressed: false,
      }),
    );
    const refreshed = "https://scontent.cdninstagram.com/PostA-2-fresh.jpg";
    expect(
      await ingestion.refreshPostImages({
        sourceUrl: "https://www.instagram.com/p/PostB/",
        images: [
          {
            slide: 1,
            url: "https://scontent.cdninstagram.com/PostB-1-fresh.jpg",
          },
        ],
      }),
    ).toEqual({ updated: 0, missing: 0 });
    expect(
      await ingestion.refreshPostImages({
        sourceUrl: "https://www.instagram.com/p/PostA/",
        images: [
          {
            slide: 1,
            url: "https://scontent.cdninstagram.com/PostA-1-fresh.jpg",
          },
          { slide: 2, url: refreshed },
        ],
      }),
    ).toEqual({ updated: 1, missing: 0 });
    expect((await stored()).imageUrl).toBe(refreshed);
  });

  it("keeps the old collector payload shape: list_post_covers feeds refresh_post_images unchanged", async () => {
    await publish(post, { imageMediaId: postCover });
    const { sources } = await ingestion.listPostCovers();
    // The deployed worker only reads these four fields.
    const oldShape = sources.map((row) => ({
      sourceUrl: row.sourceUrl,
      sourceAccountUrl: row.sourceAccountUrl,
      imageUrl: row.imageUrl,
      imageSlide: row.imageSlide,
    }));
    expect(oldShape.length).toBeGreaterThan(0);
    for (const row of oldShape) {
      expect(typeof row.sourceUrl).toBe("string");
      expect(
        row.sourceAccountUrl === null ||
          typeof row.sourceAccountUrl === "string",
      ).toBe(true);
    }
    // The worker re-captures each source and sends one image per slide.
    const bySource = new Map<string, Map<number, string>>();
    for (const row of oldShape.filter((entry) => entry.imageSlide !== null)) {
      const group = bySource.get(row.sourceUrl) ?? new Map<number, string>();
      group.set(row.imageSlide ?? 1, `${row.imageUrl}?fresh=1`);
      bySource.set(row.sourceUrl, group);
    }
    let updated = 0;
    for (const [sourceUrl, slides] of bySource) {
      const images = [...slides].map(([slide, url]) => ({ slide, url }));
      const result = await ingestion.refreshPostImages({ sourceUrl, images });
      expect(Object.keys(result).sort()).toEqual(["missing", "updated"]);
      updated += result.updated;
    }
    expect(updated).toBe(1);
    expect((await stored()).imageUrl).toContain("?fresh=1");
  });

  it("backfills image_source_url from post and reel sources only", async () => {
    await publish(post, { imageMediaId: postCover });
    await connection.db.execute(sql`UPDATE events SET image_source_url = NULL`);
    await connection.db.execute(sql`
      INSERT INTO events (slug, title, description, venue_id, starts_at, genres, image_url, source_url, observed_at, status)
      SELECT 'story-event', 'S', '', venue_id, starts_at + interval '1 day', '[]'::jsonb, 'https://example.com/a.jpg', 'https://www.instagram.com/stories/test_room/9/', now(), 'scheduled' FROM events LIMIT 1`);
    const migration = readFileSync(
      "drizzle/0009_backfill_event_image_source.sql",
      "utf8",
    );
    await connection.db.execute(sql.raw(migration));
    const rows = await connection.db
      .select({ slug: events.slug, imageSourceUrl: events.imageSourceUrl })
      .from(events);
    expect(
      Object.fromEntries(rows.map((row) => [row.slug, row.imageSourceUrl])),
    ).toEqual({
      "test-night": "https://www.instagram.com/p/PostA/",
      "story-event": null,
    });
  });
});
